import StatusPill from './StatusPill';
import ColumnName from './ColumnName';
import { previewExtraction } from '../../utils/mappingHelpers';

// One melt group: target field, column count, extraction regex + date format, a
// preview of what the regex pulls from the first column, and the column list.
export default function MeltGroup({ group }) {
  const columns = group.columns || [];
  const sample = columns[0];
  const extracted = sample ? previewExtraction(group.period_extract_regex, sample) : null;

  return (
    <div className="mb-2 rounded-md border border-lavander bg-cream/40 px-3 py-2.5">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="font-mono text-xs font-bold text-green-700">{group.target_field}</span>
        <StatusPill variant="info">{columns.length} columns</StatusPill>
        <code className="rounded bg-lavander px-1.5 py-0.5 font-mono text-[11px] text-deep-violet-blue">
          {group.period_extract_regex}
        </code>
        <code className="rounded bg-lavander px-1.5 py-0.5 font-mono text-[11px] text-deep-violet-blue">
          {group.date_format}
        </code>
      </div>

      {sample && (
        <p className="text-xs text-deep-violet-blue/60">
          extracts{' '}
          <code className="rounded bg-lavander px-1.5 py-0.5 font-mono text-[11px] text-deep-violet-blue">
            {extracted}
          </code>{' '}
          from{' '}
          <code className="rounded bg-lavander px-1.5 py-0.5 font-mono text-[11px] text-deep-violet-blue">
            <ColumnName value={sample} />
          </code>
        </p>
      )}

      <div className="mt-1.5 flex max-h-32 flex-wrap gap-1 overflow-y-auto">
        {columns.map((column, index) => (
          <span
            key={index}
            className="rounded bg-lavander px-1.5 py-0.5 font-mono text-[11px] text-deep-violet-blue"
          >
            <ColumnName value={column} />
          </span>
        ))}
      </div>
    </div>
  );
}