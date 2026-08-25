# AO2-1 — Sales & Performance Dashboard: Sprint 1 Workflow

Scope: AO2-1 "View Cross-channel sales dashboard" (5 pts, Medium priority, Sandra, Sprint 1)

---

## 1. Data to confirm before you start building

From the BigQuery Explorer screenshot, the `aire-data.Aire_Data` dataset already has these tables/views:

| Table ID | Type | Notes |
|---|---|---|
| `dim_product` | Table | Likely SKU master data |
| `dim_store` | Table | Likely retailer/store master data |
| `nomenclature` | Table | Likely naming/mapping reference (ties to the SKU-naming trust issue Alan raised) |
| `pipeline_log` | Table | Likely ingestion run logs (maps to AO1-7/AO1-8) |
| `promotions` | Table | Maps to AO2-7 (promotion overlay) |
| `sellout` | Table | Raw/base sell-out data |
| `sellout_manual` | Table | Manually-entered sell-out data |
| `v_sellout_all` | **View** | Likely a combined view over `sellout` + `sellout_manual` — probably what AO2-1 should actually query |

**Scope update:** Sprint 1 is offline sell-out only, FairPrice as the first target customer. Confirmed from your query: `retailer` values include `fairprice_online`, `fairprice_offline`, `singhealth`, `pharmex`, and 7 others (11 total) — so the offline/online split you need is **already baked into the `retailer` string**, not a separate column. That means AO2-1 for this sprint should filter to `retailer = 'fairprice_offline'` specifically.

**Flagging something odd, not assuming an explanation:** the `store_format` values you got back were `FPON` (for `fairprice_online`) and `UNITY` (for `fairprice_offline`) — not the Hypermarket/Finest/Supermarket tiers from your meeting notes. Either `store_format` at the `v_sellout_all` row level means something different (maybe a banner/format code) than the store-level tiering, or the tiering lives elsewhere (possibly `dim_store`, per below) and needs a join. Worth a direct question to Alan/DCS rather than guessing — don't build tier-based logic on `store_format` until this is confirmed.

### Confirmed schema — `v_sellout_all`

| Field | Type | Maps to |
|---|---|---|
| `period_start`, `period_end` | DATE | Date range filter (AO2-4) |
| `period_type` | STRING | Likely "Weekly"/"Monthly" — drives WoW/MoM toggle (AO2-5). **Need actual values.** |
| `period_label` | STRING | Possibly a display string for the period (e.g. "Jan 2024") |
| `retailer` | STRING | Confirmed values include `fairprice_online`, `fairprice_offline`, `singhealth`, `pharmex` (11 total) — customer filter (AO2-3), per-channel card grouping (AO2-1) |
| `store_code`, `store_name`, `store_format` | STRING | Store-level granularity — see the `store_format` flag above, don't assume tier meaning yet |
| `sku`, `product_name`, `sku_range`, `size`, `brand`, `product_category` | STRING | SKU filter + display (AO2-2), SKU ranking (AO2-10) |
| `uom`, `pack_size` | STRING / INTEGER | Unit-of-measure context for quantities |
| `quantity_units` | FLOAT | **This is your "units sold"** for the summary/channel cards (AO2-1) |
| `revenue` | FLOAT | Revenue for summary/channel cards (AO2-1) |
| `source_file`, `data_source` | STRING | Traceability back to the uploaded file — useful for AO2-8 freshness/audit, not for the dashboard UI itself |
| `loaded_at` | TIMESTAMP | **This is your "Last Updated" timestamp** (AO2-8) |
| `entered_by`, `entered_at` | STRING / TIMESTAMP | Looks like manual-entry audit fields (from `sellout_manual`) |

### Confirmed schema — `dim_store`

| Field | Type | Mode | Notes |
|---|---|---|---|
| `store_code` | STRING | REQUIRED | Store identifier |
| `store_name` | STRING | NULLABLE | Canonical (standardized) store name |
| `retailer` | STRING | REQUIRED | Canonical retailer name |
| `store_format` | STRING | NULLABLE | Store format — **same "confirm the actual meaning" flag as above** |
| `is_active` | BOOLEAN | NULLABLE | Currently active/live store — relevant if AO2-1 should exclude closed stores |
| `last_validated` | DATE | NULLABLE | Last time this master record was checked |

