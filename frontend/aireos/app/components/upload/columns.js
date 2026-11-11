import { ACTIONS_COLUMN, hideClass } from '@/components/ui/TableGrid';

// Recent uploads' columns. Customer, Uploaded and Status get fixed widths
// that fit their longest value (Status: the "Approved, not loaded" badge;
// Uploaded: "11 Nov 2026, 14:05"), so paging and searching never move the
// columns. File and Nomenclature share the rest and truncate (full text in
// the cell's title); Nomenclature drops out first on a narrow window, and
// the phone card view shows it again. `sortField`s are the fields
// sortUploads() in app/utils/uploadHistory.js accepts.
export const UPLOAD_COLUMNS = [
  { key: 'file', label: 'File' },
  { key: 'customer', label: 'Customer', width: '10rem' },
  { key: 'uploaded', label: 'Uploaded', width: '11rem', sortField: 'uploaded_at' },
  { key: 'status', label: 'Status', width: '13rem', sortField: 'status' },
  { key: 'nomenclature', label: 'Nomenclature', hideBelow: 'lg' },
  ACTIONS_COLUMN,
];

// The hide class per UPLOAD_COLUMNS key, for the rows' cells to carry too.
export const UPLOAD_HIDE = Object.fromEntries(UPLOAD_COLUMNS.map((column) => [column.key, hideClass(column)]));
