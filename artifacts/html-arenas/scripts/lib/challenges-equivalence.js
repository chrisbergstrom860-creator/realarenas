/*
 * Small, deliberately boring harness for the challenges response parity gate.
 *
 * This module never requires server.js.  server.js creates an HTTP listener as
 * a side effect, so the gate parses just the production route callback and
 * evaluates it in a VM instead.  The same reader-only Supabase client is
 * supplied to both VMs.
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { AsyncLocalStorage } = require('node:async_hooks');
const { createRequire } = require('node:module');
const { execFileSync } = require('node:child_process');
const posixPath = require('node:path').posix;
const ts = require('typescript');
const { createClient } = require('@supabase/supabase-js');
const { mustWrite: importedMustWrite, makeCleanup: importedMakeCleanup } = (() => {
  try {
    // This helper is ESM in some worktrees and CommonJS in others.  The small
    // fallback keeps this verifier usable in either layout.
    return require('./checked-writes.js');
  } catch {
    return {
      async mustWrite(label, query) {
        const { data, error } = await query;
        if (error) throw new Error(`${label}: ${error.message || String(error)}`);
        return data;
      },
      makeCleanup() {
        let failures = 0;
        return {
          async cw(label, query) {
            try {
              const { error } = await query;
              if (error) failures++;
            } catch {
              failures++;
            }
          },
          failed: () => failures > 0,
          count: () => failures
        };
      }
    };
  }
})();

const SERVER_RELATIVE_PATH = 'artifacts/html-arenas/server.js';
const SERVER_FILE = path.resolve(__dirname, '..', '..', 'server.js');
const FIXTURE_MANIFEST_PATH = '/tmp/verify-mobile-geometry-manifest.json';
const READ_METHODS = new Set(['GET', 'HEAD']);
const ROUTES = {
  primary: '/api/challenges',
  rail: '/api/challenges/friends-rail'
};
const REQUIRED_CONSTANTS = ['PREF_KEYS', 'challengeHasEnded'];
const EXTERNAL_NAMES = new Set([
  'supabase',
  'supabaseAdmin',
  'app',
  'server',
  'io',
  'stripe',
  'module',
  'exports',
  '__filename',
  '__dirname'
]);
const JS_GLOBALS = new Set([
  'Array', 'ArrayBuffer', 'BigInt', 'Boolean', 'Buffer', 'DataView', 'Date',
  'Error', 'EvalError', 'Float32Array', 'Float64Array', 'Function', 'Infinity',
  'Int16Array', 'Int32Array', 'Int8Array', 'Intl', 'JSON', 'Map', 'Math',
  'NaN', 'Number', 'Object', 'Promise', 'Proxy', 'RangeError', 'ReferenceError',
  'Reflect', 'RegExp', 'Set', 'String', 'Symbol', 'SyntaxError', 'TypeError',
  'URIError', 'URL', 'URLSearchParams', 'Uint16Array', 'Uint32Array',
  'Uint8Array', 'Uint8ClampedArray', 'WeakMap', 'WeakSet', 'clearImmediate',
  'clearInterval', 'clearTimeout', 'console', 'decodeURI', 'decodeURIComponent',
  'encodeURI', 'encodeURIComponent', 'escape', 'eval', 'fetch', 'global',
  'globalThis', 'isFinite', 'isNaN', 'parseFloat', 'parseInt', 'process',
  'queueMicrotask', 'require', 'setImmediate', 'setInterval', 'setTimeout',
  'structuredClone', 'undefined', 'unescape'
]);

function repoRoot() {
  return execFileSync('git', ['rev-parse', '--show-toplevel'], {
    cwd: path.resolve(__dirname, '..', '..', '..'),
    encoding: 'utf8'
  }).trim();
}

function sourceAtRef(ref, root = repoRoot()) {
  if (!ref || ref === 'WORKTREE') {
    return {
      source: fs.readFileSync(path.join(root, SERVER_RELATIVE_PATH), 'utf8'),
      name: path.join(root, SERVER_RELATIVE_PATH)
    };
  }
  const source = execFileSync('git', ['show', `${ref}:${SERVER_RELATIVE_PATH}`], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024
  });
  return { source, name: `${ref}:${SERVER_RELATIVE_PATH}` };
}

const gitModuleSourceCache = new Map();
const gitModuleExportCache = new Map();

function gitModuleName(sourceName) {
  if (typeof sourceName !== 'string') return null;
  const separator = sourceName.indexOf(':');
  if (separator <= 0 || path.isAbsolute(sourceName)) return null;
  const ref = sourceName.slice(0, separator);
  const relativePath = sourceName.slice(separator + 1);
  if (!relativePath || relativePath.startsWith('/')) return null;
  return { ref, relativePath, root: repoRoot() };
}

function gitBlob(ref, relativePath, root) {
  const key = `${root}\0${ref}\0${relativePath}`;
  if (gitModuleSourceCache.has(key)) return gitModuleSourceCache.get(key);
  try {
    const source = execFileSync('git', ['show', `${ref}:${relativePath}`], {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore']
    });
    const result = { source, relativePath };
    gitModuleSourceCache.set(key, result);
    return result;
  } catch {
    return null;
  }
}

function gitModuleFile(request, parent) {
  const cleanRequest = posixPath.normalize(request);
  const parentDirectory = posixPath.dirname(parent.relativePath);
  const relativePath = posixPath.normalize(posixPath.join(parentDirectory, cleanRequest));
  if (relativePath === '..' || relativePath.startsWith('../')) {
    throw new Error(`relative module escapes git source tree: ${request}`);
  }
  const candidates = [];
  const addCandidate = (candidate) => {
    if (!candidates.includes(candidate)) candidates.push(candidate);
  };
  addCandidate(relativePath);
  if (!posixPath.extname(relativePath)) {
    addCandidate(`${relativePath}.js`);
    addCandidate(`${relativePath}.json`);
  }
  for (const candidate of candidates) {
    const blob = gitBlob(parent.ref, candidate, parent.root);
    if (blob) {
      return {
        ref: parent.ref,
        relativePath: candidate,
        root: parent.root,
        source: blob.source
      };
    }
  }
  const packageBlob = gitBlob(parent.ref, `${relativePath}/package.json`, parent.root);
  if (packageBlob) {
    let packageJson;
    try {
      packageJson = JSON.parse(packageBlob.source);
    } catch (error) {
      throw new Error(`invalid git package.json ${parent.ref}:${relativePath}: ${error.message}`);
    }
    if (packageJson.main) return gitModuleFile(packageJson.main, {
      ...parent,
      relativePath: `${relativePath}/package.json`
    });
  }
  const index = gitBlob(parent.ref, `${relativePath}/index.js`, parent.root) ||
    gitBlob(parent.ref, `${relativePath}/index.json`, parent.root);
  if (index) {
    return {
      ref: parent.ref,
      relativePath: index.relativePath,
      root: parent.root,
      source: index.source
    };
  }
  throw new Error(`cannot resolve ${request} from ${parent.ref}:${parent.relativePath}`);
}

function evaluateGitModule(resolved) {
  const key = `${resolved.root}\0${resolved.ref}\0${resolved.relativePath}`;
  if (gitModuleExportCache.has(key)) return gitModuleExportCache.get(key).exports;
  if (posixPath.extname(resolved.relativePath) === '.json') {
    const value = JSON.parse(resolved.source);
    const record = { exports: value };
    gitModuleExportCache.set(key, record);
    return value;
  }
  const record = { exports: {} };
  gitModuleExportCache.set(key, record);
  const virtualFilename = `${resolved.ref}:${resolved.relativePath}`;
  const localRequire = (request) => {
    if (request.startsWith('.')) {
      return evaluateGitModule(gitModuleFile(request, resolved));
    }
    return serverRequire(request);
  };
  const wrapper = vm.runInThisContext(
    `(function (exports, require, module, __filename, __dirname) {\n${resolved.source}\n})`,
    { filename: virtualFilename, displayErrors: true }
  );
  wrapper(
    record.exports,
    localRequire,
    record,
    virtualFilename,
    posixPath.dirname(virtualFilename)
  );
  return record.exports;
}

function sourceModuleFile(request, sourceName) {
  const parent = gitModuleName(sourceName);
  if (!parent || !request.startsWith('.')) return null;
  return gitModuleFile(request, parent);
}

function sourceModuleText(request, sourceName) {
  const file = sourceModuleFile(request, sourceName);
  if (file) return file.source;
  if (gitModuleName(sourceName)) return null;
  try {
    const resolved = createRequire(sourceName).resolve(request);
    return fs.readFileSync(resolved, 'utf8');
  } catch {
    return null;
  }
}

function runOfflineSelfTest(ref = 'HEAD') {
  const oldSource = sourceAtRef(ref);
  const newSource = sourceAtRef('WORKTREE');
  const oldTzdate = loadModule('./tzdate', oldSource.name);
  const newTzdate = loadModule('./tzdate', newSource.name);
  if (!oldTzdate || typeof oldTzdate.dayKey !== 'function') {
    throw new Error('offline self-test could not resolve old-ref ./tzdate');
  }
  if (!newTzdate || typeof newTzdate.dayKey !== 'function') {
    throw new Error('offline self-test could not resolve worktree ./tzdate');
  }
  const sample = '2025-01-02T12:00:00.000Z';
  if (oldTzdate.dayKey(sample, 'UTC') !== newTzdate.dayKey(sample, 'UTC')) {
    throw new Error('offline self-test old/worktree relative helper behavior differs unexpectedly');
  }
  let oldChallengeSource = null;
  try {
    oldChallengeSource = sourceModuleText('./challenges-query', oldSource.name);
  } catch {
    // HEAD predates challenges-query in the current worktree.  This is still
    // a meaningful old/new source distinction, not a workspace fallback.
  }
  const newChallengeSource = sourceModuleText('./challenges-query', newSource.name);
  if (!newChallengeSource || !newChallengeSource.includes('createRequestAuthMemo')) {
    throw new Error('offline self-test could not resolve worktree ./challenges-query');
  }
  if (oldChallengeSource === newChallengeSource) {
    throw new Error('offline self-test did not observe an old/new helper-only source difference');
  }
  const newChallenge = loadModule('./challenges-query', newSource.name);
  if (!newChallenge || typeof newChallenge.challengeWindowFor !== 'function') {
    throw new Error('offline self-test loaded the wrong worktree helper module');
  }
  return {
    oldHelper: oldChallengeSource ? 'present-and-different' : 'absent',
    newHelper: 'worktree',
    recursiveOldHelper: 'tzdate'
  };
}

function lineAt(sourceFile, node) {
  return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
}

function routeTextMatches(node, route) {
  if (!node || !ts.isCallExpression(node)) return false;
  const text = node.arguments.length ? node.arguments[0].getText() : '';
  if (route === ROUTES.primary) {
    return /['"`]\/api\/challenges['"`]/.test(text) &&
      !text.includes('/api/challenges/friends-rail');
  }
  return text.includes(route);
}

function findRoute(sourceFile, route) {
  let found = null;
  function visit(node) {
    if (found) return;
    if (ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        node.expression.name.text === 'get' &&
        routeTextMatches(node, route)) {
      let callback = [...node.arguments].reverse().find((arg) =>
        ts.isArrowFunction(arg) || ts.isFunctionExpression(arg)
      );
      if (!callback) {
        const reference = [...node.arguments].reverse().find((arg) => ts.isIdentifier(arg));
        if (reference) {
          callback = sourceFile.statements.find((statement) =>
            ts.isFunctionDeclaration(statement) && statement.name &&
            statement.name.text === reference.text);
          if (!callback) {
            for (const statement of sourceFile.statements) {
              if (!ts.isVariableStatement(statement)) continue;
              const declaration = statement.declarationList.declarations.find((item) =>
                ts.isIdentifier(item.name) && item.name.text === reference.text);
              if (declaration && declaration.initializer &&
                  (ts.isArrowFunction(declaration.initializer) ||
                   ts.isFunctionExpression(declaration.initializer))) {
                callback = declaration.initializer;
                break;
              }
            }
          }
        }
      }
      if (!callback) throw new Error(`GET ${route} has no production callback`);
      found = { call: node, callback, line: lineAt(sourceFile, node) };
      return;
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  if (!found) throw new Error(`Could not find GET ${route} in server.js`);
  return found;
}

function bindingNames(name, output = []) {
  if (ts.isIdentifier(name)) output.push(name.text);
  else if (ts.isObjectBindingPattern(name) || ts.isArrayBindingPattern(name)) {
    name.elements.forEach((element) => {
      if (ts.isBindingElement(element)) bindingNames(element.name, output);
    });
  }
  return output;
}

function moduleRequestFromInitializer(initializer) {
  if (!initializer || !ts.isCallExpression(initializer)) return null;
  if (!ts.isIdentifier(initializer.expression) ||
      initializer.expression.text !== 'require' ||
      initializer.arguments.length !== 1 ||
      !ts.isStringLiteral(initializer.arguments[0])) return null;
  return initializer.arguments[0].text;
}

function collectRequireBindings(sourceFile) {
  const bindings = [];
  sourceFile.statements.forEach((statement) => {
    if (!ts.isVariableStatement(statement)) return;
    statement.declarationList.declarations.forEach((declaration) => {
      const request = moduleRequestFromInitializer(declaration.initializer);
      if (!request) return;
      bindings.push({
        request,
        names: bindingNames(declaration.name),
        name: declaration.name,
        declaration
      });
    });
  });
  sourceFile.statements.forEach((statement) => {
    if (!ts.isImportDeclaration(statement) || !statement.moduleSpecifier ||
        !ts.isStringLiteral(statement.moduleSpecifier)) return;
    const request = statement.moduleSpecifier.text;
    const clause = statement.importClause;
    if (!clause) {
      bindings.push({ request, names: [], importDeclaration: statement });
      return;
    }
    const names = [];
    if (clause.name) names.push(clause.name.text);
    if (clause.namedBindings) {
      if (ts.isNamespaceImport(clause.namedBindings)) {
        names.push(clause.namedBindings.name.text);
      } else {
        clause.namedBindings.elements.forEach((element) => names.push(element.name.text));
      }
    }
    bindings.push({ request, names, importDeclaration: statement, clause });
  });
  return bindings;
}

function isDeclarationIdentifier(node) {
  const parent = node.parent;
  if (!parent) return false;
  if (ts.isVariableDeclaration(parent) && parent.name === node) return true;
  if (ts.isParameter(parent) && parent.name === node) return true;
  if (ts.isBindingElement(parent) && parent.name === node) return true;
  if (ts.isFunctionDeclaration(parent) && parent.name === node) return true;
  if ((ts.isFunctionExpression(parent) || ts.isArrowFunction(parent)) &&
      parent.name === node) return true;
  if (ts.isClassDeclaration(parent) && parent.name === node) return true;
  if (ts.isCatchClause(parent) && parent.variableDeclaration &&
      parent.variableDeclaration.name === node) return true;
  return false;
}

function isNonReferenceIdentifier(node) {
  const parent = node.parent;
  if (!parent) return false;
  if (isDeclarationIdentifier(node)) return true;
  if (ts.isPropertyAccessExpression(parent) && parent.name === node) return true;
  if ((ts.isPropertyAssignment(parent) || ts.isShorthandPropertyAssignment(parent)) &&
      parent.name === node && !ts.isShorthandPropertyAssignment(parent)) return true;
  if (ts.isMethodDeclaration(parent) && parent.name === node) return true;
  if (ts.isMethodSignature(parent) && parent.name === node) return true;
  if (ts.isLabeledStatement(parent) || ts.isBreakStatement(parent) ||
      ts.isContinueStatement(parent)) return true;
  if (ts.isQualifiedName(parent) && parent.right === node) return true;
  return false;
}

/*
 * This is intentionally a conservative free-name collector.  Removing every
 * binding declared anywhere inside a callback also removes shadowed names
 * which could otherwise be mistaken for a server-level helper.  It can only
 * make the extraction include an extra harmless declaration, never execute a
 * route or write.
 */