### Confirmed schema — `dim_product`

| Field | Type | Mode | Notes |
|---|---|---|---|
| `sku` | STRING | REQUIRED | Retailer-specific SKU code |
| `canonical_name` | STRING | NULLABLE | Standardized product name — this is likely the fix for Alan's SKU-naming trust issue |
| `sku_range` | STRING | REQUIRED | e.g. Flagship, U... (truncated in your screenshot — worth confirming the full value list) |
| `retailer` | STRING | REQUIRED | Canonical retailer name |
| `size` | STRING | NULLABLE | S/M, L, or XL |
| `pack_size` | INTEGER | NULLABLE | Units per pack |

`dim_store` and `dim_product` both look like exactly the "SKU/store master reference table" your internal meeting notes describe for the validation gate — external, editable master lists that new SKUs/stores get checked against without touching code. Good sign the architecture is already being built that way.

This covers AO2-1's core needs directly: totals (sum `revenue`/`quantity_units`), per-retailer breakdown (`group by retailer`), and freshness (`max(loaded_at)`). **Not covered by this view**, and not needed for AO2-1 but coming up soon:
- **AO2-7 (promotion overlay)** → needs the `promotions` table, and a join key to line it up against `period_start`/`period_end` and `sku`/`retailer`.
- **AO2-9 (sell-in vs sell-out)** → no sell-in table is visible yet in the dataset; flag this to DCS/Alan since sell-in wasn't in this table.
- **Epic 3/4 (inventory alerts, forecasting)** → will need stock-on-hand data, which isn't in `v_sellout_all` either.

### Still open

1. What `store_format` actually represents at both the `v_sellout_all` row level and the `dim_store` master level (`FPON`/`UNITY` vs. the Hypermarket/Finest/Supermarket tiers) — needs Alan/DCS input, not an assumption.
2. ~~Full value list for `sku_range`~~ — **confirmed**: `dim_product.sku_range` is one of `Flagship`, `Ultra Pants`, or `Ultra Tape` (matches the 3 product ranges from your first client meeting).
3. **Confirmed**: `v_sellout_all` is just `UNION ALL(sellout, sellout_manual)` — it does **not** join `dim_product` or `dim_store`. Both source tables carry `product_name`/`store_name`/`brand`/`product_category` as their own flat columns already. This means whether those names are already "clean" (matching `dim_product.canonical_name`) depends on whatever ingestion process writes into `sellout`/`sellout_manual` — not on this view. Run the Option B comparison query below if you need to verify that empirically. Also worth knowing: `data_source` is hardcoded to `'pipeline'` for every `sellout` row, while `sellout_manual` keeps real `data_source`/`entered_by`/`entered_at` — so `entered_by IS NULL` reliably means "came from the automated pipeline."
4. See the calculations section directly below for where aggregation logic should live — this needs backend/DCS input to finalize, but the plan below is what to propose to them.

### How to check #3 yourself in BigQuery

Two ways — do the first one, it's more direct:

**Option A — read the view's actual SQL definition.** A view is just a saved query, so you can see exactly what it does:
```sql
SELECT view_definition
FROM `aire-data.Aire_Data.INFORMATION_SCHEMA.VIEWS`
WHERE table_name = 'v_sellout_all'
```
Run that in a new BigQuery query tab. The result is the literal SQL that builds `v_sellout_all` — if it already has a `JOIN dim_product` / `JOIN dim_store` in it, you'll see it right there, along with which columns it maps in. This is the authoritative answer, not a guess.

**Option B — sanity-check empirically**, if you want to double check what Option A tells you, or the view definition is hard to read:
```sql
SELECT
  v.sku,
  v.product_name AS v_product_name,
  p.canonical_name AS dim_canonical_name
FROM `aire-data.Aire_Data.v_sellout_all` v
LEFT JOIN `aire-data.Aire_Data.dim_product` p
  ON v.sku = p.sku AND v.retailer = p.retailer
WHERE v.retailer = 'fairprice_offline'
LIMIT 20
```
If `v_product_name` and `dim_canonical_name` already match for every row, the view is already standardizing names and you don't need to join `dim_product` again in your backend query. If they differ (or `dim_canonical_name` is null for some rows), the view is passing through raw/uncanonicalized names and your backend endpoint will need to do that join itself before returning data to the frontend — worth flagging to DCS either way, since it affects whether AO2-1's product/customer names on screen are guaranteed clean or not.

