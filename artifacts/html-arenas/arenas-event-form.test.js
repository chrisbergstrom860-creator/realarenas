const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, 'html/arenas-event-form.js'), 'utf8');

function attrsFrom(markup) {
  const attrs = {};
  markup.replace(/([\w-]+)(?:="([^"]*)")?/g, (_, name, value) => {
    attrs[name] = value === undefined ? '' : value;
    return _;
  });
  return attrs;
}

class FakeElement {
  constructor(tag, attrs = {}, value = '') {
    this.tagName = tag.toUpperCase();
    this.attrs = attrs;
    this.id = attrs.id || '';
    this.value = value;
    this.textContent = '';
    this.style = {};
    this.listeners = {};
    this.dataset = {};
  }
  addEventListener(type, fn) {
    (this.listeners[type] || (this.listeners[type] = [])).push(fn);
  }
  dispatchEvent(event) {
    event.target = this;
    (this.listeners[event.type] || []).forEach((fn) => fn(event));
  }
  getAttribute(name) {
    return Object.prototype.hasOwnProperty.call(this.attrs, name) ? this.attrs[name] : null;
  }
}

class FakeForm extends FakeElement {
  constructor() {
    super('form');
    this.byId = {};
  }
  set innerHTML(html) {
    this.html = html;
    this.byId = {};
    const add = (tag, rawAttrs, value) => {
      const attrs = attrsFrom(rawAttrs);
      if (!attrs.id) return;
      this.byId[attrs.id] = new FakeElement(tag, attrs, value);
    };
    html.replace(/<input\b([^>]*)>/g, (_, raw) => {
      const attrs = attrsFrom(raw);
      add('input', raw, attrs.value || '');
      return _;
    });
    html.replace(/<textarea\b([^>]*)>([\s\S]*?)<\/textarea>/g, (_, raw, value) => {
      add('textarea', raw, value);
      return _;
    });
    html.replace(/<select\b([^>]*)>([\s\S]*?)<\/select>/g, (_, raw, options) => {
      const selected = options.match(/<option\b([^>]*)selected[^>]*>([\s\S]*?)<\/option>/);
      const first = options.match(/<option\b([^>]*)>([\s\S]*?)<\/option>/);
      const option = selected || first;
      const optionAttrs = option ? attrsFrom(option[1]) : {};
      add('select', raw, option ? (optionAttrs.value !== undefined ? optionAttrs.value : option[2]) : '');
      return _;
    });
    html.replace(/<div\b([^>]*)>/g, (_, raw) => {
      add('div', raw, '');
      return _;
    });
  }
  get innerHTML() {
    return this.html;
  }
  querySelector(selector) {
    if (selector[0] === '#') return this.byId[selector.slice(1)] || null;
    return null;
  }
  querySelectorAll() {
    return [];
  }
}

function loadModule() {
  const requests = [];
  const document = {
    createElement(tag) {
      assert.equal(tag, 'form');
      return new FakeForm();
    }
  };
  const window = {
    BASE: '',
    ARENAS_SPORTS: [{ id: 'running', label: 'Running', emoji: 'R' }]
  };
  const context = {
    window,
    document,
    location: { pathname: '/html/arenas-events.html' },
    fetch(url, options) {
      requests.push({ url, options });
      return new Promise(() => {});
    },
    FormData,
    Date,
    console
  };
  vm.runInNewContext(source, context);
  return { api: window.arenasEventForm, requests };
}

function build(api, context, mode, event = {}) {
  const form = api.build({
    prefix: context + '-' + mode,
    context,
    mode,
    clubId: 'club-1',
    event,
    clubs: [],
    following: [],
    toasts: { created: 'Created' },
    onSuccess() {}
  });
  if (mode === 'create' && context === 'events-page') {
    form.el.querySelector('#' + context + '-' + mode + '-sport').value = 'running';
  }
  return form;
}

const contexts = [
  ['events-page', 'create'],
  ['events-page', 'edit'],
  ['club-dashboard', 'create'],
  ['club-dashboard', 'edit']
];

test('shared create/edit forms expose limits and live counters', () => {
  const { api } = loadModule();
  for (const [context, mode] of contexts) {
    const prefix = context + '-' + mode;
    const form = build(api, context, mode, {
      id: 'event-1',
      title: 'Old title',
      location: 'Old location',
      description: 'Old description',
      date: '2030-01-02T07:00:00.000Z'
    }).el;
    const title = form.querySelector('#' + prefix + '-title');
    const location = form.querySelector('#' + prefix + '-location');
    const description = form.querySelector('#' + prefix + '-desc');
    assert.equal(title.getAttribute('maxlength'), '80', prefix + ' title limit');
    assert.equal(location.getAttribute('maxlength'), '120', prefix + ' location limit');
    assert.equal(description.getAttribute('maxlength'), '500', prefix + ' description limit');

    title.value = 'x'.repeat(37);
    title.dispatchEvent({ type: 'input' });
    assert.equal(form.querySelector('#' + prefix + '-title-count').textContent, '37/80');
    location.value = 'x'.repeat(42);
    location.dispatchEvent({ type: 'input' });
    assert.equal(form.querySelector('#' + prefix + '-location-count').textContent, '42/120');
    description.value = 'x'.repeat(499);
    description.dispatchEvent({ type: 'input' });
    assert.equal(form.querySelector('#' + prefix + '-description-count').textContent, '499/500');
  }
});

test('boundary values submit, while scripted over-limit values never fetch', () => {
  for (const [context, mode] of contexts) {
    const { api, requests } = loadModule();
    const prefix = context + '-' + mode;
    const form = build(api, context, mode, {
      id: 'event-1',
      title: 'Old title',
      location: 'Old location',
      description: 'Old description',
      date: '2030-01-02T07:00:00.000Z'
    });
    form.el.querySelector('#' + prefix + '-title').value = 't'.repeat(80);
    form.el.querySelector('#' + prefix + '-location').value = 'l'.repeat(120);
    form.el.querySelector('#' + prefix + '-desc').value = 'd'.repeat(500);
    form.submit();
    assert.equal(requests.length, 1, prefix + ' accepts exact boundaries');

    form.el.querySelector('#' + prefix + '-title').value = 't'.repeat(81);
    form.submit();
    assert.equal(requests.length, 1, prefix + ' blocks scripted over-limit title');
    assert.equal(
      form.el.querySelector('#' + prefix + '-error').textContent,
      'Title must be 80 characters or less.'
    );
  }
});

test('legacy over-limit edit prefills remain intact and are blocked unchanged', () => {
  for (const context of ['events-page', 'club-dashboard']) {
    const { api, requests } = loadModule();
    const prefix = context + '-edit';
    const oldTitle = 't'.repeat(81);
    const oldLocation = 'l'.repeat(121);
    const oldDescription = 'd'.repeat(501);
    const form = build(api, context, 'edit', {
      id: 'legacy-event',
      title: oldTitle,
      location: oldLocation,
      description: oldDescription,
      date: '2030-01-02T07:00:00.000Z'
    });
    assert.equal(form.el.querySelector('#' + prefix + '-title').value, oldTitle);
    assert.equal(form.el.querySelector('#' + prefix + '-location').value, oldLocation);
    assert.equal(form.el.querySelector('#' + prefix + '-desc').value, oldDescription);
    assert.equal(form.el.querySelector('#' + prefix + '-title-count').textContent, '81/80');
    assert.equal(form.el.querySelector('#' + prefix + '-location-count').textContent, '121/120');
    assert.equal(form.el.querySelector('#' + prefix + '-description-count').textContent, '501/500');
    form.submit();
    assert.equal(requests.length, 0);
  }
});