'use client';

import { useState } from 'react';
import { Bar, CartesianGrid, ComposedChart, Legend, Line, LabelList, XAxis, YAxis } from 'recharts';
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';
import { Message, MessageContent } from '@/components/ui/message';
import { cn } from '@/lib/utils';

const chartConfig = {
  value: { label: 'Value', color: 'var(--aire-deep-blue)' },
};

// Deliberately simple (single-series bar/line, plus an optional trend
// overlay) -- the backend only ever builds one-series charts for this MVP
// (see assistant.py's _build_chart), so this doesn't need RevenueTrendCard's
// multi-format stacking logic. color/showValueLabels/trendValues come from
// the backend's chart_style/chart_trend_values (see assistant.py's
// chart_style schema field) -- 'default' color falls back to the same CSS
// var used before this feature existed, so an unstyled chart looks
// identical to today.
// valueLabelFormat mirrors assistant.py's chart_style.value_label_format --
// 'whole_number'/'decimal'/'currency' only change how a label is displayed,
// never the underlying `value` the bar/point is actually plotted at.
function _formatValueLabel(format) {
  if (format === 'whole_number') return (v) => String(Math.round(v));
  if (format === 'decimal') return (v) => Number(v).toFixed(2);
  if (format === 'currency') return (v) => `$${Math.round(v).toLocaleString()}`;
  return undefined;
}

// Mirrors assistant.py's FONT_SIZE_PX -- same tier, same relative scale, so
// "make the font bigger" looks consistent between the chat preview and the
// exported files even though each renderer maps it independently.
const FONT_SIZE_PX = { small: 7, medium: 9, large: 12 };

function AssistantChart({
  type, categories, series, color, showValueLabels, valueLabelFormat, showGridlines, trendValues, title,
  showLegend, yAxisLabel, opacity, cornerRadius, fontSize, showDataPoints,
}) {
  if (!categories?.length || !series?.length) return null;

  const resolvedColor = color && color !== 'default' ? color : 'var(--color-value)';
  const hasTrend = trendValues?.length === categories.length;
  const labelFormatter = _formatValueLabel(valueLabelFormat);
  const tickSize = FONT_SIZE_PX[fontSize] ?? FONT_SIZE_PX.medium;
  const data = categories.map((category, i) => ({
    category,
    value: series[0].values[i],
    ...(hasTrend ? { trend: trendValues[i] } : {}),
  }));

  return (
    <>
      {title && <p className="mb-1 text-center text-[11px] font-medium text-deep-violet-blue">{title}</p>}
      <ChartContainer config={chartConfig} className="h-[140px] w-full">
        <ComposedChart data={data} margin={{ top: 4, bottom: 4, left: yAxisLabel ? 8 : 0 }}>
          {showGridlines !== false && <CartesianGrid vertical={false} />}
          <XAxis dataKey="category" tick={{ fontSize: tickSize }} />
          <YAxis
            tick={{ fontSize: tickSize }}
            width={40}
            label={yAxisLabel ? { value: yAxisLabel, angle: -90, position: 'insideLeft', style: { fontSize: tickSize } } : undefined}
          />
          <ChartTooltip content={<ChartTooltipContent />} />
          {showLegend && <Legend wrapperStyle={{ fontSize: tickSize }} />}
          {type === 'line' ? (
            <Line
              dataKey="value"
              name={series[0].label}
              stroke={resolvedColor}
              strokeWidth={2}
              strokeOpacity={opacity ?? 1}
              dot={showDataPoints ?? false}
              isAnimationActive={false}
            >
              {showValueLabels && <LabelList dataKey="value" position="top" style={{ fontSize: tickSize }} formatter={labelFormatter} />}
            </Line>
          ) : (
            <Bar
              dataKey="value"
              name={series[0].label}
              fill={resolvedColor}
              fillOpacity={opacity ?? 1}
              radius={cornerRadius ?? 0}
              isAnimationActive={false}
            >
              {showValueLabels && <LabelList dataKey="value" position="top" style={{ fontSize: tickSize }} formatter={labelFormatter} />}
            </Bar>
          )}
          {hasTrend && (
            <Line
              dataKey="trend"
              name="Trend"
              stroke="#374151"
              strokeWidth={1.5}
              strokeDasharray="4 4"
              dot={false}
              isAnimationActive={false}
            />
          )}
        </ComposedChart>
      </ChartContainer>
    </>
  );
}