Same logic applies to `dim_store` if you want to check `store_name` cleanliness — just swap the join.

---

## 2. Where the calculations should live (backend vs. frontend)

Agreed direction: **no math in the frontend.** The frontend should receive numbers that are already correct and just render them. Here's what "the math" actually consists of for AO2-1, and where each piece belongs.

| Calculation | Formula | Where it should live | Why |
|---|---|---|---|
| Total sales / units / revenue (summary card) | `SUM(revenue)`, `SUM(quantity_units)` across all rows in the filtered range | **Backend** (SQL aggregation, either in the FastAPI query or a BigQuery view) | This is a database-level aggregation over potentially thousands of rows — doing it in SQL is both correct and cheap; pulling raw rows to sum client-side doesn't scale and risks the frontend and backend disagreeing on totals |
| Per-retailer/channel totals | `SUM(revenue) GROUP BY retailer` (or `store_name`) | **Backend** | Same reasoning — grouping belongs in the query layer |
| % of total per channel | `channel_revenue / total_revenue * 100` | **Backend**, computed alongside the group-by, and returned as a ready field (e.g. `pct_of_total: 34.2`) | Technically simple enough to do in the frontend, but keeping *all* derived numbers backend-side means the frontend has zero business logic to get wrong or duplicate later (e.g. when AO2-9 needs the same % logic for sell-in/out) |
| "Last Updated" timestamp | `MAX(loaded_at)` per channel/source | **Backend** | Same as above — it's an aggregation, not a UI concern |
| WoW/MoM comparison (AO2-5, not this ticket but coming) | Current period total vs. same calc for prior period | **Backend** — run the aggregation twice (current + prior range) and return both | Keeps the "what counts as a comparable prior period" business rule in one place instead of the frontend re-deriving date math |

**Recommended shape:** rather than the frontend calling `v_sellout_all` directly and doing any grouping, propose a dedicated FastAPI endpoint (e.g. `GET /api/dashboard/summary?retailer=fairprice_offline&period_start=...&period_end=...`) that runs the aggregation SQL against BigQuery and returns pre-computed JSON. This is worth explicitly proposing to Leandro/DCS rather than assuming — flag it as: *"can the summary endpoint return totals + per-channel breakdown + last-updated already aggregated, so the frontend only renders?"*

### Mock API contract to build against now

Until the real endpoint exists, use this shape for your mock data and design your components around it — this is what you'd hand to whoever builds the FastAPI endpoint as the target contract:

```json
{
  "summary": {
    "total_revenue": 58000.0,
    "total_units": 3400.0,
    "last_updated": "2026-08-15T09:12:00Z"
  },
  "channels": [
    {
      "retailer": "fairprice_offline",
      "revenue": 58000.0,
      "units": 3400.0,
      "pct_of_total": 100.0
    }
  ]
}
```

```json
// lib/mocks/sales-summary.json — drop this in and import it directly for now
```

```tsx
// lib/types/sales.ts
export interface ChannelSummary {
  retailer: string
  revenue: number
  units: number
  pct_of_total: number
}

export interface DashboardSummaryResponse {
  summary: {
    total_revenue: number
    total_units: number
    last_updated: string
  }
  channels: ChannelSummary[]
}
```

Your `SummaryCard` and `ChannelComparisonChart` from Section 4 below then just take this shape as props and render it — no `reduce`, no `.filter()` math, no percentage division anywhere in the component.

---

## 3. Git workflow — branch, commit, PR, merge

This follows your team's own **Definition of Done** and coding-standards docs.

### Before you touch code
- Re-read AO2-1's acceptance criteria and make sure you understand exactly what "done" looks like.
- Pull the latest `main` before branching off, so you're not building on stale code.

```bash
git checkout main
git pull origin main
```

### Create your branch

Your team's branch naming convention: `<type>(user story)/<short-name>`

