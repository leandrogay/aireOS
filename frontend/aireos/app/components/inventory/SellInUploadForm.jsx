'use client';

import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { applySellInUpload, previewSellInUpload } from '@/app/services/inventoryApi';
import { formatMonth, formatUnits } from '@/app/utils/inventoryForm';
import { retailerLabel } from '@/app/utils/retailerLabel';

import { formFieldClass, formLabelClass, StatTag } from './InventoryChrome';
import InventoryTableFrame, { inventoryRowClass, inventoryTdClass, inventoryThClass } from './InventoryTableFrame';
import { primaryButtonClass, secondaryButtonClass } from './formStyles';

const STATUS_LABELS = { new: 'New', changed: 'Changed', unchanged: 'Same' };

const NOTICE_CLASS = 'rounded-lg border border-lavander bg-white px-3 py-2.5 shadow-sm';

function plural(count, word) {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

/**
 * Sell-in from the sell-in tracker's 'Data Entry SI' sheet, saved as actual
 * sell-in for each customer, SKU and month in it. Preview first: it shows what
 * would be new or changed and lists the lines that could not be matched, then
 * Save writes the file's values (overwriting what is there). Only finished
 * months with sell-out loaded are saved.
 *
 * @param {object} props
 * @param {(message: string) => void} props.onSaved called with the confirmation text
 */
export default function SellInUploadForm({ onSaved }) {
  const [file, setFile] = useState(null);
  const [fileKey, setFileKey] = useState(0);
  const [preview, setPreview] = useState(null);
  const [previewing, setPreviewing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  function chooseFile(next) {
    setFile(next);
    setPreview(null);
    setError('');
  }

  function handleCancel() {
    setFile(null);
    setFileKey((key) => key + 1);
    setPreview(null);
    setError('');
  }

  async function handlePreview() {
    setPreviewing(true);
    setError('');
    setPreview(null);
    try {
      setPreview(await previewSellInUpload(file));
    } catch (err) {
      setError(err.message);
    } finally {
      setPreviewing(false);
    }
  }

  async function handleSave() {
    setSaving(true);
    setError('');
    try {
      const result = await applySellInUpload(file);
      onSaved(
        `Sell-in saved from ${file.name}: ${plural(result.records_written, 'value')} updated, ${result.unchanged} already the same.`,
      );
      handleCancel();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  const writable = preview ? preview.counts.new + preview.counts.changed : 0;
  const skippedLines = preview ? preview.skipped.reduce((sum, item) => sum + item.lines, 0) : 0;
  const skippedByReason = preview
    ? Object.entries(
        preview.skipped.reduce((totals, item) => {
          totals[item.reason] = (totals[item.reason] ?? 0) + item.lines;
          return totals;
        }, {}),
      )
    : [];

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-deep-violet-blue/80">
        Upload the sell-in tracker (the Data Entry SI sheet). Each line&apos;s month of sales, customer, product and
        quantity in packs becomes actual sell-in for that customer, SKU and month. Preview first to see what will change.
      </p>

      <label>
        <span className={formLabelClass}>Sell-in tracker (.xlsx)</span>
        <input
          key={fileKey}
          type="file"
          accept=".xlsx"
          onChange={(e) => chooseFile(e.target.files?.[0] ?? null)}
          className={`${formFieldClass} max-w-xl py-1 file:mr-3 file:rounded-md file:border-0 file:bg-lavander file:px-2.5 file:py-1 file:text-xs file:text-deep-violet-blue`}
        />
      </label>

      <div className="flex gap-2">
        <Button type="button" onClick={handlePreview} disabled={!file} className={primaryButtonClass}>
          {previewing ? 'Reading file…' : 'Preview'}
        </Button>
        {preview && (
          <Button type="button" onClick={handleSave} disabled={writable === 0 || saving} className={primaryButtonClass}>
            {saving ? 'Saving…' : `Save ${plural(writable, 'value')}`}
          </Button>
        )}
        <Button
          type="button"
          variant="outline"
          onClick={handleCancel}
          disabled={saving}
          className={secondaryButtonClass}
        >
          Cancel
        </Button>
      </div>

      {error && (
        <p className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">
          {error}
        </p>
      )}

      {preview && (
        <>
          <div className={`${NOTICE_CLASS} flex flex-wrap items-center gap-1.5`} role="status">
            <StatTag label="New" value={preview.counts.new} />
            <StatTag label="Changed" value={preview.counts.changed} />
            <StatTag label="Same" value={preview.counts.unchanged} />
            {skippedLines > 0 && <StatTag label="Not saved" value={plural(skippedLines, 'line')} />}
          </div>

          <InventoryTableFrame title="Values from the file" rows={preview.rows}>
            {(visible, monthHeader) => (
              <table className="w-full text-left text-xs text-deep-violet-blue">
                <thead className="sticky top-0 z-10 bg-cream">
                  <tr className="border-b border-lavander">
                    <th className={inventoryThClass}>Customer</th>
                    {monthHeader}
                    <th className={inventoryThClass}>Product</th>
                    <th className={`${inventoryThClass} tabular-nums`}>Qty in packs</th>
                    <th className={`${inventoryThClass} tabular-nums`}>Current</th>
                    <th className={inventoryThClass}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((row) => (
                    <tr key={`${row.customer_id}-${row.month}-${row.sku}`} className={inventoryRowClass}>
                      <td className={inventoryTdClass}>{retailerLabel(row.customer_name)}</td>
                      <td className={inventoryTdClass}>{formatMonth(row.month)}</td>
                      <td className={inventoryTdClass}>{row.product_name}</td>
                      <td className={`${inventoryTdClass} tabular-nums`}>{formatUnits(row.qty)}</td>
                      <td className={`${inventoryTdClass} tabular-nums`}>
                        {row.current === null ? '—' : formatUnits(row.current)}
                      </td>
                      <td className={inventoryTdClass}>{STATUS_LABELS[row.status]}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </InventoryTableFrame>

          {preview.skipped.length > 0 && (
            <div className={`${NOTICE_CLASS} space-y-2`} role="status">
              <p className="text-xs text-deep-violet-blue">
                <span className="font-medium">Not saved</span>
                <span className="text-deep-violet-blue/70">
                  {' '}
                  — matched to no inventory customer, product or finished month with sell-out loaded.
                </span>
              </p>
              <div className="flex flex-wrap gap-1.5">
                {skippedByReason.map(([reason, lines]) => (
                  <StatTag key={reason} label={reason} value={plural(lines, 'line')} />
                ))}
              </div>
              <details className="text-xs text-deep-violet-blue">
                <summary className="cursor-pointer font-medium">Show lines</summary>
                <table className="mt-2 w-full text-left">
                  <thead className="border-b border-lavander">
                    <tr>
                      <th className={inventoryThClass}>Reason</th>
                      <th className={inventoryThClass}>Customer</th>
                      <th className={inventoryThClass}>Month</th>
                      <th className={inventoryThClass}>Description</th>
                      <th className={`${inventoryThClass} tabular-nums`}>Lines</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.skipped.map((item) => (
                      <tr key={`${item.reason}-${item.customer_name}-${item.month}-${item.description}`} className={inventoryRowClass}>
                        <td className={inventoryTdClass}>{item.reason}</td>
                        <td className={inventoryTdClass}>{item.customer_name}</td>
                        <td className={inventoryTdClass}>{item.month ? formatMonth(item.month) : '—'}</td>
                        <td className={inventoryTdClass}>{item.description || '—'}</td>
                        <td className={`${inventoryTdClass} tabular-nums`}>{item.lines}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </details>
            </div>
          )}
        </>
      )}
    </div>
  );
}
