import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { currentLineValues } from '../app/utils/sellInOutlookLines.js';

function month(name, fields) {
  return {
    month: name,
    forecast_source: null,
    sell_in_actual: null,
    sell_out_actual: null,
    sell_in_recommended: null,
    sell_out_forecast: null,
    ...fields,
  };
}

// Sep and Oct are actual for every SKU but one, whose own plan is 0 and 14.
const MONTHS = [
  month('2026-08-01', { sell_in_actual: 1676, sell_out_actual: 1989 }),
  month('2026-09-01', { sell_in_actual: 2160, sell_out_actual: 2198, sell_in_recommended: 0, sell_out_forecast: 14, forecast_source: 'current' }),
  month('2026-10-01', { sell_in_actual: 2460, sell_out_actual: 2671, sell_in_recommended: 0, sell_out_forecast: 16, forecast_source: 'current' }),
  month('2026-11-01', { sell_in_recommended: 2644, sell_out_forecast: 2648, forecast_source: 'current' }),
];

describe('currentLineValues', () => {
  it('leaves the months before the last actual one empty, even with one SKU planned there', () => {
    const lines = currentLineValues(MONTHS, '2026-10-01');

    assert.equal(lines[1].sell_in_recommended, null);
    assert.equal(lines[1].sell_out_current, null);
  });

  it('starts each line at the last actual month, on the actual', () => {
    const lines = currentLineValues(MONTHS, '2026-10-01');

    assert.equal(lines[2].sell_in_recommended, 2460);
    assert.equal(lines[2].sell_out_current, 2671);
  });

  it('carries the forecast after the last actual month', () => {
    const lines = currentLineValues(MONTHS, '2026-10-01');

    assert.equal(lines[3].sell_in_recommended, 2644);
    assert.equal(lines[3].sell_out_current, 2648);
  });

  it('draws no join when nothing is planned after the last actual month', () => {
    const lines = currentLineValues(MONTHS.slice(0, 3), '2026-10-01');

    assert.equal(lines[2].sell_in_recommended, null);
    assert.equal(lines[2].sell_out_current, null);
  });

  it('keeps sell-out off the Current line on months that use the initial forecast', () => {
    const initial = [month('2026-11-01', { sell_in_recommended: 10, sell_out_forecast: 20, forecast_source: 'initial' })];

    assert.equal(currentLineValues(initial, '2026-10-01')[0].sell_out_current, null);
  });

  it('gives the overlay lines the same start as the lines they adjust', () => {
    const withBlocks = MONTHS.map((row, index) => (index === 3 ? { ...row, sell_in_with_blocks: 2700, sell_out_with_blocks: 2750 } : row));

    const lines = currentLineValues(withBlocks, '2026-10-01');

    assert.equal(lines[1].sell_in_with_blocks, null);
    assert.equal(lines[2].sell_in_with_blocks, 2460);
    assert.equal(lines[2].sell_out_with_blocks, 2671);
    assert.equal(lines[3].sell_out_with_blocks, 2750);
  });
});
