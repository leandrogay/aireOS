'use client';

import { usePlotArea, useXAxisScale } from 'recharts';

import { monthLabelsTilted } from '@/app/utils/trendChart';

// A flat month label ("Aug 2025", about 46px at 11px) is skipped when its weeks
// are narrower than this (a single week of a month at the edge of a range),
// so flat labels never run into each other; the tooltip still dates it.
// Tilted labels need no room across, so every month keeps its label.
const MIN_FLAT_LABEL_WIDTH = 50;

/**
 * The x-axis of a long run of weeks, drawn by month inside the chart's SVG
 * (a child of <BarChart> / <LineChart>, whose own x-axis labels are hidden by
 * periodAxisProps): a small mark under every week, each month's name under
 * the middle of its own weeks, and a faint dashed line between months running
 * up through the plot, so it is plain which bars or points belong to which
 * month. Up to 6 months the labels sit flat; more tilt 45°, like the By month
 * view (monthLabelsTilted). Months have 4 or 5 weeks, so a month's width
 * follows the calendar.
 *
 * @param {{ groups: Array<{ label: string, values: string[] }> | null }} props weekMonthGroups
 */
export default function MonthAxis({ groups }) {
  const xScale = useXAxisScale();
  const plot = usePlotArea();
  if (!groups || !xScale || !plot) return null;

  // The middle of a week's slot: its bar's centre, or its line point.
  const centre = (value) => xScale(value, { position: 'middle' });
  const bottom = plot.y + plot.height;
  const tilted = monthLabelsTilted(groups);
  const weekCentres = groups.flatMap((group) => group.values.map(centre)).filter((x) => x != null);
  const slot = weekCentres.length > 1 ? weekCentres[1] - weekCentres[0] : plot.width;

  return (
    <g aria-hidden="true">
      {groups.map((group, index) => {
        const xs = group.values.map(centre).filter((x) => x != null);
        if (xs.length === 0) return null;
        const first = xs[0];
        const last = xs.at(-1);
        const middle = (first + last) / 2;
        const nextFirst = groups[index + 1] ? centre(groups[index + 1].values[0]) : null;
        const divider = nextFirst != null ? (last + nextFirst) / 2 : null;
        const showLabel = tilted || last - first + slot >= MIN_FLAT_LABEL_WIDTH;
        return (
          <g key={`${group.label}-${index}`}>
            {xs.map((x) => (
              <line key={x} x1={x} x2={x} y1={bottom} y2={bottom + 4} className="stroke-deep-violet-blue/30" />
            ))}
            {showLabel &&
              (tilted ? (
                // Ends at the month's middle and runs down-left, like the
                // tilted labels of the By month view.
                <text
                  x={middle}
                  y={bottom + 10}
                  textAnchor="end"
                  dominantBaseline="middle"
                  transform={`rotate(-45 ${middle} ${bottom + 10})`}
                  className="fill-deep-violet-blue/70 text-[11px]"
                >
                  {group.label}
                </text>
              ) : (
                <text x={middle} y={bottom + 20} textAnchor="middle" className="fill-deep-violet-blue/70 text-[11px]">
                  {group.label}
                </text>
              ))}
            {divider != null && (
              <line
                x1={divider}
                x2={divider}
                y1={plot.y}
                y2={bottom + (tilted ? 6 : 24)}
                strokeDasharray="3 3"
                className="stroke-deep-violet-blue/15"
              />
            )}
          </g>
        );
      })}
    </g>
  );
}
