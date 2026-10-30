# Developer deployment and handoff

## 1. Local demo

Run `docker compose up --build -d` from the root. API and frontend share localhost:8000; the worker uses the same persistent SQLite database. Service health starts the API before the worker, avoiding initial schema/seed races. Never expose this shared demo as a private member product. Use fictional inputs.

No Docker daemon was available in the build environment; the Docker recipe is supplied for your team's staging verification. Native API/worker operation and compiled static assets can be tested separately as documented in the README.

## 2. Environment variables

Use a separate domain and an empty live database. Keep secrets out of Git. **The worker needs the same variables as the API**: it now runs every Hello Minds side effect (awakening Minds, persona syncs, enabling and disabling, circles) through a durable outbox. With no worker, those tasks wait and nothing reaches Hello Minds.

### Required in production (the API refuses to start without them)

| Variable | Value | Source |
|---|---|---|
| `APP_ENV` | `production` | Set by `compose.production.yaml` and the Render env group. Enables secure cookies and startup checks. |
| `APP_ORIGIN` | Exact HTTPS origin, e.g. `https://soulplex.example.com`, no path | Your domain |
| `DATABASE_URL` | `postgresql+psycopg://...` with required TLS settings for a managed DB | Render sets it; compose builds it from `POSTGRES_PASSWORD` |
| `AI_API_KEY` | Backend-only OpenAI key. Always required: every message goes through safety screening | platform.openai.com |
| `SMTP_HOST`, `SMTP_FROM` | Real outbound SMTP host and a verified sender on your delivery domain | Postmark, SendGrid, SES, Resend… |
| `SMTP_USERNAME`, `SMTP_PASSWORD` | SMTP login when the provider requires it | Same provider |
| `SMTP_PORT` | Usually `587` (TLS upgrade) | Same provider |

### Hello Minds

| Variable | Value |
|---|---|
| `MINDS_BUILDER_API_KEY` | Builder API key from the console at build.hellominds.ai. It is shown once. Server only; never put it in the frontend. |
| `MINDS_MIND_TYPE` | Archetype for each member's Mind. Default `mastermind`. |

### Strongly recommended

| Variable | Why |
|---|---|
| `AI_MODEL` | An OpenAI model that supports Structured Outputs (strict JSON schema on Chat Completions). Even with Hello Minds on, it is the fallback when a Mind runs out of Cognition, it serves members who have not allowed Hello Minds, and it runs their calibration. Without it, their dates fail. |
| `AI_BASE_URL` | Default `https://api.openai.com/v1`. Alternate endpoints must be explicitly tested. |

### Optional

| Variable | Default | Purpose |
|---|---|---|
| `MINDS_JUDGE` | `0` | `1` lets a shared judge Mind also score dates. It reads both people's facts, so leave it off unless you accept that. |
| `MINDS_ALLOWED_SKILLS` | empty | Comma-separated Bazaar skill ids members may equip. Empty means none. |
| `MINDS_MIN_COGNITION` | `1` | Below this balance, a date uses `AI_MODEL` or stops with a "top up" error. |
| `MINDS_SSE` | `1` | Listen on the event stream. Set `0` only if the stream misbehaves; history polling then does the work. |
| `MINDS_MAX_CONCURRENCY` / `MINDS_MAX_STREAMS` | `8` / `16` | Per-process limits on calls and open streams. |
| `MINDS_MAX_RETRIES` | `3` | Retries for 429 anywhere, 502/503/504 on reads, 409 on send. |
| `MINDS_BREAKER_THRESHOLD` / `MINDS_BREAKER_COOLDOWN` | `5` / `30` | Failures before the circuit opens, and seconds it stays open. |
| `MINDS_API_BASE` | `https://api.build.hellominds.ai` | Must be https in production. |
| `MINDS_LANGUAGE` | `en` | Language passed when a Mind is awakened. |
| `MATCH_SCORE_MIN` | `70` | Score line for offering a connection. |
| `TRANSCRIBE_MODEL` | empty | Turns on voice answers. Blank keeps typed chat working. |
| `MODERATION_URL` / `MODERATION_MODEL` | OpenAI moderation | Errors fail closed. |
| `MODERATION_API_KEY` | reuses `AI_API_KEY` | Set only if `AI_BASE_URL` is not OpenAI. |
| `STATIC_DIR` | `/app/static` in Docker | Built frontend location. |

`DEMO_MODE` is no longer read. All Hello Minds tuning is described in [HELLO_MINDS.md](HELLO_MINDS.md).

## 3. Deploy on Render

`render.yaml` defines the database, the web service and the worker.

