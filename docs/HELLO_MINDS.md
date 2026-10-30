# Hello Minds integration and OCEAN calibration

Soulplex gives each consenting member a **Hello Mind** (Animoca Brands' agent platform, build.hellominds.ai). That Mind speaks for them on dates and in their private chat. This document covers how the integration works, how the Big Five (OCEAN) calibration measures the twin, and how to run it in production.

## What changed from the first integration

| Area | Before | Now |
|---|---|---|
| Consent | Minds were awakened at registration and sign-in. No member had agreed to an external processor yet. | A Mind exists only after an explicit `allow_external_minds` grant. Revoking disables it. Deleting the account disables it and removes it from partners' circles. |
| Teaching | Each approved fact was sent as a fire-and-forget background message. Edits and withdrawals never reached the Mind. | One compiled, hashed **persona** per person, sent through a durable outbox. Each version tells the Mind to forget earlier Soulplex facts. It is re-sent only when it changes. |
| Replies | History was polled every 2 s for up to 90 s per line. | The client listens on the SSE event stream before sending, so a fast reply is not missed. History polling remains as the fallback. |
| Resilience | A new HTTP client per call. No retries, Retry-After or rate-limit handling. | A pooled client per event loop with bounded concurrency. Retries use jitter and honour `Retry-After`. A circuit breaker opens on repeated failures. Posts that may have reached the server are never re-sent. |
| Credits | Not checked. A Mind with no Cognition just timed out mid-date. | Balances are checked before a date. The date falls back to `AI_MODEL`, or stops with a clear "top up Cognition" error. |
| Judge | One shared judge Mind read every couple's facts, and its number replaced the whole assessment. It was parsed with a loose regex. | Off by default (`MINDS_JUDGE=0`). When on, its score must be a strict JSON integer, and it is blended 50/50 with the explained assessment. |
| Mind names | The name included part of the internal user id. | The display name plus a random suffix. The name is checked with `GET /v1/minds/check/name` first. |
| Circles | Linked on mutual accept by a background task that was lost on restart. | Linked through the outbox on mutual accept. Unlinked on block or account deletion. |
| Tools | None. | Members can equip only Bazaar skills on the operator's `MINDS_ALLOWED_SKILLS` list. |

## Wire contract

The shapes come from the published source of `@animocabrands/minds-client-lib@0.1.7`. HelloMinds has not published an OpenAPI spec. The full list is in the docstring of `backend/app/minds.py`.

| Detail | Value |
|---|---|
| Base URL | `https://api.build.hellominds.ai` |
| Auth header | `X-Api-Key` |
| Response envelope | None |
| SSE stream | `GET /v1/messaging/events?alias=`, where each `data:` payload is a `MessageRecord` |
| Errors | `{error: {type, message}}` or `{error: "code"}` or `{message}`, read in the same order as the client library |

Three behaviours differ from the client library on purpose:

* **Reply detection** uses the set of fingerprints seen before sending. The library compares fingerprints as strings, and that assumes an undocumented ordering.
* **429 is retried.** The library never reads `Retry-After`.
* **The SSE parser handles CRLF.** The library splits only on `\n\n`.

## Components

* **`backend/app/minds.py`**: the HTTP client, Mind lifecycle (awaken, enable, credits, usage, skills, circles), messaging (`say`, which streams first and then polls), and date, chat and judge prompts.
* **`backend/app/mind_sync.py`**: persona compilation and the `mind_tasks` outbox. Task kinds are `awaken`, `sync_persona`, `set_enabled`, `link_pair`, `unlink_pair` and `retire`. A pending task coalesces per person and kind. Failures retry with exponential backoff and jitter, up to 8 attempts. A task stuck in `running` for 10 minutes is reclaimed.
* **`backend/app/worker.py`**: runs scenes, then drains the outbox on every loop.
* **`backend/app/minds_api.py`**: member and operator routes.

### Member routes

| Route | What it does |
|---|---|
| `GET /api/agent/mind?usage=1` | Mind status, Cognition balance, persona version and sync state, and optional usage by tool. |
| `GET` and `PUT /api/agent/mind/skills` | Lists and equips skills from the operator allowlist only. |

### Operator routes (admin role)

| Route | What it does |
|---|---|
| `GET /api/admin/minds` | Config, metrics (latency, retries, stream vs poll replies, timeouts, circuit state), and outbox counts with recent failures. |
| `POST /api/admin/minds/doctor` | Checks reachability and the key. Sends no personal data. |
| `POST /api/admin/minds/tasks/{id}/retry` | Re-queues a failed task. |
| `POST /api/admin/minds/resync` | Re-sends every persona, for example after a prompt change. |
| `POST /api/admin/minds/breaker/reset` | Closes the circuit breaker. |

The metrics are per process. The API and the worker each keep their own, and `/api/admin/minds` shows the API's.

## OCEAN (Big Five) self-report

**Instrument.** The 50-item IPIP Big-Five Factor Markers (Goldberg, 1992), with the 20-item Mini-IPIP subset (Donnellan et al., 2006). Both are public domain and come from ipip.ori.org. Answers use the standard 1–5 accuracy scale. Members can answer the 20-item mini form first and the other 30 statements later.

**Scoring.** Each trait gets a keyed mean, reported as a POMP score from 0 to 100.

* These are **not percentiles**. No norms ship with this code.
* Each score has an approximate range, built from the spread of the member's own answers. It is widened for short forms.
* A trait needs at least 3 answered statements before it gets a score.
* A model never writes or edits a score.

**Quality checks.** These flag a profile for the member to review.

* The same answer on 90% or more of statements.
* Contradictory answers to opposite statements on two or more traits, for example agreeing with both "Am the life of the party" and "Keep in the background".
* A median time under 0.8 s per statement.

A flagged profile does not shape the twin until the member retakes it or confirms it (`POST /api/personality/confirm`).

**Scopes.** The member chooses one with `PUT /api/personality/scope`.

| Scope | Effect |
|---|---|
| `private` | Only the member sees the profile. |
| `twin` (default) | The profile becomes tone guidance for the Mind and the model. It is never stated as a fact. |
| `matching` | Also adds conversation notes to date reflections. Communication moves by at most 4 points. |

In date reflections, neuroticism is never compared and personality never gates a match. Research finds personality similarity is a weak predictor of relationship outcomes, and the reflection says so.

### Personality routes

| Route | What it does |
|---|---|
| `GET /api/personality/inventory?form=mini\|full` | Returns the statements. Public, no sign-in. |
| `PUT /api/personality/responses` | Saves answers and rescores the profile. |
| `GET /api/personality` | Returns the profile, with scores, ranges, quality, scope and style hints. |
| `PUT /api/personality/scope` | Sets `private`, `twin` or `matching`. |
| `POST /api/personality/confirm` | The member confirms flagged answers are honest. |
| `DELETE /api/personality` | Deletes answers, profile and calibration runs. |
| `POST /api/personality/calibrate` | Runs one blinded calibration. Limited to 10 a day. |
| `GET /api/personality/calibrations` | Lists runs and the trend. |

Answers, profile and calibration runs are included in `GET /api/export` and removed by account deletion.

## Blinded twin calibration

This measures how well the twin knows its person.

1. **Hold out.** Up to 2 answered statements per trait are held back, so at least 3 remain per trait. The full form gives 10 held-out statements; the mini form gives 5.
2. **Train view.** The twin sees a profile rescored *without* the held-out statements, plus approved facts. The external Mind gets shareable facts only. A local model may also use twin-only facts.
3. **Blinding.** Statements are relabelled `q1…qn`, so ids reveal neither trait nor keying. The prompt is checked to contain no held-out id, and it never contains any answer. Its SHA-256 is stored.
4. **Prediction.** The member's own Hello Mind (if they consented) or the configured model predicts a 1–5 rating for each statement. The reply must be strict JSON that rates every statement exactly once.
5. **Scoring.** Each run records:
   * mean absolute error, exact matches, and the share of predictions within one step
   * an agreement score, `100 × (1 − MAE/4)`
   * the same error for two naive baselines: always guessing 3, and reading straight from the trait mean
   * **lift over self-report**, the margin by which the twin beats that trait-mean baseline

The twin adds value only when its lift is positive. The trend endpoint averages the last 5 runs. This sits beside the existing scenario calibration (CAL01–03 and UNS01–03), which `/api/twin/authorize` still requires. That response now also includes personality readiness.

## Running it

1. Set `MINDS_BUILDER_API_KEY`. The key is shown once in the Builder console.
2. Run **both** the API and the worker. The worker drains the outbox; without it, awakening and persona syncs wait.
3. Keep `MINDS_JUDGE=0` unless you have reviewed the privacy trade-off.
4. Check `GET /api/admin/minds` after deploying. You want the circuit `closed`, a mostly-stream reply ratio, and no growth in failed tasks.
5. The schema migrates from v8 to v9 on API start, adding the personality, calibration and outbox tables. Take a database backup first.

All tuning variables are listed in `.env.example`.

## Known limits

* **Not tested against the live service.** The tests use a fake Hello Minds server (`backend/tests/minds_fake.py`) with a real SSE stream. No live Builder key was used.
* **SSE format.** The stream's event format comes from reading the client library, not from published docs.
* **Unpublished API details.** The `awaken` archetype catalogue and the API's rate limits are not published.
* **No memory deletion.** Hello Minds has no endpoint to delete a Mind's memory. Persona versions tell the Mind to forget earlier facts, but the privacy notice should say that erasure on the provider side is "disabled and instructed to forget", not "deleted".
* **No population norms.** OCEAN scores have none and must not be presented as percentiles or diagnoses. No frontend screens exist for the personality routes yet.
