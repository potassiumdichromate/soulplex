# Soulplex · 0.5.0

**A deployable full-stack pilot: your AI agent goes on the first date, learns how you'd click, and two real people choose whether to meet.**

> **New in 0.5.0:** an immersive Three.js dusk world with wandering agent spirits, agent "dates" that play out at venues, a per-date **resonance score** across five dimensions, private **agent learnings** and growth tips, an **Insights** page, a **behaviour studio** for writing traits directly, and **"Send my agent out"** autonomous exploration. See [What changed in 0.5.0](#what-changed-in-050).

Independent Web2 project. No blockchain, wallet, token or KULT integration. Local discovery cohorts: Dubai and Delhi NCR. Original procedural Three.js assets and original application code; no VoiceStudio or competitor source copied.

## Start in one command

Requirements: Docker Engine/Desktop with Compose v2, about 3 GB available storage, an internet connection for the first dependency/image download.

```bash
docker compose up --build -d
```

Open **http://localhost:8000** and create an account. The API needs `AI_API_KEY` plus `AI_MODEL` or `MINDS_BUILDER_API_KEY`. Production also needs SMTP so verification email can be sent.

```bash
docker compose logs -f api worker
docker compose down
```

The database persists in a named volume across restarts. The default port is bound to localhost. The demo is for fictional information only: its named personas, including the operator, deliberately have shared one-click access.

**Start here:** [5-minute demo](docs/INVESTOR_DEMO.md) · [Developer deployment](docs/DEPLOYMENT.md) · [Architecture](docs/ARCHITECTURE.md) · [Hello Minds + OCEAN](docs/HELLO_MINDS.md) · [Release and QA](docs/QA.md) · [15-day execution](docs/ROADMAP.md)

## What is implemented

| Area                    | Working scope                                                                                                                                                                                                                                      |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Three.js world          | Full-screen floating island at dusk: shader sky with twinkling stars and moon, animated sea with moonlit glints, bloom, swaying trees, a glowing soul tree, falling petals, fireflies, floating rocks. Agents are coloured light "wisps" that wander; on a date two wisps walk to the venue and a thread of light flows between them, with a celebration burst when the reflection is revealed. Clickable venues, orbit, reduced-motion support and a CSS fallback without WebGL. |
| Account and preferences | One-use pilot invites, email verification and password recovery in live mode, stronger scrypt password storage, expiring HTTPOnly sessions, CSRF checks, adult age bounds, reciprocal preferences and discovery opt-in.                            |
| Story interview         | Conversational backstory onboarding; server-side model adapter; private proposed memories with exact source quotes; optional explicit-upload voice transcription.                                                                                  |
| Personal memory         | Owner approval, editing, rejection, private/shareable scope, deletion, optimistic revision checks. Current approved facts are reloaded into future prompts.                                                                                        |
| Agent orchestration     | Two separately prompted representatives, six bounded turns, three scenario premises, evidence references, moderation and strict structured output validation. Durable database jobs use a unique snapshot key to prevent duplicate current scenes. |
| Resonance & learning    | After each date: a 0–100 resonance score over values, lifestyle, communication, future and interests, each with a reason, plus a confidence level (thin profiles are pulled to neutral). Each person privately sees what their agent learned about the partner, what it noticed about them, and one growth tip. Live mode uses the model with a strict schema; demo or model failure uses a transparent keyword method that is labelled in the UI. |
| Insights                | Aggregates every date: how well the agent knows you (coverage of 7 trait categories), average resonance, radar of dimensions, strengths, best venue, shared themes, things worth exploring, what your agent discovered about others, growth tips, and real-meeting accuracy feedback. |
| Autonomous exploration  | `POST /api/agent/explore` sends the agent to up to three eligible people it hasn't met at the current memory version, ordered by shared themes. Respects all eligibility, block and quota rules. |
| Behaviour studio        | Write traits directly by category (owner-written, auto-approved, private or shareable) alongside the interview and proposal review. |
| Human introduction      | Agent replay → each person contributes → each explicitly accepts → contact reveal. Resonance is a conversation aid; it never unlocks contact or makes a decision. |
| Operations              | Operator eligibility decisions, suspension, reports, blocks, basic metrics, personal data export and active account deletion.                                                                                                                      |
| Delivery                | React/TypeScript frontend, FastAPI API, SQLite demo, PostgreSQL deployment recipe, Docker services, CI, API tests, provider mock tests and a developer handoff.                                                                                    |

### Memory means personal context, not model-weight training

An answer becomes a **private proposal**, not an automatically verified fact. Its owner approves and chooses whether it may be shared. That version is retrieved for the next relevant request. Editing or withdrawing memory invalidates earlier scenes and closes their contact reveal. Agent-generated dialogue never trains a person's memory. Private date feedback is saved for evaluation; it does not silently change preferences.

### Honest release status

This is an **invite-only pilot codebase and investor demonstrator**, not a validated matchmaking algorithm or completed public consumer launch. Live provider integrations are implemented, but live model/audio requests were not exercised without credentials. Docker and PostgreSQL recipes are supplied; this environment did not have a Docker daemon to run them. Browser/device visual QA remains in the handoff checklist. No investment or relationship outcome is guaranteed.

Payment processing, automatic KYC/age verification, calendar/video booking, a social-network import, push notifications, video highlight generation and mobile-store apps are **not implemented**. SMTP delivery code is present but unverified against a real provider. The product explicitly says that meetings are coordinated by the people themselves. Do not label operator approval as identity verification. Finish the launch requirements in [Deployment](docs/DEPLOYMENT.md) before onboarding real users publicly.

## Run without Docker

Python 3.12 and Node 24. Commands below assume a POSIX shell; on Windows use WSL or the corresponding virtualenv activation path.

Terminal 1, from the project root:

```bash
python3.12 -m venv .venv
. .venv/bin/activate
pip install -r backend/requirements.txt
cd frontend
npm ci --ignore-scripts
npm run build
cd ../backend
uvicorn app.main:app --host 127.0.0.1 --port 8000 --no-access-log
```

Terminal 2:

```bash
. .venv/bin/activate
cd backend
python -m app.worker
```

Both processes must use the same working directory and `DATABASE_URL`. The frontend build is served by the API at http://localhost:8000.

For hot reload, run the API with `APP_ORIGIN=http://localhost:5173`, then run `npm run dev` inside `frontend`. Vite proxies `/api` to port 8000. Use the same hostname consistently; `127.0.0.1` and `localhost` have different cookie/origin boundaries.

## Verify

```bash
cd backend
python -m pytest -q
cd ../frontend
npm ci --ignore-scripts
npm run build
```

To format frontend/docs, `npm ci --ignore-scripts` at the root, then `npm run format`. Backend is formatted with Ruff (`pip install ruff`, then `ruff format backend scripts`). Python dependencies (including the regression test runner) are pinned in `backend/requirements.txt`; frontend dependencies resolve from `frontend/package-lock.json`.

## Live mode

Copy `.env.example` to `.env`, set the domain, HTTPS origin, database password, SMTP delivery, model name and provider key. Use a fresh live database; do not reuse the demo volume. Generate one-use invitations with `python -m app.cli invite --count N` inside the API container; register and verify the operator's email before using `promote`.

```bash
docker compose -f compose.production.yaml up --build -d
```

Point the domain at your host, open ports 80/443 and use a domain you control. Caddy handles TLS. Production refuses to start with demo mode enabled, a non-HTTPS origin or missing model configuration. See the deployment document for operator creation, provider requirements, data handling and the launch checklist.

## API and source layout

API documentation is at `/api/docs` in development; OpenAPI is at `/api/openapi.json`. Cookies authenticate requests and the returned `csrf` value must be included as `X-CSRF-Token` on authenticated mutations. Model keys never enter the frontend bundle.

```text
backend/app/       API, data models, security, agent adapter, worker, seed and CLI
backend/tests/     API/consent/memory/provider regression tests
frontend/src/      App, Three.js world, API client, voice capture and responsive styles
docs/              Architecture, deployment, demo, roadmap, QA
compose.yaml       Local fictional demo (SQLite)
compose.production.yaml  TLS + API + worker + PostgreSQL
.github/workflows/ci.yml  Tests, frontend compilation and Docker image build
```

Project-owned source is supplied for your team's use and modification. Third-party packages keep their upstream licenses. Complete your dependency and legal review before release; the repository does not claim trademark availability for “Soulplex.”

## Guided profile setup and must-haves (0.5.0)

This draws on how the 2026 competitors gather information.

- **Bumble Bee:** a private chat about values, relationship goals, communication style, lifestyle and dating intentions.
- **Tinder Chemistry:** interactive questions, plus opt-in camera-roll analysis.
- **Hinge:** structured "vitals", 3 prompts and dating intentions.

Soulplex combines the structured and conversational approaches and skips camera-roll scanning.

- **Setup wizard** (`frontend/src/pages/SetupWizard.tsx`): 7 short steps, mostly tap-to-choose.
  1. About you
  2. What you want
  3. Everyday life
  4. Faith & love
  5. Your voice (3 prompts)
  6. Your face
  7. Must-haves

  It opens after sign-up, from the home checklist, and from My agent → "Edit my profile". A side panel shows what the agent has learned so far.
- **`PUT /api/about`** (`backend/app/about.py`): validates each answer against a fixed list of options. It regenerates owner-approved, shareable agent traits (`source_id = "about:<key>"`), so agents can quote them on dates and resonance uses them.
- **Must-haves:** hard filters for smoking, drinking, family plans, vegetarian diet and religion. Unanswered questions never exclude anyone.
- **Intentions:** marriage matches with a serious relationship, and a serious relationship matches with dating. Marriage and casual dating don't match.
- **Resonance signals:** structured answers adjust the scores with a reason. Matching family plans or love language adds points; conflicts (one person wants children and the other doesn't, or one drinks and the other doesn't) become topics worth exploring.
- **Not collected:** caste and income are never asked for or scored. Religion is optional, and "Prefer not to say" is respected.
- **Display:** cards show vitals chips and the first prompt, and "View full profile" opens the rest. The schema migrates from v3 to v4 to add `users.about`.

## Search, "meet anyway" and invitations (0.5.0)

- **Never a dead end.** Discover is a search (`GET /api/search?q=&age_min=&age_max=&intent=&diet=&family_plans=&religion=`) with two lists:
  - **Your matches:** people who fit both ways.
  - **Outside your preferences:** people whose own preferences include you, but who fall outside your age range or must-haves. Each shows the reason.
- **Consent first.** Someone whose preferences exclude you is never shown, only counted ("3 people here, but their preferences don't include you yet"). Rules nobody can waive: verification, adults only, same city, orientation both ways, compatible intentions, blocks.
- **Meet anyway.** `POST /api/scenes {waive: true}` relaxes only the inviter's age range and must-haves, for that one introduction (`scenes.waived_by`).
- **Invitations.** When someone's agent invites yours, it shows up as 💌 in Home, Dates and a notification.
  - People with auto-accept off (Settings → Invitations) see the scene as `invited`. They review the inviter's profile and accept or decline (`POST /api/scenes/{id}/respond`); a declined invitation never runs.
  - In demo mode, fictional people's agents send you invitations every so often (`DEMO_INVITES`, rate-limited).
- **Schema.** Migrates from v4 to v5 (`users.auto_accept`, `scenes.waived_by`). The demo cast now has 19 people with wider age ranges.

## Characters (0.5.0)

Agents are small low-poly people. They have legs with knees, swinging arms and a body in their outfit colour. They walk with a step cycle and turn toward where they're going, avoiding buildings, the soul tree and the island edge. They pause, wander and, on a date, walk in from opposite sides and sit facing each other. The head shows the agent's face, and turns toward the viewer within a natural range so faces stay readable. Skin, hair and outfit colours come from the illustrated face, and a turban or hijab colours the head covering. A coloured ring on the ground marks each agent, and a white pulsing ring marks you.

## Agent faces (0.5.0)

Each agent has a face that appears on cards, in date replays and on the 3D characters (a glowing body with the face as its head).

- **Illustrated:** a 9-option builder (skin, hair including turban and hijab, hair colour, eyes, brows, mouth, facial hair, accessory and outfit) rendered as SVG in the browser (`frontend/src/faces.ts`). Demo people have illustrated faces.
- **Photo:** cropped, resized and styled (natural, dreamy or painted) in the browser. The uploader confirms the photo is of themselves. A soft-focus public variant is created too.
- **Privacy:** `reveal: "mutual"` (the default) means the server sends only the soft-focus image until a mutual match (`app/faces.py: view`). `reveal: "everyone"` works like a classic matrimonial photo. `PUT /api/face` validates image type and size (body cap 300 KB). The schema migrates v2 to v3 to add `users.face`.
- **Before a public launch:** add image moderation and photo verification (a selfie match), and store photos in object storage instead of the database.

## Ten date islands, live dates and the dates list (0.5.0)

Agents now choose between 10 date types, each defined once in `backend/app/date_types.py`. The frontend copies are generated into `frontend/src/dateTypes.ts` and `frontend/src/mock/dateTypesFull.ts`.

| Type | Place | Process |
|---|---|---|
| ☕ Coffee Date | Café | sit |
| 🌳 Park Walk | Park loop | walk |
| 📖 Bookshop Browse | Bookshop | sit |
| 🧺 Garden Picnic | Garden | sit |
| 🍳 Cooking Class | Night market kitchen | stand |
| 🌮 Street Food Crawl | Night market | walk |
| 🖼️ Art Gallery | Art pavilion | stand |
| 🌅 Sunset at the Pier | Lantern pier | stand |
| 🔭 Stargazing | Lantern pier | stand |
| 🎲 Board Game Café | Café | sit |

- Every date runs in 4 steps, two lines each, and every line records its step and a mood. Each type has its own steps, for example Park Walk goes "At the gate → Noticing things → Bench break → Walking back".
- `POST /api/scenes` with `venue: "auto"` (the default) lets the two agents pick the type that best matches the themes they share. Passing a type id forces that type. An unknown id returns 422.
- **10 islands.** The world is an archipelago. Idle agents wander the home island (the Soul Tree), and every date type has its own island, linked to the home island by floating stepping stones: Coffee Cove, Willow Park, Paper Isle, Bloom Garden, Kitchen Quay, Lantern Market, Gallery Isle, Sunset Pier, Star Hill and Dice Isle.
- **2-3 spots per island, so nothing is crowded.** Each island hosts its date at 2 or 3 named spots (for example Window table, Terrace table and Corner table). A date is assigned a free spot; if every spot is taken it waits. At most two couples (4 agents) are drawn on an island at once.
- **Watching a date.** Tap a date in "Live on the islands" (Home, or the Dates page tab), or click a couple in 3D. The camera flies to its spot and everyone else on that island steps out of view. Your own date is always shown alone.
- Sit dates use seats, stand dates face each other, and walk dates follow a loop together while the camera follows them.
- `GET /api/dates?q=&status=&type=&sort=new|score&offset=&limit=` returns a paginated list of your agent's dates for lists with thousands of rows. Clicking a row opens the date review: the step tracker, each agent's current state and mood, and the conversation grouped by step.
- `GET /api/island` returns island-wide activity: agent count, active dates, today's total, average resonance, counts by date type, and `live`: the dates happening now with their island, spot (`null` while waiting for one), current step, and each agent's first name and public face. Members with discovery turned off show as "Private agent". Conversations are never included. The static demo simulates other people's dates and labels them "Simulated".
- Every scene includes `spot`. `scripts/gen_date_types.py` regenerates the frontend copies of the date types after you edit `backend/app/date_types.py`.

## Watch without an account (0.5.0)

- Visitors can open **Watch live dates, no sign-up** on the start page. They see the 10 islands, every live date, and can tap a date to fly to it and read what the two agents say, step by step.
- Visitors cannot send an agent. "Send my agent", Discover and every write endpoint still need an account; trying opens sign-up.
- **Members choose.** Settings → "Let anyone watch my agent's dates" (`public_dates`, off by default for new members, on for the fictional seed members). A conversation is public only when **both** members allow it; otherwise visitors see just the island, spot and step, with a lock.
- What visitors never see: emails, contact details, match scores, private perspectives or which memories a line came from.
- API (no sign-in): `GET /api/public/island` (same shape as `/api/island`, `mine` is always false, each date has `public`) and `GET /api/public/dates/{id}` (lines with `side`, `speaker`, `text`, `stage`, `mood`; empty until the date finishes; 404 if either member keeps it private).
- Schema v6 adds `users.public_dates`; it migrates automatically on start.

## Shareable live demo (no server)

`cd frontend && npm run build:demo` builds `frontend/dist-static/index.html`, one self-contained page. It runs the real frontend against `src/mock/server.ts`, an in-browser port of the API, resonance and seed data. Dates run on timers, fictional partners answer after you accept (they say yes when resonance is 58% or higher), and state is saved in the visitor's browser (Settings → Reset demo). Host it on any static host (Netlify, GitHub Pages or S3) to show investors without running Python. The real app ignores the mock completely.

## What changed in 0.5.0

**Frontend (rewritten).** `frontend/src/world/engine.ts` is the procedural Three.js world; `WorldCanvas.tsx` lazy-loads it. Pages live in `frontend/src/pages/` (Landing, Shell, Home, Agent studio, Discover, Dates with live replay, Insights, Settings and Operator). `store.tsx` holds session and data state with hash routing (`#/dates/<id>` links work). Fonts are self-hosted through Fontsource, so the strict CSP (`font-src 'self'`) holds.

**Backend.**

- `app/resonance.py`: assessment and per-person perspectives (`assess`, `heuristic`, `finalize`). The worker attaches `output.assessment` after the dialogue. `scene_data` strips the other person's perspective, so each person sees only their own agent's reflection.
- New endpoints: `POST /api/memories` (owner-written trait), `POST /api/agent/explore`, `GET /api/insights`. `/api/candidates` now also returns `hue`, `traits` and `common` (shared themes).
- Demo dialogue is conversational but still quotes only approved facts.
- The demo cast is larger: 7 more Dubai people and 2 more in Delhi NCR, with categorised traits.
- Tests: `backend/tests/test_agents.py` covers assessment privacy, trait writing, explore de-duplication, insights and the thin-profile guard.

**Honesty notes.** "Learning" means memory plus reflection, stored per date and aggregated. No model weights are trained. Resonance is not a validated predictor of relationship outcomes. It is grounded only in what both people chose to share, and the UI says so.
# soulplex
