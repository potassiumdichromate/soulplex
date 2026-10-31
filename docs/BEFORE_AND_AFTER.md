# Before and after: the Hello Minds, OCEAN and 0G upgrade

This compares the backend at commit `44bf55b` (before) with this release. Everything below can be checked in the code and the tests. Section 7 lists what still has not been done.

## 1. At a glance

| | Before | After |
|---|---|---|
| Hello Minds API operations used | 7 | 16, including the event stream, credits, usage, skills, enable and disable, name check and circle removal |
| Code that sends Hello Minds requests | 391 lines in one file, fire-and-forget | 2,036 lines across client, outbox, personality and admin modules |
| Consent before a member's data leaves Soulplex | None. Minds were created at sign-up and sign-in. | Explicit `allow_external_minds` permission, revocable |
| Personality measurement | None | IPIP-50 / Mini-IPIP Big Five (OCEAN), scored and quality-checked |
| How well the twin knows its person | Scenario calibration only | Plus blinded held-out OCEAN calibration with baselines |
| AI provider | OpenAI only | OpenAI or the 0G Router (`AI_PROVIDER=0g`) |
| Test functions | 58 | 107, so 116 test cases when parametrised. Hello Minds had no tests before. |
| Deployment guide | Partial, with no Hello Minds settings | Full variable reference, Render checklist and troubleshooting |

## 2. Hello Minds integration

| Area | Before | After |
|---|---|---|
| **Consent** | A Mind was awakened for every member at registration and sign-in, before they had agreed to an external processor. | A Mind is created only after the member grants `allow_external_minds`. Revoking disables it. Deleting the account retires it. |
| **What the Mind knows** | Each approved fact was sent as a separate message by a FastAPI background task. Edits and withdrawn facts never reached the Mind. | One compiled persona per member, hashed and sent only when it changes. Each version tells the Mind to forget earlier Soulplex facts. Edits, deletions, profile and "about" changes all trigger a resync. |
| **Delivery guarantee** | Background tasks were lost if the process restarted. | A durable `mind_tasks` outbox in the database, drained by the worker. Duplicate tasks are merged and failures retry with exponential backoff. Stuck tasks are reclaimed. |
| **Getting replies** | History was polled every 2 seconds for up to 90 seconds per line. | The client opens the SSE event stream before sending, so a fast reply is not missed. History polling remains only as a fallback. |
| **Reliability** | A new HTTP connection per call. No retries, no `Retry-After` handling and no protection when the service is down. | Pooled connections with concurrency limits. Retries with jitter that honour `Retry-After`. A circuit breaker stops calls after repeated failures. A request that may already have reached the server is never re-sent. |
| **Credits** | Never checked. A Mind with no Cognition timed out in the middle of a date. | Balances are checked before each date. The date falls back to `AI_MODEL`, or stops with a clear "top up" message. |
| **Scoring dates** | One shared "judge" Mind read both people's facts for every couple. Its number, pulled out with a loose regex, replaced the whole assessment. | Off by default (`MINDS_JUDGE=0`). When on, the score must be a strict JSON integer and is blended 50/50 with the explained assessment. |
| **Mind names** | Included part of the internal user id. | Display name plus a random suffix, checked for availability first. |
| **Circles** | Linked on mutual accept by a background task. Never unlinked. | Linked through the outbox. Unlinked when someone blocks or deletes their account. |
| **Private chat** | Used the Mind whether or not the member had consented. | Uses the Mind only with consent, and only shareable facts. |
| **Skills** | Not available. | Members can equip only Bazaar skills on the operator's allowlist. |
| **Operator tools** | None. | Doctor check, metrics, outbox view, task retry, full resync and breaker reset under `/api/admin/minds`. |
| **Data export and deletion** | Mind data not included. | Export includes the Mind id and personality data. Deletion disables the Mind and removes the personality tables. |

## 3. OCEAN (Big Five) personality

