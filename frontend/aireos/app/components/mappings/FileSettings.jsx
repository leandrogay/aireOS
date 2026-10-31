'use client';

import { Switch } from '@/components/ui/switch';
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

      <div className="mt-1.5 grid gap-2 sm:grid-cols-2">
        <label className="flex items-start gap-2 text-xs text-deep-violet-blue">
          <Switch
            checked={instructions.aggregate}
            onCheckedChange={(checked) => onChange('aggregate', checked)}
            disabled={disabled}
            className="mt-0.5"
          />
          <span>
            Roll up to one row per store, product and month
            <span className="block text-[11px] text-deep-violet-blue/60">
              {instructions.aggregate
                ? 'Daily, weekly or per-delivery rows are added up into their month.'
                : 'Rows load at the grain the file has, e.g. one per week.'}
            </span>
          </span>
        </label>
      </div>
    </div>
  );
}
