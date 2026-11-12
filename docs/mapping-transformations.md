# Mapping contracts: what the transformation can do

How a retailer file becomes standard sell-out rows, and the exact vocabulary Gemini may use when it
proposes a mapping. Read this before adding a transform, changing the prompt, or debugging a file
that will not load.

## The split

| Step | Module | Uses a model? |
| --- | --- | --- |
| Find the table (sheet, header row, footers, totals, stacked sheets) | `layout_detection` | No |
| Profile every column over every row, including how its values are written | `column_profile`, `value_parsing` | No |
| Propose a contract | `generate_mapping`, `mapping_prompt` | **Yes, once per new layout** |
| Validate the contract's shape | `mapping_contract.validate_contract` | No |
| Check it against the file | `mapping_checks.run_checks` | No |
| Send failed checks back for repair (at most 2 times) | `generate_mapping` | Yes |
| Review and approve | review screen, `routers/mappings.py` | No |
| Transform and load | `sellout_ingestion`, `apply_contract`, `validation_service` | **Never** |

Gemini only ever writes a contract. `apply_contract` executes it with no model: the same file and
contract always give the same rows. A known layout (same fingerprint) never calls the model again.

## Rules the transformation keeps

1. **Nothing is guessed.** A date with no format must be ISO (`2026-08-31`); `01/02/2026` is never
   read by inference. A figure must be a plain number unless `parse_number` reads it.
2. **Nothing vanishes silently.** A value a step cannot read is kept as written, so
   `validation_service` rejects that row and the load preview counts it. It is also left out of any
   monthly total rather than added as nothing.
3. **What cannot be carried out fails the file** with a `ContractApplicationError` naming the
   reason: a filter column that is missing, a divisor that is empty or 0, a file name with no month.
4. **Unknown instructions never run.** `validate_contract` drops a step it does not know and marks
   that field `not_available`; the warning goes back to the model and to the reviewer.

## Contract sections

```
layout        where the data sits (written by layout detection, recorded for the reviewer)
fields        one entry per target field: mapped | derived | constant | system | not_available
melt_groups   wide columns turned into rows (one column per period, outlet, product...)
filters       which rows are sales at all, applied before anything else is read
aggregate     roll rows up to one per retailer, store, SKU and calendar month
unsupported   what the proposal said the file needs that no instruction can do
```

### Where a field's value comes from

| Source | Written as | Use |
| --- | --- | --- |
| A column | `status: mapped, source` | The usual case |
| A melt group's heading, cells or label row | `status: mapped, melt_group` | Wide files |
| Another field | `status: derived, from_field` | Retailer from the store code |
| The period the file states above its table, or its one month heading | `from_layout: stated_period` | SingHealth, Pharmex |
| The month in the file's name | `from_layout: filename_period` | A file with no date inside (Prime sales report) |
| One cell at the top of the sheet | `from_cell: "A1"` | A month or outlet written once |
| A fixed value | `status: constant, value` | Retailer, `uom`, `period_type` |

`from_layout` fills `period_start` only and needs `period_type` to be the constant `month`.

### Row filters

```json
{"column": "Supplier", "op": "equals", "value": "XEL", "action": "keep", "case_sensitive": false}
```

`op` is `equals`, `startswith`, `endswith`, `contains`, `regex` or `empty`; `action` is `drop` or
`keep`. Filters run in order on the file's rows before melting. Rows a filter leaves out are not
checked (an unknown product code on a dropped row is not a failure). The checks fail a filter that
removes every row or names a missing column, and warn about one that removes nothing.

## Transforms

A field's `transforms` list runs in order. Empty cells stay empty unless a step says otherwise.

### Text

| Type | Parameters | Does | A value it cannot handle |
| --- | --- | --- | --- |
| `regex_extract` | `pattern`, `group` | Keeps one capture group | No match: empty |
| `split_part` | `separator`, `index` (1-based, `-1` last) | One part of `BB17 - BEDOK` | No such part: empty |
| `replace` | `pattern`, `replacement` | Every regex match becomes the replacement (`""` removes) | Left as it is |
| `normalize_text` | `case`: `upper` `lower` `title` `keep` | Collapses spaces, trims, sets case | n/a |
| `concat` | `columns`, `separator` | Joins this value with other columns of the row | Empty parts skipped |

### Translating values

| Type | Parameters | Does | A value it cannot handle |
| --- | --- | --- | --- |
| `value_map` | `values`, `default`, `case_sensitive` | Exact value to output; the product-code table | Not listed and no default: empty |
| `rules` | `rules` (`op`, `value`, `output`), `default`, `column`, `case_sensitive` | First matching rule decides | No match and no default: empty |

Both ignore case and outer spaces unless `case_sensitive`. Categories and yes/no flags are
normalised with `value_map`.

### Empty and placeholder cells

| Type | Parameters | Does |
| --- | --- | --- |
| `blank_if` | `tokens` | `N/A`, `-`, `NIL` become empty (whole value, case ignored) |
| `fill_empty` | `default` or `column` | An empty cell takes a fixed value, or the row's value in another column |
| `forward_fill` | none | An empty cell takes the value above |
| `zero_as_empty` | none | A crosstab 0 is left out instead of loaded as a row |

### Figures

