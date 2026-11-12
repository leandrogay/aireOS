'use client';

import ToggleField from '@/components/ui/ToggleField';
import {
  BUDGET_TOGGLE_LABEL,
  BUDGET_TOGGLE_NONE_HINT,
  BUDGET_TOGGLE_OFF_HINT,
  BUDGET_TOGGLE_ON_HINT,
} from '@/app/utils/budgetPlanning';

/**
 * "Show locked yearly budget": swaps the Initial Yearly Forecast line for Aire's
 * latest locked budget in the months it covers (utils/budgetPlanning
 * budgetAsInitial / budgetAsInitialMonths). On the Forecast page's legend
 * card and under the Inventory chart's building blocks overlay; both pages
 * keep it on by default. With no locked budget in view it is greyed out and
 * says why, shown off so it never claims a budget is on the chart.
 *
 * @param {{ checked: boolean, onChange: (checked: boolean) => void, available: boolean, align?: 'top' | 'center', className?: string }} props
 *   `available`: a locked budget covers at least one month in view. `align`:
 *   'top' beside the Forecast legend (switch top level with the title);
 *   'center' on Inventory, lined up with the building blocks switch above it.
 */
export default function BudgetInitialToggle({ checked, onChange, available, align = 'top', className }) {
  return (
    <ToggleField
      label={BUDGET_TOGGLE_LABEL}
      checked={available && checked}
      onChange={onChange}
      disabled={!available}
      onHint={BUDGET_TOGGLE_ON_HINT}
      offHint={available ? BUDGET_TOGGLE_OFF_HINT : BUDGET_TOGGLE_NONE_HINT}
      align={align}
      className={className}
    />
  );
}
