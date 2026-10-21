'use client';

import { useState } from 'react';
import { Copy } from 'lucide-react';

import { Card, CardContent } from '@/components/ui/card';
import ImpactTable from '@/components/scenario/ImpactTable';
import { formatMonthLabel } from '@/app/utils/forecastView';
import { monthSpanLabel, pitchSummaryText } from '@/app/utils/scenarioPitch';

function formatUnits(value) {
  return Math.round(value).toLocaleString('en-US');
}

function formatDollars(value) {
  return `$${Math.round(value).toLocaleString('en-US')}`;
}

function percent(share, digits = 0) {
  return share == null ? '—' : `${(share * 100).toFixed(digits)}%`;
}

// The four cards' headline value and the sentence under it (blueprint Part
// 2.1), from scenarioPitch.pitchMetrics.
function metricCards(metrics) {
  const { revenue, dip, gap, attainment } = metrics;
  return [
    {
      key: 'revenue',
      label: 'Top-line revenue impact',
      value: `+${formatDollars(revenue.added)}`,
      detail: revenue.months.length
        ? `+${percent(revenue.pctOfCurrent, 1)} gross revenue vs the Current forecast across ${monthSpanLabel(revenue.months)}.`
        : 'No building blocks or promotions fall inside the current filters.',
    },
    {
      key: 'dip',
      label: 'Seasonal dip flattened',
      value: percent(dip.share),
      share: dip.share,
      detail: dip.share == null
        ? `No forecast month in view falls below the seasonal average${dip.average == null ? '' : ` of ${formatUnits(dip.average)} units/mo`}.`
        : `of the ${formatUnits(dip.total)}-unit dip below the seasonal average (${formatUnits(dip.average)}/mo) in ${dip.months.map(formatMonthLabel).join(', ')} is filled.`,
    },
    {
      key: 'gap',
      label: 'Forecast gap closed',
      value: percent(gap.share),
      share: gap.share,
      detail: gap.share == null
        ? 'Current already meets the Initial Yearly Forecast in the forecast months in view.'
        : `of the ${formatUnits(gap.shortfall)}-unit shortfall between Current and the Initial Yearly Forecast is closed.`,
    },
    {
      key: 'attainment',
      label: 'Attainment vs Initial Yearly Forecast',
      value: attainment.before == null ? '—' : `${percent(attainment.before, 1)} → ${percent(attainment.after, 1)}`,
      detail: attainment.target
        ? `of the ${formatUnits(attainment.target)}-unit Initial Yearly Forecast in view (actuals + forecast).`
        : 'No Initial Yearly Forecast for the months in view.',
    },
  ];
}

/**
 * Pitch summary under the chart (blueprint Part 2): four metric cards, the
 * impact table and a copy-to-clipboard summary for management. "Save as
 * pitch version" and the before/after delta badges come later.
 *
 * @param {{
 *   scope: string,
 *   metrics: object,
 *   rows: object[],
 *   metric: 'units' | 'revenue',
 * }} props metrics from pitchMetrics, rows from impactRows
 */
export default function PitchSummaryCard({ scope, metrics, rows, metric }) {
  const [copyStatus, setCopyStatus] = useState('');
  const cards = metricCards(metrics);
  const format = metric === 'revenue' ? formatDollars : formatUnits;
  const unitLabel = metric === 'revenue' ? 'revenue ($)' : 'volume (units)';

  async function copySummary() {
    const text = pitchSummaryText({
      scope,
      cards,
      unitLabel,
      items: rows.map((row) => ({
        title: row.title,
        subtitle: `${row.customer} · ${row.sku || 'All SKUs'}`,
        months: monthSpanLabel([row.startMonth, row.endMonth].filter(Boolean)),
        before: row.totals ? format(metric === 'revenue' ? row.totals.baseRevenue : row.totals.baseUnits) : '—',
        after: row.totals
          ? format(
              metric === 'revenue'
                ? row.totals.baseRevenue + row.totals.deltaRevenue
                : row.totals.baseUnits + row.totals.deltaUnits
            )
          : '—',
        uplift: row.totals
          ? `+${format(metric === 'revenue' ? row.totals.deltaRevenue : row.totals.deltaUnits)} (${row.upliftLabel})`
          : 'outside chart filters',
        explanation: row.explanation,
      })),
    });
    try {
      await navigator.clipboard.writeText(text);
      setCopyStatus('Pitch summary copied. Paste it into an email or slide.');
    } catch {
      setCopyStatus('Copying is blocked in this browser.');
    }
  }

  return (
    <Card size="sm" className="rounded-lg border-[1.5px] border-scenario bg-white text-deep-violet-blue shadow-sm ring-0">
      <CardContent className="space-y-3">
        <p className="font-serif text-base">Pitch summary</p>

        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          {cards.map((card) => (
            <div key={card.key} className="rounded-md bg-scenario-soft p-3">
              <p className="text-[11px] text-scenario-ink">{card.label}</p>
              <p className="my-1 font-serif text-xl leading-tight">{card.value}</p>
              <p className="text-[11px] text-deep-violet-blue/70">{card.detail}</p>
              {'share' in card ? (
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-lavander">
                  <div
                    className="h-full rounded-full bg-scenario"
                    style={{ width: `${Math.round(Math.min(1, card.share ?? 0) * 100)}%` }}
                  />
                </div>
              ) : null}
            </div>
          ))}
        </div>

        <p className="text-xs font-semibold">
          Impact by building block & promotion{' '}
          <span className="font-normal text-deep-violet-blue/55">· {unitLabel}</span>
        </p>
        <ImpactTable rows={rows} metric={metric} format={format} />
        <p className="text-[11px] text-deep-violet-blue/55">
          Only switched-on items count. Each is measured on its own customer and SKU; items outside the chart
          filters show no numbers until the page loads every customer and SKU.
        </p>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={copySummary}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-lavander bg-white px-3 text-xs font-medium hover:bg-cream"
          >
            <Copy className="size-3.5" />
            Copy pitch summary
          </button>
          {copyStatus ? <span className="text-[11px] text-deep-violet-blue/60">{copyStatus}</span> : null}
        </div>
      </CardContent>
    </Card>
  );
}