| Type | Parameters | Does | A value it cannot handle |
| --- | --- | --- | --- |
| `parse_number` | `decimal`: `.` or `,` | Reads `$1,250.50`, `SGD 12`, `(120)`, `120-`, `15%` (as 15), `1.250,50` | Row rejected |
| `negate` | none | Flips the sign | Row rejected |
| `scale` | `factor` | Times a constant: `0.01` percent to fraction, `12` dozens to units | Row rejected |
| `uom_factor` | `column`, `factors`, `default` | Factor chosen by another column: cartons to packs, `-1` for return rows | Row rejected |
| `multiply` | `column` | Times the row's value in another column | Row rejected |
| `divide` | `column` | Divided by another column (pieces / pieces per pack) | Divisor empty or 0: **file fails** |
| `add` | `column` | Plus another column; an empty cell adds nothing | Row rejected |
| `subtract` | `column` | Minus another column; an empty cell takes nothing away | Row rejected |

Only `parse_number` reads formatted figures. The other steps expect plain numbers, so a formatted
column starts with `parse_number`. The *other* column of an arithmetic step is read leniently
(currency and separators allowed, decimal point).

Currency is recognised from a fixed list (symbols `$ € £ ¥ ₹`, prefixes such as `S$`, and common
ISO codes). `12 EA` and `10S` are deliberately not numbers.

### Dates

| Type | Parameters | Does | A value it cannot handle |
| --- | --- | --- | --- |
| `parse_date` | `format` | Reads a date and keeps its day | Row rejected |
| `month_start` | `format` | Reads a date and keeps the first of its month | Row rejected |

`format` is a strptime format (`%d/%m/%Y`), `excel_serial` for a day count such as `46235`, or
empty for ISO dates. `Sept` is read as `Sep`.

### Composing

```json
"quantity_units": {"status": "mapped", "source": "Qty", "transforms": [
  {"type": "blank_if", "tokens": ["N/A"]},
  {"type": "parse_number", "decimal": "."},
  {"type": "uom_factor", "column": "Type", "factors": {"RETURN": -1}, "default": 1}
]}
```

## What it cannot do

Listed to the model as `mapping_prompt.ENGINE_LIMITS`. When one of these stands between a file and
a field, the proposal marks the field `not_available` and adds an `unsupported` entry, which
reaches the reviewer as a warning check.

- No lookups across rows (only `forward_fill`) or across files.
- One table per file: the chosen sheet plus sheets with identical headers. Other sheets are not read.
- A cell holding several values cannot be split into rows.
- No rounding, conditions on amounts, exchange rates or tax tables.
- One date format per field; no week numbers, fiscal periods or quarters.
- Periods are months or weeks.
- No de-duplication: duplicate rows cannot be told from repeat sales.

## How Gemini is told

`mapping_prompt.SYSTEM_PROMPT` is built from the same constants the validator uses:

- `TRANSFORM_GUIDE` has one entry per `mapping_contract.TRANSFORM_TYPES` (a test fails if they
  differ), each stating purpose, parameters and bad-value behaviour.
- The response schema restricts `type`, filter `op` and `action` to those lists, and every column
  parameter to this file's headers.
- The profile shows how each text column is written (`written_as`): `kind: number` with its decimal
  mark and what surrounds the figures, or `kind: date` with the formats that read every value. Two
  date formats mean the values do not say whether day or month comes first.
- The checks carry the evidence back: `values_<field>` quotes the unreadable values and names the
  step to add.

## Checks added for value handling

| Check id | Level | Fails when |
| --- | --- | --- |
| `values_quantity_units`, `values_revenue`, `values_pack_size`, `values_period_start` | error above 10% unreadable, else warning | The column's values cannot be read by the field's steps |
| `melted_totals_<measure>` | error | A melt group takes in a total column |
| `filter_<n>` | error / warning | A filter cannot be applied, removes everything, or removes nothing |
| `unsupported_<n>` | warning | The proposal flagged something the vocabulary cannot do |

A field whose steps rework its text first (`regex_extract`, `value_map`...) is not judged
statically; the mapping test runs the real transformation.

## Adding a transform

1. Add the type to the right group in `mapping_contract.py` and a `_validate_*` function.
2. Implement it in `apply_contract._apply_transform`, keeping unreadable values (`_calculated`).
3. Describe it in `mapping_prompt.TRANSFORM_GUIDE`; add any new parameter to `output_schema` and
   `parse_proposal`.
4. Add it to `STEP_TYPES` in `frontend/aireos/app/utils/transformSteps.js` and its settings.
5. Test execution in `test_apply_contract.py` and validation in `test_mapping_contract.py`.
6. Rerun `python scripts/eval_mapping.py --show-diff`.

## Testing

| What | Where | Needs |
| --- | --- | --- |
| Value reading | `tests/test_value_parsing.py` | nothing |
| Each transform, filters, determinism | `tests/test_apply_contract.py` | nothing |
| Contract validation | `tests/test_mapping_contract.py` | nothing |
| Static checks | `tests/test_mapping_checks.py` | nothing |
| Prompt, schema, repair loop (scripted model) | `tests/test_generate_mapping.py` | nothing |
| Real files end to end, and rewritten in other formats | `tests/test_retailer_samples.py` | files in `tests/test_fixtures/` (skipped without) |
| Gemini's proposals against the reference contracts | `scripts/eval_mapping.py` | Vertex AI credentials; costs money |