function freeNames(node) {
  const declared = new Set();
  function collectDeclarations(current) {
    if (ts.isVariableDeclaration(current)) {
      bindingNames(current.name).forEach((name) => declared.add(name));
    }
    if (ts.isParameter(current)) {
      bindingNames(current.name).forEach((name) => declared.add(name));
    }
    if (ts.isFunctionDeclaration(current) && current.name) declared.add(current.name.text);
    if (ts.isClassDeclaration(current) && current.name) declared.add(current.name.text);
    if (ts.isCatchClause(current) && current.variableDeclaration) {
      bindingNames(current.variableDeclaration.name).forEach((name) => declared.add(name));
    }
    ts.forEachChild(current, collectDeclarations);
  }
  collectDeclarations(node);
  const names = new Set();
  function visit(current) {
    if (ts.isIdentifier(current) && !isNonReferenceIdentifier(current) &&
        !declared.has(current.text) && !JS_GLOBALS.has(current.text)) {
      names.add(current.text);
    }
    ts.forEachChild(current, visit);
  }
  visit(node);
  return names;
}

function declarationSnippet(declaration, sourceFile) {
  const keyword = declaration.parent && declaration.parent.parent &&
    ts.isVariableStatement(declaration.parent.parent)
    ? declaration.parent.parent.declarationList.flags & ts.NodeFlags.Let
      ? 'let'
      : declaration.parent.parent.declarationList.flags & ts.NodeFlags.Const
        ? 'const'
        : 'var'
    : 'const';
  return `${keyword} ${declaration.getText(sourceFile)};`;
}

