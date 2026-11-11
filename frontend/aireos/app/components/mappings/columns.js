// The nomenclature list's columns. Customer, status and approval date get
// fixed widths that fit their longest value; the nomenclature column takes the
// rest and truncates (full text in the cell's title). `sortField`s are the
// fields sortMappings() in app/utils/mappingList.js accepts. The last column
// holds the row's "›" and is only labelled for screen readers.
export const MAPPING_COLUMNS = [
  { key: 'name', label: 'Nomenclature', sortField: 'name' },
  { key: 'customer', label: 'Customer', width: '12rem', sortField: 'customer' },
  { key: 'status', label: 'Status', width: '11rem' },
  { key: 'approved', label: 'Approved', width: '8rem' },
  { key: 'open', label: 'Actions', width: '3.5rem', hideLabel: true },
];