function AssistantTable({ columns, rows }) {
  if (!columns?.length) return null;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[11px]">
        <thead>
          <tr className="border-b border-lavander text-left text-deep-violet-blue/60">
            {columns.map((col) => (
              <th key={col} className="py-1 pr-3 font-medium">
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-b border-lavander/50 last:border-0">
              {row.map((cell, j) => (
                <td key={j} className="py-1 pr-3 text-deep-violet-blue">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// The model tends to bold key figures with markdown (**$1,234**) even
// though nothing here renders full markdown -- this is the one piece worth
// honoring inline rather than showing raw asterisks, without pulling in a
// full markdown dependency for it.
function renderWithBold(text) {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith('**') && part.endsWith('**') ? (
      <strong key={i}>{part.slice(2, -2)}</strong>
    ) : (
      <span key={i}>{part}</span>
    )
  );
}

// Decodes the backend's base64 file bytes into a Blob and triggers a save
// via a throwaway <a download> click -- entirely client-side, no extra
// network request, and nothing persisted server-side (the file only ever
// existed in that one response).
function triggerDownload(base64, mimeType, filename) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const blob = new Blob([bytes], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

// PDF/PowerPoint are always offered under any chart/table answer -- unlike
// triggerDownload above (the model-driven "export this as..." path, which
// embeds the file as base64 in the chat response), this hits a dedicated
// stateless /export endpoint with data the frontend already has from the
// last answer, and gets the file back directly as the HTTP response body.
function ExportButtons({ message }) {
  const [pending, setPending] = useState(null);

  async function handleExport(format) {
    setPending(format);
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/assistant/export`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          format,
          answer: message.exportText || message.text,
          has_chart: message.hasChart,
          chart_type: message.chartType,
          chart_categories: message.chartCategories,
          chart_series: message.chartSeries,
          has_table: message.hasTable,
          table_columns: message.tableColumns,
          table_rows: message.tableRows,
          table_note: message.tableNote || '',
          chart_style: message.chartStyle || {},
          chart_trend_values: message.chartTrendValues || [],
        }),
      });
      if (!res.ok) throw new Error('Export failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = format === 'pdf' ? 'aireos-report.pdf' : 'aireos-report.pptx';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch {
      // best-effort affordance -- a failed export isn't worth a full error banner
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="mt-2 flex gap-1">
      {['pdf', 'pptx'].map((format) => (
        <button
          key={format}
          type="button"
          onClick={() => handleExport(format)}
          disabled={pending !== null}
          className="flex items-center gap-1 rounded-md border border-violet bg-white px-2 py-1 text-[11px] font-medium text-deep-violet-blue hover:bg-lavander disabled:opacity-50"
        >
          ⬇ {pending === format ? 'Generating…' : format === 'pdf' ? 'PDF' : 'PowerPoint'}
        </button>
      ))}
    </div>
  );
}

/**
 * One chat turn in the assistant panel, laid out with the shadcn Message
 * primitive: questions sit on the right, answers on the left, each in its own
 * bubble. An answer can carry a chart, a table, export buttons, a file to
 * download and follow-up prompts (see useAssistant's message shape).
 *
 * @param {{ message: object, onFollowUp: (prompt: string) => void }} props
 */
export default function AssistantMessage({ message, onFollowUp }) {
  const isUser = message.role === 'user';
  return (
    <Message align={isUser ? 'end' : 'start'}>
      <MessageContent>
        <div
          className={cn(
            'max-w-[85%] rounded-lg px-3 py-2 text-xs',
            isUser ? 'self-end bg-deep-violet-blue text-white' : 'self-start bg-lavander text-deep-violet-blue',
          )}
        >
          {!isUser && message.dataSource === 'analysis' && (
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-deep-violet-blue/50">
              💡 AI analysis
            </p>
          )}

          <p className="whitespace-pre-wrap">{isUser ? message.text : renderWithBold(message.text)}</p>

          {!isUser && message.hasChart && (
            <div className="mt-2 rounded bg-white p-1">
              <AssistantChart
                type={message.chartType}
                categories={message.chartCategories}
                series={message.chartSeries}
                color={message.chartStyle?.color}
                showValueLabels={message.chartStyle?.show_value_labels}
                valueLabelFormat={message.chartStyle?.value_label_format}
                showGridlines={message.chartStyle?.show_gridlines}
                trendValues={message.chartTrendValues}
                title={message.chartStyle?.title}
                showLegend={message.chartStyle?.show_legend}
                yAxisLabel={message.chartStyle?.y_axis_label}
                opacity={message.chartStyle?.opacity}
                cornerRadius={message.chartStyle?.corner_radius}
                fontSize={message.chartStyle?.font_size}
                showDataPoints={message.chartStyle?.show_data_points}
              />
            </div>
          )}

          {!isUser && message.hasTable && (
            <div className="mt-2 rounded bg-white p-1">
              <AssistantTable columns={message.tableColumns} rows={message.tableRows} />
              {message.tableNote && (
                <p className="mt-1 text-[10px] italic text-deep-violet-blue/60">{message.tableNote}</p>
              )}
            </div>
          )}

          {!isUser && (message.hasChart || message.hasTable) && <ExportButtons message={message} />}

          {!isUser && message.hasDownload && (
            <button
              type="button"
              onClick={() => triggerDownload(message.downloadBase64, message.downloadMimeType, message.downloadFilename)}
              className="mt-2 flex items-center gap-1 rounded-md border border-violet bg-white px-2 py-1 text-[11px] font-medium text-deep-violet-blue hover:bg-lavander"
            >
              ⬇ Download {message.downloadFilename}
            </button>
          )}

          {!isUser && message.followUpPrompts?.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {message.followUpPrompts.map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  onClick={() => onFollowUp(prompt)}
                  className="rounded-full border border-violet bg-white px-2 py-1 text-[11px] text-deep-violet-blue hover:bg-lavander"
                >
                  {prompt}
                </button>
              ))}
            </div>
          )}
        </div>
      </MessageContent>
    </Message>
  );
}
