'use client';

import ToggleField from '@/components/ui/ToggleField';
import { PROPOSER } from '@/app/utils/mappingReview';

import ResetButton from './ResetButton';

/**
 * The instructions that apply to the whole file rather than a field: whether
 * rows roll up to one per store, product and month (a file listing each day
 * or each delivery needs it). Sent with the rules (backend ContractSettings);
 * one left alone stays as stored.
 *
 * @param {{
 *   instructions: { aggregate: boolean },
 *   changed: boolean,
 *   onChange: (name: 'aggregate', value: boolean) => void,
 *   onReset: () => void,
 *   disabled: boolean,
 * }} props
 */
export default function FileSettings({ instructions, changed, onChange, onReset, disabled }) {
  return (
    <div className="mt-2 rounded-md border border-lavander px-2 py-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium text-deep-violet-blue">For the whole file</p>
        {changed && (
          <ResetButton label={`Reset the file settings to the ${PROPOSER}'s proposal`} onClick={onReset} disabled={disabled} />
        )}
      </div>

      <div className="mt-2">
        <ToggleField
          label="Add up rows into monthly totals"
          checked={instructions.aggregate}
          onChange={(checked) => onChange('aggregate', checked)}
          onHint="Rows for the same store and product are added together, so each month loads as one row. Use it for daily, weekly or per-delivery files."
          offHint="Every row loads as the file has it, for example one per week. Turn on if the file is not already monthly."
          disabled={disabled}
        />
      </div>
    </div>
  );
}
