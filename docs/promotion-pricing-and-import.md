# Promotion pricing and calendar import

## Estimated revenue

The backend exposes `POST /api/promotions/revenue-estimate` and the reusable
`promotion_pricing.estimate_sales_revenue(rows)` service. Pass raw Cloud SQL
`sellout` rows with `sku`, `retailer_id`, `store_code`, `period_start`,
`period_end`, `quantity_units`, and `revenue`. Rows with an actual `revenue`
keep it; only NULL revenue receives an `estimated_revenue`. Nothing is written
back to `sellout` or BigQuery. An estimated row also provides
`list_price_revenue`, `effective_multiplier` and
`estimated_discount_percent` for the requested period.

For pack sales, `quantity_units` is treated as packs and the catalog price as
the price per pack. The estimated price per unit is the SKU history price on the
sale date, multiplied by the promotion mechanic and then by the voucher:

| Mechanic | Paid share per unit |
| --- | ---: |
| Buy N get M free | N / (N + M) |
| Buy N get P% off one unit | 1 − P / (100 × N) |
| P% off | 1 − P / 100 |

`$3 off $30` is estimated as another 10% reduction after the mechanic, under
the agreed assumption that everyone uses the voucher. Thus a $20 SKU with
“Buy 2 Get 30% Off” and “$3 off $30” estimates $20 × 0.85 × 0.90 = $15.30 per
unit. This is an estimate of realised revenue, not the actual checkout amount.

For a monthly aggregate and a weekly side offer, units are spread evenly over
the days of the sales period; the side offer replaces the monthly mechanic on
its active days. A monthly voucher still stacks when the side offer has no
voucher of its own. Carton promotions are ignored for pack sell-out. Conflicting
offers at the same priority return `pricing_issue` rather than a guessed
discount. The first available SKU history snapshot is used for sales predating
the start of price history, with `price_assumed_before_history: true` in the
response. Later SKU price edits cannot reprice periods covered by earlier
history snapshots.

Example body:

```json
{
  "rows": [{
    "sku": "13255043", "retailer_id": 55, "store_code": "4",
    "period_start": "2026-01-01", "period_end": "2026-01-31",
    "quantity_units": 30, "revenue": null
  }]
}
```

The dashboard currently uses `COALESCE(sellout.revenue, quantity_units *
skus.price)` in `sellout_service.py`. That hides which source revenues are
NULL and uses the current catalog price. A dashboard integration must feed
**raw** sell-out rows to this service before that fallback, then choose actual
or estimated revenue for display. This branch leaves dashboard behavior to its
owner.

## Reviewed calendar import

The two supplied calendar workbooks are parsed by
`scripts/preview_promotion_calendars.py`. It skips FairPrice (already populated),
blank template rows and carton mechanics. Where a row has
`promotion_mechanic_2`, that value replaces the first mechanic. The script
proposes the existing retailer names for Sheng Siong and NHG, Prime's offline
retailer, and SingHealth's customer scope across both channels,
and proposes catalog SKU ranges for Flagship, Ultra Pants and Ultra Tape.
These are proposals until checked against the live catalog. Every output row
has `approved: false`. A matching CSV is written for review in Excel.

From `backend/`, generate a local, gitignored JSON review draft:

```powershell
.\venv\Scripts\python.exe scripts\preview_promotion_calendars.py `
  'C:\Users\nisha\Downloads\Telegram Desktop\Aire_Promotion_Calendar_2025.xlsx' `
  'C:\Users\nisha\Downloads\Telegram Desktop\Aire_Promotion_Calendar_2026.xlsx' `
  --output reports\promotion_calendar_preview.json
```

Review source sheet, row, mechanic, voucher, dates, retailer and SKU range in
`reports/promotion_calendar_preview.csv`. Set `approved` to `TRUE` in Excel
only for rows that should be loaded, then save the CSV. Then run the catalog
preflight without writes:

```powershell
.\venv\Scripts\python.exe scripts\import_reviewed_promotions.py reports\promotion_calendar_preview.csv
```

Preflight requires the retailer, at least one existing store under it, and the
proposed SKU range in the active catalog. It reports duplicates and blocks the
whole batch if any approved row cannot be priced or matched. It links each
promotion to all **existing** stores for that retailer. The importer never
creates a catalog SKU or invents a store. After the review and preflight, the
same command with `--apply` inserts the ready promotions through the existing
promotion service. Re-running skips exact existing events.
