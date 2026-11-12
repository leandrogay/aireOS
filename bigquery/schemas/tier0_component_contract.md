# Tier 0 component contract

Status: proposed application contract, based on the live read-only capture from
2026-11-09.

## Scope

The contract applies to one Tier 0 forecast row at this grain:

```text
forecast run × customer × SKU × forecast month
```

The application dataset is
`aire-data.aireos_forecast_validation_sg`. The older
`aire-data.Aire_Data_Analytics` definition is historical reference only.

## Canonical run key

Until the pipeline exposes a dedicated immutable `forecast_run_id`, the
provisional run key is:

```text
forecast_generated_at + source_model
```

For the Current line, `forecast_generated_at` is expected to equal
`aire_forecasting_output.current_generated_at`. The timestamp is an instant in
UTC. It must not be truncated to a date.

The key is provisional because `forecast_generated_at` is currently a
timestamp column, not a declared run identifier. A future pipeline change
should add an immutable run ID and preserve this timestamp as display and
audit metadata.

## Component fields

The future application-facing Tier 0 row should expose:

| Field | Type | Meaning |
| --- | --- | --- |
| `ly_cartons` | `FLOAT64 \| NULL` | Actual cartons for the same calendar month one year before the forecast month, as visible at the forecast origin. |
| `run_rate` | `FLOAT64 \| NULL` | Mean of the available sell-out values in the series' own latest-three-month window. |
| `growth` | `FLOAT64 \| NULL` | Growth multiplier used on `ly_cartons`. It is `NULL` for the current validation pipeline because no growth factor is active. |
| `base_method` | `STRING` | The method used to form the base, currently `ly+runrate` or `runrate`. |
| `sell_out_base` | `FLOAT64 \| NULL` | The unrounded Tier 0 base before the output's rounded prediction value. |

`predicted_quantity_cartons` remains the published rounded Tier 0 prediction.
The component fields are explanatory provenance; they do not replace the
published prediction.

## Current validation formula

For the live validation definition:

```text
run_rate = AVG(available values for latest_month - 2 months through latest_month)

if ly_cartons is not NULL:
    sell_out_base = 0.5 * ly_cartons + 0.5 * run_rate
    base_method = "ly+runrate"
else:
    sell_out_base = run_rate
    base_method = "runrate"
```

The window is per customer/SKU. Missing months are skipped by the aggregate;
they are not treated as zero. `latest_month` is also per customer/SKU, not a
single global cutoff.

The current validation pipeline has no active growth factor. Therefore
`growth` must remain `NULL`, not `1.0`, until a real growth calculation is
implemented and persisted by the pipeline.

## Snapshot requirements

When these fields are persisted for scenario use, the row must also retain:

- the provisional run key;
- `latest_month`;
- the exact available recent months contributing to `run_rate`;
- `source_model`;
- the forecast month;
- whether the row is frozen or a fallback.

The scenario service must never reconstruct the recent-month window with a
global cutoff or silently label a live reconstruction as frozen.

## Parity checks before deployment

For every run/customer/SKU/month, compare:

- provisional run key;
- `source_model`;
- `ly_cartons`;
- `run_rate`;
- `growth`;
- `base_method`;
- `sell_out_base`;
- `predicted_quantity_cartons`.

The parity check must use the validation dataset and must not compare the
current application contract to the obsolete analytics formula.
