# Scenario builder: status and handover

Branch `budget-planning` · reviewed 12 Nov 2026 before the first-draft commit.
Last committed merge: `50d8200`, matching the locally cached `origin/budget-planning`.
The C/D implementation and subsequent UI changes are still working-tree changes; some are partly staged and new files are untracked.

## 1. Where it stands

| Phase / step | What it is | Status |
| --- | --- | --- |
| 0–4 | Promotion uplift settings (calculated uplifts, anchors by version, mechanic discounts), live uplifts in the Scenario builder, growth | Done |
| **5** | Tier 0 split into baseline + last year's promotions, official promotions in their place, Breakdown tab, Monthly plan by part | **Done** (`4c1bbf5`, `92c3f00`, `75bb6f9`, then reworked below) |
| A1 | Building blocks for several customers; each customer × SKU range switched off on its own | Done (`7ed2adf`, `9f69203`) |
| A2 | Scenario promotions for several customers; each pair on its own uplift | Done (`9f69203`) |
| — | Breakdown tab: contribution list instead of switches; growth per customer; y-axis that doesn't jump | Done (`9f69203`) |
| B | Past milestone blocks, worked back from actuals | Done (`7e5b146`) |
| C | Budget planning mode in the Scenario builder | Implemented; dev schema verified, lock/chart live verification pending |
| D | Locked budget line on Sell-Out Forecast and inventory sell-in charts | Implemented; dev schema verified, lock/chart live verification pending |
| **6** | Saved, frozen plans | **Folded into C/D**: locking a budget is the frozen plan (see 3) |

## 2. What works now

- **Scenario builder** (`/scenario`, wide page, side panel opens on Breakdown) runs on Tier 0 (Current).
- **Tier 0 split** (Phase 5): baseline at the anchor + what last year's promotions carry; official promotions replace them in their months; scenario promotions replace them where nothing official is planned, else add on top. BigQuery's Tier 0 is never changed.
- **Breakdown tab**: growth (one % per customer per year, every SKU) and a read-only "What Simulated is made of" list for the months on the chart; "What Actual is made of" for past milestone months.
- **Building blocks**: several customers (none = all), per-pair switches in the blocks table's opened row, units given in full to each customer, past months allowed as **milestones** (ring on the Actual line; never moves a line).
- **Scenario promotions**: several customers; each customer × SKU takes its own uplift. Expected uplift and **Edit** share one card; the slider only opens on Edit. An override or voucher edit is one value for all. A disclosure explains each included customer × SKU and applicable period using its anchor, rule or measured moments; newly copied references keep the explanation, while older missing explanations are labelled. Per-pair switches remain in the editor. Forecast months only.
- **Tables**: compact By year / By month views on shared table primitives; month rows expand into a nested contribution table with mechanic pills, planning links and Tier 0 details. Annual change figures open their contributions. Simulated values stay left and saved/draft pills right.
- **Saved item tables**: all saved building blocks and promotions in the current mode are listed, regardless of chart customer/SKU/date filters or the active switch. Only each table's own search and paging narrow its list; gains still follow the chart. Promotions have search, sort, refresh, active switches, expanded calculation/impact details, Edit into the sidebar and confirmed deletion. Saving a promotion returns it to the table; drafts and the selected edit remain in the sidebar. Refresh retains drafts/unsaved edits and ignores responses superseded by a save/delete.
- **Chart spotlight**: hover or keyboard-focus a Breakdown contribution to spotlight its matching positive and hatched negative areas; leave/blur restores the full shading. Other bands fade while retaining their stack positions, and figures/axes are unchanged. Adjustment decreases have separate bands per source. The seasonal-average label is lowered and drawn above forecast lines with a contrast outline.
- **Budget planning**: a separate mode on Initial, with separate entries, explicit whole-year locking and retained versions. Initial is now reconstructed into an anchor baseline and carried promotion effects at its own data cut-off. Budget promotions replace the carried effects for their covered share of a month. Expanded months show source months and anchors per customer × SKU; missing or mismatched source history blocks preview and locking.
- **Budget comparisons**: latest locked sell-out units on Forecast and Inventory; sell-in is calculated from that budget with stock and DOH inputs. Inventory's optional building-block overlay reads Scenario-mode entries only. Budget-mode entries, including unlocked drafts, are excluded. Sell-in Budget is olive; Sell-out Budget is burgundy.
- **Colours**: one per part, from `PART_COLORS` in `frontend/aireos/app/utils/scenarioComposition.js`.

## 3. C and D (implemented agreed scope)

From the user, 12 Nov (also in Claude memory `budget-planning-decisions`):

