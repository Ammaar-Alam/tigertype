# TigerType Training Mode & Analytics Master Plan

## Current State Recap
- **Realtime flow:** Typing input is orchestrated through the race context (`client/src/context/RaceContext.jsx:622`) and emitted over sockets (`client/src/components/Typing.jsx:460` and `client/src/context/RaceContext.jsx:820`). Timed practice already persists aggregate WPM/accuracy via `insertTimedResult` (`server/db/index.js:151`) and stores race outcomes in `race_results` using `recordRaceResult` (`server/models/race.js:223`).
- **Player analytics today:** `User.getDetailedStats` folds together races, timed tests, and partial sessions to produce totals for sessions and words typed (`server/models/user.js:260`). Platform-wide rollups (total sessions, words, average WPM) come from `getTotalPlatformStats` (`server/db/index.js:292`). No surface tracks per-letter accuracy or keystroke-level mistakes.
- **Schema touch points:** Core tables (`docs/DatabaseSchema.md`) include `race_results`, `timed_leaderboard`, and `partial_sessions`. User achievements and badges already depend on aggregated stats, so new columns/tables must coexist with this system.

## Training Mode Vision
Create a dedicated, data-driven practice loop that:
1. Records fine-grained keystroke summaries per session (per-letter exposure, error counts, timing).
2. Generates adaptive practice passages that overweight letters/bigrams a user struggles with.
3. Surfaces rich analytics immediately after a session and in a persistent dashboard (per-letter bars, trend lines, completion streaks).
4. Integrates cleanly with existing socket flow, authentication, and leaderboard infrastructure.

## Architecture Additions (High-Level)
- **Client instrumentation:** Extend the race context to track character-level deltas (map of `{ char, attempts, errors, extra }`) and emit them alongside final session metrics for training runs.
- **API surface:** Introduce a `/api/training` namespace plus parallel socket events (e.g., `training:start`, `training:progress`, `training:complete`) reusing the existing session middleware.
- **Persistence:** Add new Postgres tables and supporting models:
  - `training_sessions` – per-run metadata (user, mode, duration, config, aggregate stats, start/end timestamps).
  - `training_session_char_stats` – one row per letter (session_id, char, exposures, mistakes, extra_hits, latency_avg).
  - `training_user_char_totals` – rolling aggregates to power recommendations efficiently.
  - Optional `training_recommendations_cache` (JSONB) to snapshot the latest letter weighting so we can serve fast responses without recomputing on every request.
- **Adaptive text generation:** A new utility (e.g., `server/utils/training-text.js`) that blends the existing timed generator (`server/utils/timed-test.js`) with per-user weights. Fallback to default word lists until a user accumulates enough history.
- **Visualization:** Adopt Recharts for analytics dashboards (React-friendly, SVG-based, accessible). Documentation reference: `/recharts/recharts` (Context7).

## Implementation Phases

### Phase 0 – Alignment & Design Decisions
1. Confirm UX flows (entry point from practice selector, post-session modal, standalone dashboard).
2. Finalize data granularity (per character vs. n-gram) and retention expectations with stakeholders.
3. Document charting approach (Recharts) and styling guidelines to match existing UI primitives.

### Phase 1 – Client Instrumentation
1. Extend `RaceContext` typing state to track character stats and a chrono log (`client/src/context/RaceContext.jsx:720`).
2. Add a helper that diff-compares previous vs. current input to capture mistakes/backspaces without full keystroke logging (avoid enormous payloads).
3. Emit a new payload on `training:complete` with:
   - Aggregated session metrics (duration, total chars, corrected errors).
   - A char map `{ letter: { seen, errors, extra, dwellMs } }`.
   - Snippet seed/config metadata (so the server can regenerate identical passages if needed).
4. Guard the feature behind a new mode toggle (`client/src/components/TestConfigurator.jsx`) and ensure `Typing.jsx` renders training copy and countdown states properly.

### Phase 2 – Database & Models
1. Write migration(s) to create:
   ```sql
   CREATE TABLE training_sessions (
     id SERIAL PRIMARY KEY,
     user_id INT REFERENCES users(id) ON DELETE CASCADE,
     created_at TIMESTAMPTZ DEFAULT now(),
     completed_at TIMESTAMPTZ,
     mode VARCHAR(20) NOT NULL,          -- e.g. 'adaptive-letters'
     duration_seconds INT NOT NULL,
     config JSONB NOT NULL,              -- stores focus letters, word pool, difficulty
     total_chars INT NOT NULL,
     error_count INT NOT NULL,
     corrected_errors INT NOT NULL,
     wpm NUMERIC(6,2),
     accuracy NUMERIC(5,2),
     snippet_id VARCHAR(64)              -- virtual ids for generated passages
   );

   CREATE TABLE training_session_char_stats (
     session_id INT REFERENCES training_sessions(id) ON DELETE CASCADE,
     character TEXT NOT NULL,
     exposures INT NOT NULL,
     mistakes INT NOT NULL,
     extra_hits INT NOT NULL,
     avg_latency_ms NUMERIC(8,2),
     PRIMARY KEY (session_id, character)
   );

   CREATE TABLE training_user_char_totals (
     user_id INT REFERENCES users(id) ON DELETE CASCADE,
     character TEXT NOT NULL,
     exposures BIGINT NOT NULL DEFAULT 0,
     mistakes BIGINT NOT NULL DEFAULT 0,
     extra_hits BIGINT NOT NULL DEFAULT 0,
     last_seen TIMESTAMPTZ DEFAULT now(),
     PRIMARY KEY (user_id, character)
   );
   ```