| Scenario | Branch name |
|---|---|
| With ticket | `feat/AO2-1-user-authentication` *(example format — yours would be e.g. `feat/AO2-1-cross-channel-dashboard`)* |
| Without ticket | `refactor/monthly-sales-display` |

```bash
git checkout -b feat/AO2-1-cross-channel-dashboard
```
<cite index="45-1">You can also create a branch directly on GitHub: navigate to the repo, open the branch dropdown, click "New branch," name it, and choose the branch to base it on.</cite>

Since Sprint 1 has multiple people working in parallel (Xian Hui, Nisha, Leandro, Breann, Kwang Wei all have tickets this sprint too), keep your branch short-lived and pull `main` into it periodically if it's open for more than a day or two, so you're not resolving a pile of conflicts right before merging:
```bash
git checkout feat/AO2-1-cross-channel-dashboard
git merge main
```
<cite index="39-1">This keeps your pull request branch updated with changes from the base branch, resolving conflicts early and ensuring compatibility before merging.</cite>

### Commit as you go

Convention: `<type>(user story): <short description>`

| Type | When to use |
|---|---|
| `feat` | New feature/functionality |
| `fix` | Bug fix |
| `docs` | Documentation changes |
| `style` | Formatting, no logic change |
| `refactor` | Restructuring without changing behaviour |
| `test` | Adding/modifying tests |
| `chore` | Maintenance/config |

Example for this ticket: `feat(AO2-1): add summary card component`

```bash
git add .
git commit -m "feat(AO2-1): add summary card component"
git push --set-upstream origin feat/AO2-1-cross-channel-dashboard
```
<cite index="44-1">Save your work in small, meaningful commits — each commit should record a snapshot and a message describing the change.</cite>

### Before opening a PR — self-check against your Definition of Done
From your team's DoD doc, confirm all of these before requesting review:
- [ ] All of AO2-1's acceptance criteria are satisfied
- [ ] No critical/high-priority bugs remain
- [ ] Code follows the team's naming conventions (PascalCase components, kebab-case other files)
- [ ] No leftover debugging code, commented-out code, or unused variables
- [ ] If you used AI-generated code, you can fully explain every line and it's been refactored to match the project's standards — this is explicit in your DoD: *"If the submitting developer cannot confidently explain or maintain the code, the code is not considered Done."*
- [ ] New functionality tested; existing functionality isn't broken
- [ ] Relevant documentation updated (e.g. if you touched the data contract)

### Open the pull request

<cite index="44-1">A pull request proposes changes on a branch separate from the main codebase so others can review before merging.</cite> <cite index="41-1">On GitHub, once your branch has commits pushed, a yellow banner offers "Compare & pull request" — use the base branch dropdown to select `main`, and the compare branch dropdown for your feature branch.</cite>

1. Title/description: reference the ticket (`AO2-1: Cross-channel sales dashboard`), summarize what you built, and note anything DCS should double check (e.g. "assumes the `/api/dashboard/summary` endpoint returns pre-aggregated totals — confirm with Leandro" or "`store_format` meaning still unconfirmed with Alan").
2. <cite index="47-1">If your work isn't ready for review yet, open it as a **draft pull request** instead — drafts can't be merged and don't auto-request reviewers, which is useful for sharing work-in-progress without a formal review request.</cite>
3. Request review from at least one teammate — your DoD requires **peer review by at least one other team member** before merge.

### Review and merge
- Address every review comment (DoD: "Review comments have been addressed").
- Once your reviewer agrees it's understandable/maintainable and no obvious tech debt was introduced, they approve.
- Merge into `main` — DoD's final gate is **Product Owner acceptance** and a **Sprint Review demo**, so don't consider AO2-1 fully "Done" the moment it's merged; it also needs to be shown and accepted in the sprint review.

**Full DoD reference:** functional completion → code quality → AI-assisted dev check → UX consistency → testing → code review → documentation → version control → acceptance, in that order, per your team's DoD document.

---

## 4. Using shadcn/ui + the Recharts wrapper in your code

### One-time setup (check if already done for the repo)
```bash
npx shadcn@latest init
```
This creates `components.json` and asks about your Tailwind config, base color, and path aliases (`@/components`, `@/lib/utils`). <cite index="13-1">If you're adding shadcn/ui to an existing Next.js app, make sure Tailwind CSS is installed first.</cite> Skip this step if a teammate already ran it for the repo.