- **C. Budget planning = a mode inside the Scenario builder** (switch: "Current forecast | Budget planning"), not a separate page.
  - Base: next year's **Initial Yearly Forecast** (Tier 0). The original plain-base deferral has now been completed: anchor baseline and carried effects are reconstructed at Initial's own cut-off, and budget promotions replace those carried effects. Growth and building blocks continue to apply to Initial. Future official promotions are not automatically added to Budget.
  - Budget entries are separate from Current-mode entries: add `plan` (`scenario` | `budget`) to `scenario_building_blocks` and `scenario_promotions` (new migration), filter the APIs by it.
  - **Lock budget**: a button only (no automatic 1 Jan lock). Saves customer × SKU × month units to a new Cloud SQL table (e.g. `budget_snapshots`) with who/when. Can be locked again: a new version, newest shown, history kept.
  - Next year's Initial exists from September data and can still move until 31 Dec SGT (Sandra's pipeline); the app never writes BigQuery.
- **D. Locked budget as a "Budget" line**: its own colour + toggle on the Sell-Out Forecast and the inventory sell-in chart, next to Initial / Previous / Current. On the sell-in chart it is the sell-in plan worked out from the budget's sell-out.

Implementation details and deployment checks: [Budget planning](budget-planning.md). Approved read-only checks confirmed migration 026 schema in shared dev. The agent did not create a budget snapshot during verification; user screenshots subsequently show Budget lines, but the full live lock/version/filter workflow has not been verified by the agent.

Local checks and approved Initial read verification are recorded in [Budget planning](budget-planning.md#first-draft-review-on-12-november-2026). The 2027 split reconciled all 600 cells at its October 2026 cut-off, with zero unavailable cells. Component render checks cover Initial-based calculation and promotion replacement, table contributions, Budget labels/colours, and the promotion editor's Edit/Done/reset flow and copied-explanation payload.

Saved-table/spotlight update: 368 frontend tests passed. Render checks cover all seven saved blocks under narrowed chart filters, saved promotions including inactive rows and exact dates, promotion save/toggle/clash/delete/rollback behaviour, and pointer/focus spotlight restoration without moving bands or changing values. Full-workspace rendering still calculated 1,632 from the 1,200 Initial fixture plus growth/blocks and promotion replacement.

## 4. Before deploying

1. **Apply missing migrations through 026** to the deployment database in order. 022–025 and the 026 schema have been confirmed in shared dev; that does not establish the schema of another deployment target. 024 stops if a customer has different growth % per SKU range in one year.
2. **Duplicate migration number**: main's `016_add_model_outdated_notification_type.sql` sits beside ours `016_scenario_growth_blocks.sql` (independent; numbers 003/004/007 already repeat). Make sure main's 016 is applied too.
3. Commit the complete first draft (including new files and the latest edits to partly staged files), push it and open the PR to `main`. The previous merge is already on the locally cached branch remote.
4. `AUTH_ENABLED=true` locally again (done).

## 5. Known gaps and follow-ups

- **Browser/live verification pending** for the latest promotion editor, voucher reset and pair switches, milestone colours, and the complete C/D workflow: first lock, second version, retained history, Forecast customer/SKU/date filters, and Inventory's Budget/Current-overlay separation. Automated tests and component render checks have passed; these do not replace a full live browser check. Earlier A2 storage was tested on dev (test promotion created, read back, deleted).
- `app/utils/scenarioPromotions.js` still lacks a standalone unit suite (its `@/` imports don't load directly under `node --test`). New pure uplift-control and per-pair derivation helpers have unit tests; the engine/payload also has component smoke coverage, but broader direct promotion-helper tests remain a follow-up.
- Hover card is still busy; planned reorganisation (memory `scenario-tooltip-too-full`).
- Y-axis grows when the Simulated line leaves the chart but doesn't hold that size when the item is switched off.
- **Initial forecast split is built and read-verified**; remaining validation is the full browser workflow and a new lock/re-lock with replacement. Existing frozen versions are not rewritten. Initial years without a recorded cut-off remain explicitly unavailable rather than borrowing Current's origin.
- Main's `tests/test_forecast_refresh_worker.py::test_internal_callback_rejects_browser_and_forged_tokens` still calls Google's verifier without a fake for the forged token. Stub that verification in the test so it never attempts certificate retrieval. The suite passes with external connections blocked because the handler returns 401 when verification fails.

The orphaned promotion-store link repair is **recorded as completed** in [Forecast cloud readiness](forecast-cloud-readiness.md), under the 4 November investigation (302 promotions repaired, zero orphan links at that check). The old pending-repair note was stale; the current database was not re-audited in this handover review.

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