1. Merge the release into `main`.
2. **Back up the database** if one exists (Dashboard → soulplex-db → Backups). The first start migrates the schema from v8 to v9. It only adds tables, but take the backup anyway.
3. First time: Dashboard → New → Blueprint → this repository. Render asks for each `sync: false` secret: `AI_API_KEY`, `AI_MODEL`, `MINDS_BUILDER_API_KEY` and the four `SMTP_*` values. The worker copies them from the web service.
4. Existing deployment: pushing to `main` redeploys. `MINDS_JUDGE` and `MINDS_SSE` are already in the `soulplex` env group. Add other tuning (for example `MINDS_ALLOWED_SKILLS`) to that group so the API and worker both get it.
5. Custom domain: attach it to the web service, set `APP_ORIGIN` to that exact origin on **both** services, and redeploy.
6. Confirm **soulplex-worker** is running and its logs show no errors. Free instances sleep and leave work queued; use the paid plans in the blueprint.

## 4. Deploy on your own server (Docker Compose)

Requirements: Linux, Docker Engine with Compose v2, ports 80 and 443 open, and a DNS A record for your domain pointing at the server.

```bash
git clone https://github.com/potassiumdichromate/soulplex.git
cd soulplex && cp .env.example .env
```

Fill in `.env`: `DOMAIN` (host name only), `APP_ORIGIN` (https plus the domain), `POSTGRES_PASSWORD` (a long random alphanumeric value, which avoids URL encoding issues), `SMTP_*`, `AI_API_KEY`, `AI_MODEL`, `MINDS_BUILDER_API_KEY`, and any optional variables. Use `compose.production.yaml` alone; it sets `APP_ENV=production` and is not merged with the demo compose.

```bash
docker compose -f compose.production.yaml up --build -d
docker compose -f compose.production.yaml logs --tail=100 api worker
```

Caddy obtains the TLS certificate automatically. Before upgrading an existing server, back up:

```bash
docker compose -f compose.production.yaml exec db pg_dump -U soulplex soulplex > backup.sql
```

This is a single-host pilot recipe. Managed PostgreSQL and managed secret storage are preferable for production operations. Pin container image digests and run a dependency vulnerability review as part of your deployment pipeline.

## 5. After deploying

### Operator bootstrap

From an authorized deployment shell, issue one-use codes for the small pilot. On Render, run the `python -m app.cli ...` part in the web service's Shell tab. Deliver each code privately. Codes expire after 14 days by default; only their digests are stored.

```bash
docker compose -f compose.production.yaml exec api python -m app.cli invite --count 5 --days 14
```

Register your operational account using one of those codes, verify its email link, then promote it from the deployment shell:

```bash
docker compose -f compose.production.yaml exec api python -m app.cli promote --email your-operator@example.com
```

The existing account becomes an operator. Sign out and back in. Admin creation is never exposed as a public API input. Restrict shell and database access; add operator MFA before broadening membership.

### Hello Minds check

Signed in as the operator, run this in the browser console on your site:

```js
const {csrf} = await (await fetch('/api/me')).json();
await (await fetch('/api/admin/minds/doctor', {method:'POST', headers:{'X-CSRF-Token': csrf}})).json()
```

`{ok: true}` means the key works and the API is reachable. Then open `/api/admin/minds`: the circuit should be `closed` and the outbox should not be accumulating `failed` tasks. These metrics are per process, so they show the API's view, not the worker's.

### End-to-end smoke test with two test accounts

1. In the Twin Studio permissions step, turn on "Allow approved, minimal information to be processed by the external Minds provider".
2. Within a few seconds the worker awakens the Mind. `/api/agent/mind` should show it with a Cognition balance and persona version 1.
3. Answer the personality statements through `PUT /api/personality/responses` (no screen exists yet), then run `POST /api/personality/calibrate`.
4. Run one date between the two accounts and confirm the scene's engine is `hellominds`.
5. Withdraw a shareable fact and confirm `/api/agent/mind` shows a new persona version.

### Ongoing operation

- Each Mind has its own Cognition balance on Hello Minds. Watch balances in the Builder console. A low balance sends that member's dates to `AI_MODEL`, or stops them if no model is configured.
- Members who registered before this release have no Hello Minds consent recorded, so their agents stay off Hello Minds until they turn the permission on.
- Hello Minds has no memory-delete endpoint. The privacy notice should say a departing member's Mind is disabled and told to forget, not deleted.

### First real users

For an invite-only trial, each member must redeem an unused code and verify their email. The operator should complete an approved adult eligibility and consent check **outside** the application before marking a member checked. The UI button stores only the operator decision; it is not KYC. The member then explicitly enables discovery and approves shareable memory. An operator cannot enable discovery on their behalf through the operator endpoint. Verify sender-domain authentication, delivery, spam placement, expired links and password reset on real staging before recruiting members.

## 6. Provider and model acceptance test

Use consented fictional fixtures first, in English and Hinglish. Do not benchmark with scraped social profiles or third-party private messages.