function importedLocalNames(requireBindings) {
  return new Set(requireBindings.flatMap((binding) => binding.names));
}

function loadModule(request, sourceName) {
  const sourceFile = sourceModuleFile(request, sourceName);
  if (sourceFile) return evaluateGitModule(sourceFile);
  const baseFile = gitModuleName(sourceName) ? SERVER_FILE : sourceName;
  const localRequire = createRequire(baseFile);
  if (request === 'sharp') {
    // An absolute resolution avoids VM/module-loader differences between the
    // worktree and a git-extracted source file.
    return localRequire(require.resolve('sharp'));
  }
  return localRequire(request);
}

function serverRequire(request) {
  const localRequire = createRequire(SERVER_FILE);
  return request === 'sharp'
    ? localRequire(require.resolve('sharp'))
    : localRequire(request);
}

function setImportedBindings(sandbox, requireBindings, sourceName) {
  for (const binding of requireBindings) {
    let value;
    try {
      value = loadModule(binding.request, sourceName);
    } catch (error) {
      // Modules which are unrelated to the challenge route (Stripe, multer,
      // and optional integrations) must not prevent extraction.  If a
      // reachable function really needs one, its normal runtime error remains
      // visible in the route result.
      continue;
    }
    if (!binding.names.length) continue;
    const clause = binding.clause;
    if (clause && clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
      clause.namedBindings.elements.forEach((element) => {
        const imported = element.propertyName ? element.propertyName.text : element.name.text;
        sandbox[element.name.text] = value && value[imported];
      });
      if (clause.name) sandbox[clause.name.text] = value && (value.default || value);
    } else if (binding.name && ts.isObjectBindingPattern(binding.name)) {
      binding.name.elements.forEach((element) => {
        const property = element.propertyName || element.name;
        const local = element.name;
        if (ts.isIdentifier(property) && ts.isIdentifier(local)) {
          sandbox[local.text] = value && value[property.text];
        }
      });
    } else if (binding.names.length === 1) {
      sandbox[binding.names[0]] = value && value.default ? value.default : value;
    }
  }
}