### Add the components AO2-1 needs
```bash
npx shadcn@latest add card
npx shadcn@latest add chart
```
This copies `components/ui/card.tsx` and `components/ui/chart.tsx` **into your repo** — <cite index="13-1">you then import them like `import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"`.</cite>

### Summary card example — consumes the mock API contract from Section 2, does zero math
```tsx
// components/dashboard/SummaryCard.tsx
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card"
import type { DashboardSummaryResponse } from "@/lib/types/sales"

// Props are exactly the "summary" shape from the API contract — nothing computed here
export function SummaryCard({ summary }: { summary: DashboardSummaryResponse["summary"] }) {
  return (
    <Card className="max-w-sm">
      <CardHeader>
        <CardTitle>Overall Sales Summary</CardTitle>
      </CardHeader>
      <CardContent className="grid grid-cols-2 gap-4">
        <div>Units Sold: {summary.total_units}</div>
        <div>Revenue: ${summary.total_revenue.toLocaleString()}</div>
        <div className="col-span-2 text-sm text-muted-foreground">
          Last Updated: {new Date(summary.last_updated).toLocaleDateString()}
        </div>
      </CardContent>
    </Card>
  )
}
```
`toLocaleString()`/`toLocaleDateString()` are display formatting, not business-logic math — that distinction is fine to keep in the component.

### Channel comparison chart example (Recharts, themed via shadcn)
```tsx
// components/dashboard/ChannelComparisonChart.tsx
"use client"

import { Bar, BarChart, CartesianGrid, XAxis } from "recharts"
import {
  ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart"
import type { ChannelSummary } from "@/lib/types/sales"

// ChartConfig maps each data series to a label + a CSS var color
// so it auto-adapts to your Tailwind light/dark theme
const chartConfig = {
  revenue: { label: "Revenue", color: "var(--chart-1)" },
} satisfies ChartConfig

// Takes the "channels" array straight from the API contract — no grouping/summing here
export function ChannelComparisonChart({ data }: { data: ChannelSummary[] }) {
  return (
    // min-h is required for Recharts' ResponsiveContainer to size correctly
    <ChartContainer config={chartConfig} className="min-h-[300px] w-full">
      <BarChart accessibilityLayer data={data}>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="retailer" />
        <ChartTooltip content={<ChartTooltipContent />} />
        <Bar dataKey="revenue" fill="var(--color-revenue)" radius={4} />
      </BarChart>
    </ChartContainer>
  )
}
```
<cite index="21-1">Note: `ChartContainer` needs a `min-h-[VALUE]` set on it for the chart to render responsively — a common gotcha if you skip it.</cite> <cite index="24-1">If a chart's tooltip shows the raw field name instead of your label, it usually means the `dataKey` doesn't match a key in your `ChartConfig` — rename one to match, or pass `nameKey`/`labelKey` explicitly.</cite>

### Composing them on the page
```tsx
// app/dashboard/sales/page.tsx
import { SummaryCard } from "@/components/dashboard/SummaryCard"
import { ChannelComparisonChart } from "@/components/dashboard/ChannelComparisonChart"
import mockData from "@/lib/mocks/sales-summary.json"
import type { DashboardSummaryResponse } from "@/lib/types/sales"
// swap mockData for a real fetch() to /api/dashboard/summary once the endpoint exists

export default async function SalesDashboardPage() {
  const data = mockData as DashboardSummaryResponse

  return (
    <div className="space-y-6 p-6">
      <SummaryCard summary={data.summary} />
      <ChannelComparisonChart data={data.channels} />
    </div>
  )
}
```

### Reference links
- shadcn/ui Card: https://ui.shadcn.com/docs/components/card
- shadcn/ui Chart: https://ui.shadcn.com/docs/components/base/chart
- Recharts docs: https://recharts.github.io/
- GitHub — Pull request quickstart: https://docs.github.com/en/pull-requests/get-started/pull-request-quickstart
- GitHub — Managing branches: https://docs.github.com/en/pull-requests/how-tos/commit-changes/managing-branches-within-your-repository
