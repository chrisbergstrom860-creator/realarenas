# Weekly recap runner

The weekly recap runner is a short-lived, second Railway service for the
existing Arenas repository. It generates and delivers the opt-in weekly AI
recap without starting Express or listening on a port. The existing web
service's `railway.json` is intentionally unchanged. The approved handoff is
manual Railway dashboard configuration; there is no checked-in cron config
file.

## Railway service setup (manual UI)

The current Railway docs are unequivocal: Config as Code is legacy; existing
services can keep using it only until 2026-12-01, and **new services cannot opt
into Config as Code**. Therefore Chris must create this second service manually
in the Railway UI after the approved push. Do **not** set the legacy custom
config-path field, even though its exact label is **Railway Config File**; that
field is not a supported mechanism for this new service.

Chris's manual settings, after the service is created:

1. Create a second service from the same repository and `main` branch as the
   web service. Do not create it or apply settings before the approved push.
2. In **Service Settings**, keep **Root Directory** at `/`. Do not set it to
   `artifacts/html-arenas`; the runner needs workspace dependencies installed
   from the repository root.
3. In the build settings, leave the **Builder** at the current default
   **Railpack**. Railway's current docs say new services default to Railpack;
   Nixpacks is a legacy/deprecated builder and must not be selected for this
   new service. Set **Build Command** to the repository's existing no-build
   command:

   ```text
   echo 'No build step: static HTML served by Express'
   ```

   Railpack detects Node and installs dependencies from the repository's
   existing package manifest and lockfile.
4. Set **Start Command** to:

   ```text
   node artifacts/html-arenas/jobs/recaps.js
   ```

5. Set the deploy **Cron Schedule** to:

```text
*/15 * * * *
```

   The schedule is UTC, not the user's local timezone; each user is evaluated
   independently for local Monday 08:00.
6. Set the deploy **Restart Policy** to **Never**. Leave **Healthcheck Path**
   unset, do not add a port/listener setting, and do not add a restart loop.
   Railway skips a tick when the previous cron execution is still active; the
   runner also uses its database leases.
7. Leave `RECAP_RUNNER_ENABLED` unset. An unset kill switch is deliberately off
   while the service is being created. It may be set to the exact value `true`
   only when the owner is ready to arm the service.

No Railway CLI `config apply`, IaC apply, environment-variable write, or other
live operation is part of this change. Chris performs the manual service setup
only after the push is approved. The settings above are the functional
configuration; no JSON file is being used as a fallback or presented as
supported new-service Config as Code.

## Why there is no `.railway/railway.ts` in this change

Railway's supported replacement is Infrastructure as Code (IaC), authored in a
project-level `.railway/railway.ts` and evaluated by the Railway CLI. It cannot
be used safely here under the task's constraints:

