'use client';

/**
 * "Forecast Drafts" picker in the Scenario builder header (blueprint Part
 * 1.1). There are always two draft slots, so there is no "+ New draft" yet.
 *
 * @param {{
 *   drafts: { id: string, name: string, blocks: object[], promotions: object[] }[],
 *   activeId: string,
 *   onSelect: (id: string) => void,
 * }} props
 */
export default function DraftSwitcher({ drafts, activeId, onSelect }) {
  return (
    <div className="flex items-center gap-2">
      <label htmlFor="forecast-draft" className="text-xs font-semibold text-deep-violet-blue/70">
        Forecast Drafts
      </label>
      <select
        id="forecast-draft"
        value={activeId}
        onChange={(event) => onSelect(event.target.value)}
        className="h-8 min-w-56 rounded-md border-[1.5px] border-scenario bg-white px-2 text-xs font-medium text-deep-violet-blue"
      >
        {drafts.map((draft) => {
          const count = draft.blocks.length + draft.promotions.length;
          return (
            <option key={draft.id} value={draft.id}>
              Draft: {draft.name || 'Untitled'} ({count} item{count === 1 ? '' : 's'})
            </option>
          );
        })}
      </select>
    </div>
  );
}