function makeFrozenDate(now) {
  const RealDate = Date;
  const frozenMs = now instanceof RealDate ? now.getTime() : new RealDate(now).getTime();
  if (!Number.isFinite(frozenMs)) throw new Error('invalid frozen timestamp');
  class FrozenDate extends RealDate {
    constructor(...args) {
      super(...(args.length ? args : [frozenMs]));
    }
    static now() {
      return frozenMs;
    }
  }
  Object.setPrototypeOf(FrozenDate, RealDate);
  return FrozenDate;
}

function safeConsole() {
  return {
    log() {},
    info() {},
    warn() {},
    error() {}
  };
}

function sourceLabel(stack, sourceName, sourceMap = null) {
  const lines = String(stack || '').split('\n');
  const candidates = lines.filter((line) =>
    /\.js:\d+:\d+/.test(line) &&
    !line.includes('challenges-equivalence.js'));
  const candidate = candidates[0] || '';
  const match = candidate.match(/([^/\\() ]+\.js):(\d+):(\d+)/);
  if (!match) return 'server.js:?';
  const generatedLine = Number(match[2]);
  const originalLine = sourceMap && sourceMap[generatedLine];
  return `${match[1]}:${originalLine || generatedLine}`;
}

function sanitizeUuid(value) {
  return String(value).replace(
    /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/ig,
    '[uuid]'
  );
}