2. Add indexes for `training_user_char_totals (user_id, mistakes DESC)` to accelerate “worst offenders” queries.
3. Update `server/models` with `TrainingSessionModel` for CRUD helpers and `TrainingAnalyticsModel` for rolled-up reports.

### Phase 3 – Service Layer & APIs
1. Implement socket handlers parallel to `race:result` inside `server/controllers/socket-handlers.js` to ingest training payloads and call new DB helpers.
2. Expose REST endpoints:
   - `POST /api/training/sessions` – create (or resume) a session record.
   - `POST /api/training/sessions/:id/complete` – persist char map, finalize metrics.
   - `GET /api/training/recommendations` – return the next focus set (top 5 letters, sample syllables, suggested drills).
   - `GET /api/training/history?range=30d` – fetch time-series for WPM/accuracy.
3. Reuse existing auth middleware (`server/routes/api.js:34`) to protect the endpoints.
4. Add a utility that updates `training_user_char_totals` transactionally after each completion (use the shared pool client).

### Phase 4 – Adaptive Content Generation
1. Build `selectFocusCharacters(userId)` that blends:
   - Per-letter error rate (mistakes/exposures).
   - Recency weighting (bias toward letters with issues in the last N sessions).
   - Diversity guard (ensure vowels/consonants mix; fallback to default set if data sparse).
2. Extend the timed generator to accept a target distribution and optionally insert seeded bigrams/digraphs (stored in `config`).
3. Cache generated text + metadata (duration, focus letters) so the client and server agree on what was shown.

### Phase 5 – Frontend Experience
1. **Configurator:** Add “Training” mode to the practice selector with copy explaining adaptive focus; fetch preview of target letters before session start.
2. **During session:** Display live indicators (e.g., highlight letters being emphasized, running accuracy).
3. **Results panel:** On completion, render:
   - Bar chart `letter vs. accuracy` (Recharts `BarChart`).
   - Line chart for last 10 training sessions showing WPM & accuracy (Recharts `LineChart` with dual lines).
   - Table of “top mistakes” with suggested drills.
   - Download/Share button if desired.
4. **Training dashboard:** New route under `/training` summarizing history, filters, and improvement trends. Consider embedding into existing profile modal (`client/src/components/ProfileModal.jsx:913`) as a dedicated tab.

### Phase 6 – QA, Telemetry, Launch
1. Add Jest unit tests for new db helpers and services; mock Postgres with `pg-mem` similar to existing server tests.
2. Add end-to-end flow tests using `mock-socket` to verify socket contract for training events.
3. Add Vitest/UI tests for new React components (render charts with sample data, ensure empty states).
4. Instrument success metrics (count of training sessions per user) via existing logging/analytics hooks.
5. Stage rollout behind feature flag/env key (e.g., `ENABLE_TRAINING_MODE`) to allow phased release.

## Technology & Tooling
- **Charts:** Recharts (`/recharts/recharts` via Context7) for responsive, accessible SVG charts inside React/Vite.
- **State management:** Reuse `RaceContext` for training state; consider extracting a dedicated `TrainingContext` if complexity grows.
- **Data storage:** Postgres with JSONB config columns and aggregated tables. Continue using existing migration runner (`npm run migrate`).
- **Testing:** Jest (backend) + Vitest/Testing Library (frontend). Reuse `run-tests.sh` to keep parity with CI expectations.

## Risks & Open Questions
- **Payload size:** Need to cap the per-session char map (aggregate counts client-side instead of sending the entire keystroke stream).
- **Performance:** Recomputing recommendations on every session could strain DB; mitigate with cached aggregates and Postgres views/materialized views if necessary.
- **Cold-start:** New users lack history; plan default drills (home-row warmup, random exercises) until enough data accrues.
- **Data retention:** Decide how long to keep per-session records for analytics vs. privacy. Consider a cleanup job.
- **UI scope:** Determine whether analytics live inside current results modal or a new standalone page to manage complexity.

## Verification & Rollout Checklist
1. Migrations applied successfully in dev/staging (`npm run migrate`).
2. Socket contract documented and validated (client/server handshake).
3. Manual QA script covering: session start, mid-session cancel, completion, analytics rendering, dashboard filters.
4. Load test the recommendation endpoint with synthetic data to ensure response <200ms.
5. Update README/ProjectOverview with training instructions and add screenshots once UI stabilizes.