| | Before | After |
|---|---|---|
| Instrument | None | IPIP-50 Big-Five Factor Markers (Goldberg 1992) and the 20-item Mini-IPIP (Donnellan et al. 2006). Both are public domain. |
| Scoring | — | Keyed means reported as POMP 0–100, with an approximate range. Scores are calculated in code; a model never writes or edits one. Not presented as percentiles. |
| Answer quality | — | Flags for the same answer everywhere, contradictory answers to opposite statements, and rushed answering. A flagged profile is not used until the member retakes or confirms it. |
| Member control | — | Three scopes: `private`, `twin` (tone guidance only, the default) and `matching` (adds conversation notes, capped at ±4 points). |
| Fairness rules | — | Neuroticism is never compared between two people, and personality never decides whether a match is offered. |

## 4. Twin calibration

| | Before | After |
|---|---|---|
| Method | Scenario questions (CAL01–03, UNS01–03) answered by the OpenAI model | Those still exist. Added: blinded held-out OCEAN calibration. |
| Blinding | — | Up to 2 answered statements per trait are hidden. The rest are relabelled `q1…qn` so ids reveal nothing. The prompt is checked for leaks and its SHA-256 is stored. |
| Who predicts | The model | The member's own Hello Mind if they consented, otherwise the model |
| Metrics | Pass or fail per scenario | Mean absolute error, exact matches, share within one step, agreement 0–100, and two baselines: always guessing 3, and reading from the trait mean |
| Proof of value | — | **Lift over self-report**: the twin counts as adding value only when it beats the trait-mean baseline. The trend is averaged over the last 5 runs. |

## 5. AI provider

| | Before | After |
|---|---|---|
| Providers | OpenAI only. The base URL and request shape were fixed. | OpenAI (unchanged) or the 0G Router at pc.0g.ai |
| Privacy on 0G | — | `X-0G-Provider-Trust-Mode: private` by default: TEE hosts with zero data retention |
| Structured output | Strict JSON schema only | Strict schema first. If the Router refuses it, JSON mode plus server-side validation, remembered per model. Code-fenced JSON is accepted. |
| Errors | Any failure became "model request failed" | 429/502/503 retried using `Retry-After`. 402 says the balance is empty. Invalid or truncated output is still rejected. |
| Safety screening | OpenAI's moderation endpoint only | The same endpoint, or a model-based classifier on 0G, which has no moderation endpoint. Both fail closed. |
| Key safety | — | An OpenAI `AI_BASE_URL` left in the env group is ignored with 0G, so a 0G key is never sent to OpenAI. |

## 6. Deployment settings

| Variable | Before (as found on Render) | After |
|---|---|---|
| `APP_ENV` | `development` | `production` |
| `AI_PROVIDER` | not set | `0g` |
| `AI_API_KEY` | 32-character placeholder | real 0G `sk-` key |
| `AI_MODEL` | 32-character placeholder | a model id from `/v1/models` |
| `SMTP_HOST`, `SMTP_FROM`, `SMTP_USERNAME`, `SMTP_PASSWORD` | 32-character placeholders | real email provider values |
| `MINDS_BUILDER_API_KEY` | set | unchanged |
| `MINDS_JUDGE` | did not exist; the judge ran on every date | `0` |
| `MINDS_SSE` | did not exist; replies were polled | `1` |
| `DEMO_MODE` | set | delete; no longer read |

With the old placeholders, model calls and email could not work in production. The full checklist is in [DEPLOYMENT.md](DEPLOYMENT.md#render-environment-checklist-0g--hello-minds).

## 7. Still not done

- **Not tested against live services.** Nothing has run against the live Hello Minds API or the live 0G Router. The tests use a fake Hello Minds server with a real event stream, and a mock 0G transport.
- **Undocumented upstream details.** The Hello Minds event format and rate limits, and 0G's JSON-schema support, are inferred rather than documented by the providers.
- **No personality screens.** The frontend has no questionnaire or calibration screens yet; only the API exists.
- **Old calibration unchanged.** Scenario calibration (CAL01–03) still uses the model, not the Mind.
- **Metrics per process.** The API and the worker each count separately, and `/api/admin/minds` shows only the API's.
- **No memory deletion.** Hello Minds cannot delete a Mind's memory. Departing members' Minds are disabled and told to forget, which the privacy notice must say.
- **Weaker moderation on 0G.** Model-based moderation is weaker than a dedicated moderation model, and costs one extra call per screened message.