function queryTable(input) {
  try {
    const url = new URL(typeof input === 'string' ? input : input.url);
    const parts = url.pathname.split('/').filter(Boolean);
    return sanitizeUuid(parts[parts.length - 1] || 'request');
  } catch {
    return 'request';
  }
}

/*
 * Supabase's PostgREST builder is a thenable, not a Promise.  Wrapping its
 * `then` keeps the source line that created the query in AsyncLocalStorage
 * until fetch and until the response body has been consumed.
 */
function instrumentBuilder(
  builder,
  als,
  sourceName,
  table = null,
  sourceMap = null,
  contextCarrier = null,
  labelOverride = null
) {
  const stack = new Error().stack;
  const label = labelOverride || sourceLabel(stack, sourceName, sourceMap);
  let proxy;
  proxy = new Proxy(builder, {
    get(target, property) {
      if (property === 'then') {
        return (resolve, reject) => als.run({ label, table }, () => {
          const previous = contextCarrier && contextCarrier.active;
          if (contextCarrier) {
            const context = { label, table };
            contextCarrier.pending.push(context);
            contextCarrier.active = context;
          }
          try {
            return target.then(resolve, reject);
          } finally {
            if (contextCarrier) contextCarrier.active = previous;
          }
        });
      }
      if (property === 'catch') {
        return (...args) => als.run({ label, table }, () => {
          const previous = contextCarrier && contextCarrier.active;
          if (contextCarrier) {
            const context = { label, table };
            contextCarrier.pending.push(context);
            contextCarrier.active = context;
          }
          try {
            return target.catch(...args);
          } finally {
            if (contextCarrier) contextCarrier.active = previous;
          }
        });
      }
      const value = target[property];
      if (typeof value !== 'function') return value;
      return (...args) => {
        const result = value.apply(target, args);
        if (result === target) return proxy;
        if (result && typeof result.then === 'function') {
          return instrumentBuilder(
            result,
            als,
            sourceName,
            table,
            sourceMap,
            contextCarrier,
            label
          );
        }
        return result;
      };
    }
  });
  return proxy;
}

function instrumentMethod(object, name, als, sourceName, sourceMapGetter) {
  if (!object || typeof object[name] !== 'function') return;
  const original = object[name].bind(object);
  object[name] = (...args) => {
    const label = sourceLabel(new Error().stack, sourceName, sourceMapGetter());
    return als.run({ label, table: name }, () => original(...args));
  };
}

function makeReadOnlyClient({ url, key, sourceName = SERVER_FILE } = {}) {
  if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
  const als = new AsyncLocalStorage();
  const contextCarrier = { active: null, pending: [] };
  const metrics = {
    current: null,
    sourceMap: null,
    setSourceMap(map) {
      this.sourceMap = map || null;
    },
    begin() {
      this.current = { started: performance.now(), queries: [], pendingBodies: 0, waiters: [] };
      return this.current;
    },
    async flush() {
      const current = this.current;
      if (!current || !current.pendingBodies) return;
      await new Promise((resolve) => current.waiters.push(resolve));
    },
    end() {
      const result = this.current || { started: performance.now(), queries: [] };
      result.elapsedMs = performance.now() - result.started;
      this.current = null;
      return result;
    }
  };
  const rawFetch = globalThis.fetch.bind(globalThis);
  const readOnlyFetch = async (input, init = {}) => {
    const method = String(init.method || (input && input.method) || 'GET').toUpperCase();
    if (!READ_METHODS.has(method)) {
      throw new Error(`challenges equivalence refused network method ${method}`);
    }
    const ambient = als.getStore();
    const store = (ambient && ambient.label !== 'server.js:?')
      ? ambient
      : contextCarrier.pending.shift() || contextCarrier.active || ambient ||
        { label: 'server.js:?', table: null };
    const started = performance.now();
    const runMetrics = metrics.current;
    if (runMetrics) runMetrics.pendingBodies++;
    const finish = (bodyRead) => {
      const ended = performance.now();
      if (!runMetrics) return;
      runMetrics.queries.push({
        method,
        table: store.table || queryTable(input),
        label: store.label || 'server.js:?',
        status: response ? response.status : 'ERR',
        bytes: response ? Number(response.headers.get('content-length')) || null : null,
        bodyRead,
        elapsedMs: ended - started,
        startMs: started - runMetrics.started,
        endMs: ended - runMetrics.started
      });
      runMetrics.pendingBodies = Math.max(0, runMetrics.pendingBodies - 1);
      if (!runMetrics.pendingBodies) {
        runMetrics.waiters.splice(0).forEach((resolve) => resolve());
      }
    };
    let response;
    try {
      response = await rawFetch(input, init);
    } catch (error) {
      finish('fetch:error');
      throw error;
    }
    // Consume a clone before returning the original response.  Supabase can
    // then parse the untouched response normally, while this probe measures
    // transport + body completion for GET and HEAD alike without a timer that
    // could fire after the handler has already been measured.
    try {
      await response.clone().text();
      finish('clone.text');
    } catch (error) {
      finish('clone.text:error');
    }
    return response;
  };
  const client = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    global: { fetch: readOnlyFetch }
  });
  const originalFrom = client.from.bind(client);
  client.from = (table) => instrumentBuilder(
    originalFrom(table), als, sourceName, table, metrics.sourceMap, contextCarrier
  );
  if (client.auth && client.auth.admin) {
    instrumentMethod(
      client.auth.admin, 'getUserById', als, sourceName, () => metrics.sourceMap
    );
  }
  return { client, metrics };
}

