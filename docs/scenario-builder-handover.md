# Scenario builder: status and handover

Branch `feat-budget-planning` · as of 12 Nov 2026 (last commit `7e5b146`).
Not pushed: 110 commits ahead of `origin/budget-planning`, 29 ahead of `origin/main` (main was merged in at `e6616d4`).

## 1. Where it stands

| Phase / step | What it is | Status |
| --- | --- | --- |
| 0–4 | Promotion uplift settings (calculated uplifts, anchors by version, mechanic discounts), live uplifts in the Scenario builder, growth | Done |
| **5** | Tier 0 split into baseline + last year's promotions, official promotions in their place, Breakdown tab, Monthly plan by part | **Done** (`4c1bbf5`, `92c3f00`, `75bb6f9`, then reworked below) |
| A1 | Building blocks for several customers; each customer × SKU range switched off on its own | Done (`7ed2adf`, `9f69203`) |
| A2 | Scenario promotions for several customers; each pair on its own uplift | Done (`9f69203`) |
| — | Breakdown tab: contribution list instead of switches; growth per customer; y-axis that doesn't jump | Done (`9f69203`) |
| B | Past milestone blocks, worked back from actuals | Done (`7e5b146`) |
| C | Budget planning mode in the Scenario builder | **Next, not started** |
| D | Locked budget line on Sell-Out Forecast and inventory sell-in charts | Not started (after C) |
| **6** | Saved, frozen plans | **Folded into C/D**: locking a budget is the frozen plan (see 3) |

## 2. What works now

- **Scenario builder** (`/scenario`, wide page, side panel opens on Breakdown) runs on Tier 0 (Current).
- **Tier 0 split** (Phase 5): baseline at the anchor + what last year's promotions carry; official promotions replace them in their months; scenario promotions replace them where nothing official is planned, else add on top. BigQuery's Tier 0 is never changed.
- **Breakdown tab**: growth (one % per customer per year, every SKU) and a read-only "What Simulated is made of" list for the months on the chart; "What Actual is made of" for past milestone months.
- **Building blocks**: several customers (none = all), per-pair switches in the blocks table's opened row, units given in full to each customer, past months allowed as **milestones** (ring on the Actual line; never moves a line).
- **Scenario promotions**: several customers; each customer × SKU takes its own worked-out uplift; slider shows the spread, an override or voucher edit is one value for all; per-pair switches in the editor. Forecast months only.
- **Monthly plan**: part columns (baseline, Promotions with mechanic pills, growth, blocks, scenario promotions), plan-status/"+ Plan promotion" buttons, opened month shows how Tier 0 is built.
- **Colours**: one per part, from `PART_COLORS` in `frontend/aireos/app/utils/scenarioComposition.js`.

## 3. Next: C and D (agreed decisions)

From the user, 12 Nov (also in Claude memory `budget-planning-decisions`):

- **C. Budget planning = a mode inside the Scenario builder** (switch: "Current forecast | Budget planning"), not a separate page.
  - Base: next year's **Initial Yearly Forecast** (Tier 0) as a **plain** base: growth, blocks and scenario promotions on top; no official / last-year promotion split yet (add later, needs a backend Tier 0 split at Initial's data cut-off).
  - Budget entries are separate from Current-mode entries: add `plan` (`scenario` | `budget`) to `scenario_building_blocks` and `scenario_promotions` (new migration), filter the APIs by it.
  - **Lock budget**: a button only (no automatic 1 Jan lock). Saves customer × SKU × month units to a new Cloud SQL table (e.g. `budget_snapshots`) with who/when. Can be locked again: a new version, newest shown, history kept.
  - Next year's Initial exists from September data and can still move until 31 Dec SGT (Sandra's pipeline); the app never writes BigQuery.
- **D. Locked budget as a "Budget" line**: its own colour + toggle on the Sell-Out Forecast and the inventory sell-in chart, next to Initial / Previous / Current. On the sell-in chart it is the sell-in plan worked out from the budget's sell-out.

Suggested order: C backend (migration + `plan` filter + lock table/endpoints + tests) → C frontend (mode switch, Initial base, lock button) → D.

## 4. Before deploying

1. **Run migrations 022–025** in Cloud SQL Studio, in order (already run on the shared dev database). 024 stops if a customer has different growth % per SKU range in one year.
2. **Duplicate migration number**: main's `016_add_model_outdated_notification_type.sql` sits beside ours `016_scenario_growth_blocks.sql` (independent; numbers 003/004/007 already repeat). Make sure main's 016 is applied too.
3. **Push** the branch and open the PR to `main` (nothing pushed yet).
4. `AUTH_ENABLED=true` locally again (done).

## 5. Known gaps and follow-ups

- **Not seen in a browser** since the latest changes: A2 promotion editor (spread text, slider, voucher reset, pair switches), milestone colours. The A2 storage was tested end to end on the dev database (test promotion created, read back, deleted).
- `app/utils/scenarioPromotions.js` has no unit tests (its `@/` imports don't load under `node --test`).
- Hover card is still busy; planned reorganisation (memory `scenario-tooltip-too-full`).
- Y-axis grows when the Simulated line leaves the chart but doesn't hold that size when the item is switched off.
- Budget split (official / last-year promotions on Initial) deferred from C.
- `scripts/repair_promotion_store_links.py`: 302 of 373 promotions point at deleted stores (memory `promotion-stores-orphaned`).
- Main's `tests/test_forecast_refresh_worker.py::test_internal_callback_rejects_browser_and_forged_tokens` fetches Google's certificates over the network (ours was fixed the same way it could be).

## 6. Working agreements (from the user)

- Commit only after the user approves; never commit `.env*` or `gcp-key.json`.
- Ask before **any** cloud or SQL command, read-only included, and before calling the live backend.
- Don't run `next build` in `frontend/aireos` while `next dev` runs (it broke page CSS); use lint + `npm test`, or build in a worktree.
- Run the backend with `uvicorn app.main:app --reload --reload-dir app --timeout-graceful-shutdown 5` (plain `--reload` hangs on reload).
- Don't assume: ask when a request can be read two ways.

## 7. Where things are

| Concern | Files |
| --- | --- |
| Page | `frontend/aireos/app/components/scenario/ScenarioBuilder.jsx`, `ScenarioPanel.jsx`, `FrozenBaselinePanel.jsx`, `MonthlyPlanTable.jsx`, `Tier0Details.jsx`, `ItemPairs.jsx` |
| Engine (pure) | `app/utils/scenarioEngine.js`, `scenarioTier0Split.js`, `scenarioComposition.js`, `scenarioPlan.js`, `scenarioMilestones.js`, `scenarioGrowth.js` |
| Blocks / promotions | `app/utils/scenarioBlocks.js`, `scenarioPromotions.js`, `scenarioLiveUplifts.js`; backend `app/services/scenario/{building_blocks,promotions,common,block_effects,tier0_split,tier0_breakdown}.py` |
| Tests | `frontend/aireos/tests/scenario*.test.mjs`, `backend/tests/test_scenario_*.py` |
| Architecture map | `AGENTS.md` (Scenario builder row in §2) |
