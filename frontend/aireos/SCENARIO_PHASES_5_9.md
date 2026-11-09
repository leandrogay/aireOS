# Scenario Builder phases 5–9 draft

This is the first implementation draft for frontend work before the live
BigQuery component columns and baked-in snapshot API exist.

## Phase 5 — fixture-backed frontend integration

- Enable `NEXT_PUBLIC_SCENARIO_FIXTURES=true` locally.
- Keep the existing forecast API shape and Tier 0 row grain.
- Use `app/utils/scenarioFixtures.js` only through `forecastApi.js`.
- Exercise one customer, one SKU, twelve forecast months, Tier 0 provenance,
  actuals, and baked-in discount states.
- Keep the flag unset or `false` for normal backend behavior.

## Phase 6 — pure engine and breakdown

- Keep `scenarioEngine.js` as the source of simulated delta cells.
- Add breakdown data alongside the existing cells; do not mutate Current.
- Show the baseline as Last Year + model movement, then Blocks and Promotions,
  ending at Simulated.
- Use `scenarioBreakdown.js` for units-only explanation and discount source
  labels.
- Planned promotion values remain saved references; changing settings does not
  silently rewrite a saved scenario.

## Phase 7 — frozen discount display

- Add a read adapter for the eventual
  `GET /api/scenario/baked-in-discounts` response.
- Render `measured`, `anchor`, and `not_frozen_yet` states distinctly.
- Treat a live fallback as informational, never as frozen provenance.
- Show the detail for one customer and one SKU first; aggregate views can show
  only a summary indicator.

## Phase 8 — UI surfaces

- Add a breakdown toggle group with the existing scenario controls.
- Add optional breakdown bars to the scenario chart card.
- Add breakdown sections to the tooltip and monthly plan table.
- Keep breakdowns off by default until the user enables them.
- Reuse existing design tokens, chart primitives, and table components.

## Phase 9 — verification and handoff

- Add pure tests for formula contributions, negative promotions, zero floors,
  source labels, and missing/fallback provenance.
- Run `npm test`, `npm run lint`, and `npm run build`.
- Test the fixture mode in `/scenario` in a browser.
- Disable fixtures and verify the normal API path is unchanged.
- After BigQuery and backend work lands, replace the fixture adapter with the
  real response and run the parity query before enabling frozen mode.

## Fixture removal criteria

The fixture path should remain until all of these are true:

1. the live output has populated Tier 0 component columns;
2. the baked-in snapshot endpoint returns a verified run key;
3. backend tests cover the response shape;
4. the frontend has passed with the real response;
5. the fixture flag is no longer needed for manual testing.