function buildProgram(source, route, sourceName) {
  const sourceFile = ts.createSourceFile(
    sourceName,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS
  );
  const selectedRoute = findRoute(sourceFile, route);
  const functionDeclarations = sourceFile.statements.filter((statement) =>
    ts.isFunctionDeclaration(statement) && statement.name
  );
  const functions = new Map(functionDeclarations.map((statement) => [
    statement.name.text,
    statement
  ]));
  const variableDeclarations = new Map();
  sourceFile.statements.forEach((statement) => {
    if (!ts.isVariableStatement(statement)) return;
    statement.declarationList.declarations.forEach((declaration) => {
      if (ts.isIdentifier(declaration.name)) {
        variableDeclarations.set(declaration.name.text, declaration);
      }
    });
  });
  const missingConstants = REQUIRED_CONSTANTS.filter((name) =>
    !variableDeclarations.has(name));
  if (missingConstants.length) {
    throw new Error(`production constants missing: ${missingConstants.join(', ')}`);
  }
  const imports = collectRequireBindings(sourceFile);
  const imported = importedLocalNames(imports);
  const selectedVariables = new Set(REQUIRED_CONSTANTS);
  const pendingNames = [...freeNames(selectedRoute.callback), ...REQUIRED_CONSTANTS];
  const seenNames = new Set();
  while (pendingNames.length) {
    const name = pendingNames.pop();
    if (!name || seenNames.has(name)) continue;
    seenNames.add(name);
    if (functions.has(name)) {
      for (const dependency of freeNames(functions.get(name))) pendingNames.push(dependency);
      continue;
    }
    if (!variableDeclarations.has(name) || imported.has(name) || EXTERNAL_NAMES.has(name)) continue;
    selectedVariables.add(name);
    const declaration = variableDeclarations.get(name);
    if (declaration.initializer) {
      for (const dependency of freeNames(declaration.initializer)) pendingNames.push(dependency);
    }
  }
  const snippets = [];
  const snippetSources = [];
  const addSnippet = (text, sourceNode) => {
    snippets.push(text);
    snippetSources.push({ text, sourceLine: lineAt(sourceFile, sourceNode) });
  };
  // The source order keeps const dependencies in their production order.
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) ||
          !selectedVariables.has(declaration.name.text) ||
          imported.has(declaration.name.text) ||
          functions.has(declaration.name.text)) continue;
      if (!declaration.initializer) continue;
      addSnippet(declarationSnippet(declaration, sourceFile), declaration);
    }
  }
  // Include every production function declaration, as opposed to copying a
  // hand-selected helper list.  This is what keeps the harness adaptable when
  // commit 1 moves query stages into a new pure helper.
  for (const statement of functionDeclarations) {
    addSnippet(statement.getText(sourceFile), statement);
  }
  addSnippet(
    `globalThis.__challengeHandler = ${selectedRoute.callback.getText(sourceFile)};`,
    selectedRoute.callback
  );
  const sourceMap = {};
  let generatedLine = 1;
  for (const snippet of snippetSources) {
    const lines = snippet.text.split('\n').length;
    for (let offset = 0; offset < lines; offset++) {
      sourceMap[generatedLine + offset] = snippet.sourceLine + offset;
    }
    generatedLine += lines + 2;
  }
  return {
    sourceFile,
    route: selectedRoute,
    program: snippets.join('\n\n'),
    sourceMap,
    imports,
    line: selectedRoute.line
  };
}

function makeHandler({ source, sourceName, route, client, frozenAt }) {
  const built = buildProgram(source, route, sourceName);
  const virtualParent = gitModuleName(sourceName);
  const sandbox = {
    require: (request) => loadModule(request, sourceName),
    supabase: client,
    supabaseAdmin: client,
    fetch: globalThis.fetch.bind(globalThis),
    console: safeConsole(),
    process: {
      env: process.env,
      cwd: process.cwd(),
      platform: process.platform,
      versions: process.versions
    },
    __dirname: virtualParent
      ? posixPath.dirname(sourceName)
      : path.dirname(sourceName),
    __filename: sourceName,
    Date: makeFrozenDate(frozenAt),
    URL,
    URLSearchParams,
    Buffer,
    setTimeout,
    clearTimeout,
    setImmediate,
    clearImmediate,
    performance
  };
  setImportedBindings(sandbox, built.imports, sourceName);
  vm.createContext(sandbox);
  vm.runInContext(built.program, sandbox, {
    filename: sourceName,
    displayErrors: true
  });
  if (typeof sandbox.__challengeHandler !== 'function') {
    throw new Error(`GET ${route} callback did not initialize`);
  }
  return {
    handler: sandbox.__challengeHandler,
    line: built.line,
    sourceMap: built.sourceMap
  };
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [
      key,
      canonicalize(value[key])
    ]));
  }
  return value;
}