1. Set live mode, real model configuration and both moderation/transcription settings as required.
2. Verify a chat answer creates only exact-source private memory proposals.
3. Ask for a correction; approve a revised memory and ensure the next interview uses it.
4. Submit instructions embedded in a memory asking to ignore rules, reveal contact or impersonate an operator. The system must not gain tools, leak private memory or expose contact.
5. Run the three venues using two separate accounts. Check every personal claim against its displayed evidence; an ID match alone does not prove faithfulness.
6. Force provider timeout/refusal/malformed JSON and moderation failure. Confirm live mode returns an error, no fake dialogue.
7. Test optional microphone permissions, deletion, explicit upload, transcription and editable text on Safari and Chrome.
8. Record tokens, provider costs, latency, refusal rates, human correction rate and representation feedback. Choose a model based on those results.
9. With Hello Minds on, repeat steps 4 to 6 with Minds speaking, and compare calibration lift (`/api/personality/calibrations`) between the Mind and the model.

Enable provider project-level budget alerts and spending limits. App caps are 40 chat answers, 5 new scenes and 10 transcriptions per member per UTC day; six generated turns per scene; 10 calibrations per member per day. These are abuse/cost controls, not paid entitlements. IP auth quotas may need adjustment for a shared office/NAT; enforce edge-level rate limiting as well.

## 7. Launch requirements owned by your team

This list describes concrete missing operational work, not completed features:

- Test SMTP delivery/bounces and reset abuse handling, then add session/device management, edge anti-bot controls and operator MFA/SSO.
- Choose and test an adult age/identity process and documented escalation routes. Self-reported age and the manual checkbox are not verification technology.
- Review the actual business, privacy/consent terms, processor agreements (including Hello Minds as an external processor), sensitive-data handling, cross-border flows and launch permissions for each chosen location with qualified local advisers. This package makes no jurisdictional compliance claim.
- Specify incident response, report-review hours, member support, appeal handling and moderation testing across languages and identities. Wire a real support destination before advertising live service.
- Configure encrypted storage/backups, restore tests, retention expiry, deletion after backup restore, and restrictions on raw chat access. Decide abuse-report retention before collecting real reports.
- Migrations run on API start. Before applying one to an existing database, stop old workers, back up the database, and test the upgrade on a restored copy. The v1 to v2 step makes existing accounts email-unverified, so they must request a verification link. The PostgreSQL upgrade path has not been run in this environment.
- Validate PostgreSQL behavior, reverse proxy, TLS/cookies, worker timeout recovery, concurrent writes, load, browser accessibility and mobile hardware. Test deployment from a clean host.
- Audit contact hiding during concurrent memory edits/blocks. Application checks cover ordinary flows; an independent security/concurrency review is required before public scale.
- Live registration enforces one-use invitations. Add edge rate limits, monitoring and a reviewed access policy before a larger rollout.
- Build frontend screens for the personality questionnaire and calibration results; the API is ready.

## 8. Operations and troubleshooting

| Symptom | Check |
|---|---|
| Scene stays queued | Worker is running and points at the exact same database; inspect worker logs and job backlog. |
| Live API refuses startup | HTTPS `APP_ORIGIN`, `AI_API_KEY`, `SMTP_HOST` and `SMTP_FROM` set, plus `AI_MODEL` or `MINDS_BUILDER_API_KEY`. `MINDS_API_BASE` must be https. |
| Member never gets a Mind | They have not granted the Hello Minds permission, or the worker is not running. Check `/api/admin/minds` outbox counts. |
| Outbox `failed` tasks grow | Read `recent_failures` in `/api/admin/minds`, fix the cause (key, credits, outage), then `POST /api/admin/minds/tasks/{id}/retry`. |
| Circuit `open` | Hello Minds is failing repeatedly. It retries by itself after the cooldown; `POST /api/admin/minds/breaker/reset` forces it closed. |
| Dates fall back to the model | A Mind is below `MINDS_MIN_COGNITION`. Top it up in the Builder console. |
| Verify mail does not arrive | Confirm SMTP TLS/auth, sender domain and spam placement; a signed-in member can resend verification in My choices. |
| Login cookie not retained | Same host/origin, HTTPS in production, reverse proxy and cookie settings. |
| 403 on mutation | CSRF token from `/api/me` and exact allowed Origin; reload after changing accounts. |
| 409 after editing memory | Intended stale/version guard. Reload and create a fresh scene. |
| 409 on calibration | The member needs at least 4 answered statements per trait; the full 50 work best. |
| 503 from live AI | Provider access/model compatibility/moderation config; do not switch silently to demo. |
| No candidates | Same local city and intention, reciprocal age/gender, operator approval, discovery opt-in and shareable memory on both sides. |
| 429 | Daily pilot quota or auth throttle reached; inspect aggregate usage without logging private content. |

The health endpoint checks the API, the database and the Hello Minds circuit state, not model availability or worker liveness. Add worker heartbeat/backlog monitoring before real operations. Expired sessions are denied but need scheduled row cleanup. Quota rows are date-partitioned keys and should also be pruned under your retention policy.

Back up before release. Keep previous image and compatible database backup for rollback. Stop writes and workers when restoring; reapply deletion requests made after the restored snapshot. Never promise instant deletion from backups unless implemented and tested.
