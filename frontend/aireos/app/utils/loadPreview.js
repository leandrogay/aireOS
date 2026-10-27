import { formatDate } from '@/lib/formatDate';
import { formatMonth } from '@/app/utils/inventoryForm';
import { filesLabel } from '@/app/utils/uploadFlow';

// The load confirmation's figures, as pure functions: what each previewed file
// would do to sell-out, the totals for the ticked ones, and what the button
// says. Keys are backend upload_loading.preview_loads / load_uploads and
// sellout_ingestion.preview_confirmed_upload.

function plural(count, one, many) {
  return `${count.toLocaleString()} ${count === 1 ? one : many}`;
}

// The sample table's columns in the load confirmation: where and when, which
// product, and the two figures that will land on the dashboard. The review
// screen shows the first columns as they come; here the figures matter most.
export const LOAD_PREVIEW_FIELDS = [
  'period_start',
  'retailer',
  'store_name',
  'sku',
  'product_name',
  'quantity_units',
  'revenue',
];

/** Rows a file's load would overwrite that other files loaded, summed. */
export function overwrittenRows(file) {
  return (file.preview?.overwrites || []).reduce((total, item) => total + item.rows, 0);
}

/**
 * The periods a file covers, as a person reads them. Monthly rows start on the
 * 1st, so "1 Jan – 1 Aug" would read as seven months and a day: they are
 * named by month instead ("Jan 2026 – Aug 2026"). Calendar dates, never shifted.
 */
export function periodLabel(preview) {
  const first = preview?.first_period;
  const last = preview?.last_period || first;
  if (!first) return 'No periods';
  const types = preview.period_types || [];
  const monthly = types.length > 0 && types.every((type) => type === 'month');
  const format = monthly ? formatMonth : formatDate;
  return first === last ? format(first) : `${format(first)} – ${format(last)}`;
}

/**
 * What a reader should know before loading a file, as short phrases for its
 * collapsed row: skipped rows, rows replaced, rows other files loaded that it
 * overwrites. Empty when the load only adds data.
 *
 * @param {object} file a previewLoad() row
 * @returns {string[]}
 */
export function fileWarnings(file) {
  const preview = file.preview || {};
  const warnings = [];
  const overwritten = overwrittenRows(file);
  if (overwritten) warnings.push(`overwrites ${plural(overwritten, 'row', 'rows')}`);
  if (preview.rows_replaced) warnings.push(`replaces ${plural(preview.rows_replaced, 'row', 'rows')}`);
  if (preview.rows_rejected) warnings.push(`${plural(preview.rows_rejected, 'row', 'rows')} skipped`);
  return warnings;
}

/** The retailers a file writes to, by name, in the order the backend sorted them. */
export function retailerNames(preview) {
  return Object.keys(preview?.retailers || {});
}

/**
 * What the ticked files would do together, for the line above the button.
 *
 * @param {object[]} files previewLoad() rows
 * @param {Set<string>} selected blob paths ticked
 */
export function loadTotals(files, selected) {
  const chosen = files.filter((file) => file.success && selected.has(file.blob_path));
  return {
    files: chosen.length,
    rows: chosen.reduce((total, file) => total + (file.preview?.rows_to_store || 0), 0),
    overwritten: chosen.reduce((total, file) => total + overwrittenRows(file), 0),
    replaced: chosen.reduce((total, file) => total + (file.preview?.rows_replaced || 0), 0),
  };
}

/**
 * The confirm button says exactly what pressing it does -- never "Confirm".
 * With saving switched off it only checks, and says so.
 *
 * @param {number} count ticked files
 * @param {boolean} reload every ticked file is a reload with a new version
 * @param {boolean} [storageOff] loading into Cloud SQL is switched off
 */
export function loadButtonLabel(count, reload, storageOff = false) {
  if (!count) return reload ? 'Reload' : 'Load';
  const files = filesLabel(count);
  if (storageOff) return `Check ${files} (nothing will be saved)`;
  return reload ? `Reload ${files} with the new version` : `Load ${files} into sales data`;
}

/**
 * One sentence on what the ticked files will change, said before the click.
 */
export function totalsSentence(totals, storageOff = false) {
  if (storageOff) return `Reads ${plural(totals.rows, 'sales row', 'sales rows')}; none are written.`;
  const parts = [`Writes ${plural(totals.rows, 'sales row', 'sales rows')}`];
  if (totals.replaced) parts.push(`replaces ${plural(totals.replaced, 'row', 'rows')} loaded earlier from the same files`);
  if (totals.overwritten) parts.push(`overwrites ${plural(totals.overwritten, 'row', 'rows')} other files loaded`);
  return `${parts.join(', ')}.`;
}

/**
 * Whether a load result wrote to sell-out. Loading into Cloud SQL can be
 * switched off (local development): the file was read, but nothing was saved
 * and the backend leaves it loadable (upload_loading.load_uploads).
 */
export function wasSaved(result) {
  return Boolean(result?.success) && result.processing?.storage_status !== 'disabled';
}

/**
 * The load response, summed for the done screen.
 *
 * @param {{ results: object[] }} response loadUploads()
 */
export function loadOutcome(response) {
  const results = response?.results || [];
  const saved = results.filter(wasSaved);
  const checkedOnly = results.filter((item) => item.success && !wasSaved(item));
  return {
    saved,
    checkedOnly,
    failed: results.filter((item) => !item.success),
    rows: saved.reduce((total, item) => total + (item.processing?.rows_stored || 0), 0),
    checkedRows: checkedOnly.reduce((total, item) => total + (item.processing?.rows_mapped || 0), 0),
  };
}

/**
 * The dialog's heading once the load has answered: what happened, not what
 * is about to.
 *
 * @param {ReturnType<typeof loadOutcome>} outcome
 * @param {boolean} reload
 */
export function outcomeTitle(outcome, reload) {
  if (outcome.saved.length) {
    if (!reload) return 'Loaded into sales data';
    const versions = [...new Set(outcome.saved.map((item) => item.mapping_version))];
    return versions.length === 1 && versions[0] ? `Reloaded with version ${versions[0]}` : 'Reloaded with the new version';
  }
  if (outcome.checkedOnly.length) return 'Check finished: nothing was saved';
  return 'Nothing was loaded';
}