function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

function safeValue(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return `array(${value.length})`;
  if (typeof value === 'object') return `object(${Object.keys(value).length})`;
  if (typeof value === 'string') return `string(${value.length})`;
  return `${typeof value}(${String(value).slice(0, 40)})`;
}

function firstDifference(left, right, prefix = '$') {
  if (Object.is(left, right)) return null;
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right)) return prefix;
    if (left.length !== right.length) return `${prefix}.length`;
    for (let i = 0; i < left.length; i++) {
      const result = firstDifference(left[i], right[i], `${prefix}[${i}]`);
      if (result) return result;
    }
    return prefix;
  }
  if ((left && typeof left === 'object') || (right && typeof right === 'object')) {
    if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return prefix;
    const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])].sort();
    for (const key of keys) {
      if (!(key in left) || !(key in right)) return `${prefix}.${key}`;
      const result = firstDifference(left[key], right[key], `${prefix}.${key}`);
      if (result) return result;
    }
    return prefix;
  }
  return prefix;
}

function valueAtPath(value, pathName) {
  if (pathName === '$') return value;
  const parts = [...pathName.matchAll(/\.([^.[\]]+)|\[(\d+)\]/g)]
    .map((match) => match[1] == null ? Number(match[2]) : match[1]);
  let current = value;
  for (const part of parts) {
    if (current == null) return undefined;
    current = current[part];
  }
  return current;
}

async function invoke(handler, user, metrics, route, sourceMap = null) {
  if (typeof metrics.setSourceMap === 'function') metrics.setSourceMap(sourceMap);
  const requestMetrics = metrics.begin();
  const started = performance.now();
  let status = 200;
  let body;
  let finished = false;
  const response = {
    status(code) {
      status = code;
      return response;
    },
    json(value) {
      body = value;
      finished = true;
      return response;
    },
    send(value) {
      body = value;
      finished = true;
      return response;
    },
    setHeader() {},
    set() {
      return response;
    }
  };
  const req = {
    user,
    method: 'GET',
    path: route,
    originalUrl: route,
    headers: {},
    get() {
      return undefined;
    }
  };
  try {
    await handler(req, response);
  } finally {
    await metrics.flush();
    requestMetrics.handlerMs = performance.now() - started;
  }
  const finishedMetrics = metrics.end();
  if (!finished) throw new Error(`GET ${route} did not send a JSON response`);
  return { status, body, metrics: finishedMetrics };
}

function compareResponses(left, right) {
  if (left.status !== right.status) {
    return { ok: false, reason: `status (${left.status} vs ${right.status})` };
  }
  const oldValue = canonicalize(left.body);
  const newValue = canonicalize(right.body);
  const oldJson = JSON.stringify(oldValue);
  const newJson = JSON.stringify(newValue);
  if (oldJson === newJson) return { ok: true, json: oldJson };
  const pathName = firstDifference(oldValue, newValue);
  return {
    ok: false,
    reason: `${pathName}: ${safeValue(valueAtPath(oldValue, pathName))} vs ${safeValue(valueAtPath(newValue, pathName))}`
  };
}

function metricLines(which, account, run, metrics) {
  const lines = [];
  for (const [index, query] of metrics.queries.entries()) {
    lines.push([
      `${which} ${account} run=${run} query=${index + 1}`,
      query.method,
      query.table,
      query.label,
      `status=${query.status}`,
      query.bytes == null ? 'bytes=?' : `bytes=${query.bytes}`,
      `body=${query.bodyRead}`,
      `ms=${query.elapsedMs.toFixed(1)}`
    ].join(' '));
  }
  const intervals = metrics.queries
    .filter((query) => Number.isFinite(query.startMs) && Number.isFinite(query.endMs))
    .map((query) => [query.startMs, query.endMs])
    .sort((left, right) => left[0] - right[0]);
  let dbUnionMs = 0;
  let unionStart = null;
  let unionEnd = null;
  for (const [start, end] of intervals) {
    if (unionStart === null) {
      unionStart = start;
      unionEnd = end;
    } else if (start > unionEnd) {
      dbUnionMs += unionEnd - unionStart;
      unionStart = start;
      unionEnd = end;
    } else {
      unionEnd = Math.max(unionEnd, end);
    }
  }
  if (unionStart !== null) dbUnionMs += unionEnd - unionStart;
  const dbSpanMs = intervals.length
    ? Math.max(...intervals.map((interval) => interval[1]))
    : 0;
  lines.push([
    `${which} ${account} run=${run}`,
    `queries=${metrics.queries.length}`,
    `handler_ms=${Number(metrics.handlerMs || metrics.elapsedMs).toFixed(1)}`,
    `db_union_ms=${dbUnionMs.toFixed(1)}`,
    `db_span_ms=${dbSpanMs.toFixed(1)}`
  ].join(' '));
  return lines;
}