- Railway's IaC guide requires the matching `railway` package (`npm install
  railway`) for `plan`/`apply`; adding that SDK would violate the no-new-
  dependencies constraint.
- IaC is one project/environment graph, not an isolated per-service config
  file. The existing web service is still managed by the root `railway.json`;
  Railway says a service cannot be managed by both systems and blocks a plan
  until the Config as Code service is migrated.
- Migration requires reviewing and applying a CLI plan, and the guide removes
  or clears the old Config as Code source. That would alter the existing web
  service behavior and violate the manual-create/no-live-operations
  constraints.

Accordingly, no `.railway/railway.ts` or SDK dependency is added. The manual
settings above are the only safe isolated handoff for Chris. The existing root
`railway.json` remains untouched.

Official references:

- [Railway Cron Jobs](https://docs.railway.com/cron-jobs) — cron service
  lifecycle, skipped overlapping executions, five-field syntax, and UTC
  scheduling.
- [Infrastructure as Code](https://docs.railway.com/infrastructure-as-code) —
  current IaC replacement, Config as Code cutoff, one project-level authoring
  file, migration workflow, and the prohibition on managing one service with
  both systems.
- [Infrastructure as Code reference](https://docs.railway.com/infrastructure-as-code/reference)
  — `service(...)`, build/start settings, and project-level authoring model.
- [Railway CLI config](https://docs.railway.com/cli/config) — the SDK
  requirement and `config migrate`/`plan`/`apply` workflow.
- [Using Config as Code](https://docs.railway.com/config-as-code) — legacy
  status, existing-service cutoff, and why the custom **Railway Config File**
  field is not used for this new service.
- [Railway Build Configuration](https://docs.railway.com/builds/build-configuration)
  — the **Railway Config File** setting is independent of **Root Directory**
  for legacy services, while build context and commands remain service
  settings for the manual handoff.
- [Railpack](https://docs.railway.com/builds/railpack) — current default
  builder, Node dependency detection, and zero-configuration build behavior.
- [Railway Builds guide](https://docs.railway.com/guides/builds) — identifies
  Nixpacks as the legacy/deprecated builder.
- [Railway Restart Policy](https://docs.railway.com/deployments/restart-policy)
  — the service-setting dropdown's **Never** option.

## Required environment variable names

Set these names on the recap service using the existing provider, email,
session, and canonical-link integrations. This list intentionally contains
names only; never print or paste secret values into this document or logs.
On Railway, the native Anthropic key is required; the Replit proxy pair is
development-only.

```text
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
ANTHROPIC_API_KEY
RESEND_API_KEY
SESSION_SECRET
PUBLIC_BASE_URL
```

The existing provider code recognizes these names only for a local/Replit
proxy environment; they are not substitutes for `ANTHROPIC_API_KEY` on
Railway:

```text
AI_INTEGRATIONS_ANTHROPIC_API_KEY
AI_INTEGRATIONS_ANTHROPIC_BASE_URL
```

The kill switch is separate from the credentials above:

```text
RECAP_RUNNER_ENABLED
```

Missing or any value other than `true` means disabled: the process logs the
disabled state, makes no database call, and exits 0. Do not set this variable
when first creating the service. The runner does not need `PORT`, because it
never starts the web server.

## What one tick does

Once armed, Railway starts one process every fifteen minutes. The runner:

1. deletes expired weekly recaps and records the deletion count;
2. finds bounded, eligible Pro users whose local completed week has passed
   Monday 08:00, then generates and stores complete recaps using the existing
   database lease;
3. sends pending recap emails from their immutable delivery snapshots; and
4. emits one final structured summary line. (`--send-emails-only` skips
   retention and generation, and processes only email work.)

The hard wall-clock cap is five minutes. After four minutes the runner stops
claiming new users; in-flight work finishes or is left for a later tick through
the lease. The CLI watchdog includes elapsed process startup time and reserves
one second of headroom, so it fires just before the five-minute boundary.
A normal completion, including a disabled kill switch, exits 0.
Missing startup configuration exits 2. An infrastructure failure, uncaught
exception, or unhandled rejection exits 1 so Railway shows the run as failed.
Provider/validation failures are recorded per user and do not turn a healthy
batch into a retry loop.

## Reading the summary line

In the recap service's Railway logs, find the single final JSON line for the
tick. It contains the tick ID, UTC start time, duration, counts, retention
result, and accumulated provider cost:

```json
{
  "event": "weekly_recap_tick_summary",
  "kind": "recap",
  "tick_id": "…",
  "started_at": "…",
  "duration_ms": 0,
  "eligible": 0,
  "generated": 0,
  "generation_failed": 0,
  "emails_sent": 0,
  "emails_skipped": 0,
  "emails_failed": 0,
  "retention_deleted": 0,
  "provider_cost_usd": 0
}
```

Use `tick_id` to group one invocation. Use each per-user
`correlation_id` and its reason to investigate a failed generation or email;
do not infer a failure from an empty eligible count. `provider_cost_usd`
is the sum of the provider usage recorded during that tick, not a billing
authorization or a secret.

## Manual runs

Run these from the repository root. Manual runs must explicitly arm the
process for that invocation; this does not change the Railway service's
kill-switch variable:

```bash
RECAP_RUNNER_ENABLED=true node artifacts/html-arenas/jobs/recaps.js
RECAP_RUNNER_ENABLED=true node artifacts/html-arenas/jobs/recaps.js --now 2026-09-14T08:00:00.000Z
RECAP_RUNNER_ENABLED=true node artifacts/html-arenas/jobs/recaps.js --user-id <user-uuid>
RECAP_RUNNER_ENABLED=true node artifacts/html-arenas/jobs/recaps.js --dry-run
RECAP_RUNNER_ENABLED=true node artifacts/html-arenas/jobs/recaps.js --send-emails-only
RECAP_RUNNER_ENABLED=true node artifacts/html-arenas/jobs/recaps.js --send-emails-only --dry-run
```

`--now` takes an ISO timestamp and controls deterministic eligibility/context
evaluation. `--user-id` targets one UUID. `--dry-run` validates and previews
without claiming, storing, notifying, sending, or running retention.
`--send-emails-only` skips AI generation and processes generated recap email
work; adding `--dry-run` previews it without delivery. Do not use a broad
manual run as a way to retry one failed user.

## When attempts reach 3

The generation `attempts` counter is capped at 3. A generation row at
`attempts = 3`, or an email row at terminal `email_status = failed` after
three email attempts, gets a warning with its correlation ID and reason and
is not silently retried by the next tick.

For either case:

1. Locate the warning and its correlation ID in the recap service logs.
2. Inspect the corresponding `weekly_recaps` row, its failure reason/status,
   provider usage, and the surrounding infrastructure/provider error. Check
   database reachability, provider configuration/quota, the user's current
   Pro/recap/email eligibility, and the recipient address as applicable.
3. Preserve the failed row and its evidence while diagnosing. Do **not** reset
   attempts, delete/reinsert the row, or launch blind retries.
4. For a generation failure, fix and document the provider, validation, or
   data cause, then obtain an owner-approved, targeted remediation through the
   normal lease/claim path. Never regenerate a stored recap merely to resend
   it.
5. For a terminal email failure, preserve the immutable
   `findings.emailDelivery` snapshot, exact payload, recipient, and
   idempotency key. Correct the delivery problem first; do not rebuild the
   snapshot or reset email attempts by hand. Escalate for a controlled,
   idempotent retry if one is approved.

This preserves auditability and prevents either a bad provider response or a
temporary outage from turning into duplicate AI generation or duplicate email
delivery.