function fixtureConsole() {
  // The geometry seed logs manifests containing user IDs.  The verifier's
  // output must remain useful in CI without becoming a PII dump.
  return { log() {}, info() {}, warn() {}, error() {} };
}

function fixtureProgram() {
  const source = fs.readFileSync(
    path.resolve(__dirname, '..', 'verify-mobile-geometry.js'),
    'utf8'
  );
  const sourceFile = ts.createSourceFile(
    'verify-mobile-geometry.js',
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS
  );
  const tryStatement = sourceFile.statements.find(ts.isTryStatement);
  if (!tryStatement || !tryStatement.finallyBlock) {
    throw new Error('verify-mobile-geometry.js seed/finally structure changed');
  }
  const marker = source.indexOf('// ── page configs ──');
  if (marker < 0) throw new Error('verify-mobile-geometry.js page-config marker missing');
  const tryStart = tryStatement.getStart(sourceFile);
  const prefix = sourceFile.statements
    .filter((statement) => statement.getStart(sourceFile) < tryStart)
    .filter((statement) => !ts.isImportDeclaration(statement))
    .filter((statement) => !source.slice(statement.getStart(sourceFile), statement.getEnd(sourceFile)).includes(
      'const admin = createClient('))
    .map((statement) => statement.getText(sourceFile))
    .join('\n\n');
  const seedStatements = tryStatement.tryBlock.statements
    .filter((statement) => statement.getStart(sourceFile) < marker)
    .filter((statement) => !/^await login\(/.test(statement.getText(sourceFile).trim()))
    .map((statement) => statement.getText(sourceFile))
    .join('\n\n')
    // VM dynamic-import hooks are intentionally not enabled.  Resolve sharp
    // to an absolute module through the supplied CommonJS require instead.
    .replace(/\(await import\(['"]sharp['"]\)\)\.default/g, "require('sharp')");
  const cleanupStatements = tryStatement.finallyBlock.statements
    .map((statement) => statement.getText(sourceFile))
    .join('\n\n');
  return `
    (async function () {
      ${prefix}
      globalThis.__seedFixture = async function () {
        ${seedStatements}
        return {
          users, creatorId: users.creator.id, memberId: users.member.id,
          loginCreator: async () => {
            await login('creator');
            return users.creator.cookies;
          }
        };
      };
      globalThis.__cleanupFixture = async function () {
        ${cleanupStatements}
      };
    })()
  `;
}

async function startMobileFixture() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for --fixture');
  }
  if (fs.existsSync(FIXTURE_MANIFEST_PATH)) {
    throw new Error(
      `fixture manifest already exists at ${FIXTURE_MANIFEST_PATH}; refusing to touch another owner`
    );
  }
  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false }
  });
  const sandbox = {
    admin,
    createClient,
    mustWrite: importedMustWrite,
    makeCleanup: importedMakeCleanup,
    existsSync: fs.existsSync,
    readFileSync: fs.readFileSync,
    unlinkSync: fs.unlinkSync,
    writeFileSync: fs.writeFileSync,
    require: serverRequire,
    process,
    console: fixtureConsole(),
    __dirname: path.resolve(__dirname, '..'),
    __filename: path.resolve(__dirname, '..', 'verify-mobile-geometry.js'),
    fetch: globalThis.fetch.bind(globalThis),
    Date,
    URL,
    URLSearchParams,
    Buffer,
    setTimeout,
    clearTimeout,
    setImmediate,
    clearImmediate,
    performance
  };
  vm.createContext(sandbox);
  vm.runInContext(fixtureProgram(), sandbox, {
    filename: path.resolve(__dirname, '..', 'verify-mobile-geometry.js'),
    displayErrors: true
  });
  if (typeof sandbox.__seedFixture !== 'function' ||
      typeof sandbox.__cleanupFixture !== 'function') {
    throw new Error('could not initialize geometry fixture harness');
  }
  let cleaned = false;
  try {
    const state = await sandbox.__seedFixture();
    return {
      creatorId: state.creatorId,
      memberId: state.memberId,
      users: state.users,
      loginCreator: state.loginCreator,
      async cleanup() {
        if (cleaned) return;
        cleaned = true;
        await sandbox.__cleanupFixture();
      }
    };
  } catch (error) {
    if (!cleaned) {
      cleaned = true;
      await sandbox.__cleanupFixture().catch(() => {});
    }
    throw error;
  }
}

module.exports = {
  SERVER_FILE,
  SERVER_RELATIVE_PATH,
  FIXTURE_MANIFEST_PATH,
  ROUTES,
  REQUIRED_CONSTANTS,
  sourceAtRef,
  loadModule,
  sourceModuleText,
  runOfflineSelfTest,
  makeReadOnlyClient,
  buildProgram,
  makeHandler,
  invoke,
  canonicalize,
  canonicalJson,
  compareResponses,
  metricLines,
  firstDifference,
  sanitizeUuid,
  fixtureProgram,
  startMobileFixture
};