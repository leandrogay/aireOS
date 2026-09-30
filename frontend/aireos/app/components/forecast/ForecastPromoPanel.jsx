'use client';

import { ChevronDown } from 'lucide-react';

import { cn } from '@/lib/utils';
import ForecastPointDetails from '@/components/forecast/ForecastPointDetails';
import { PACK_TYPES, promoTypeLabel, splitPromoType } from '@/app/utils/promotionForm';
import { promoIdentity, promoOverlayStyle } from '@/app/utils/forecastView';

function formatIsoDate(isoDate) {
  if (!isoDate) return '';
  return new Date(`${isoDate}T00:00:00`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
  });
}

function promoPeriodText(promo) {
  if (!promo.period_start || !promo.period_end) return promo.period_label || '—';
  return `${formatIsoDate(promo.period_start)} – ${formatIsoDate(promo.period_end)}`;
}

function promoSubtitle(promo) {
  const parts = [promoTypeLabel(promo.promo_type)];
  if (promo.period_label) parts.push(promo.period_label);
  if (promo.period_start && promo.period_end) {
    parts.push(`${formatIsoDate(promo.period_start)} – ${formatIsoDate(promo.period_end)}`);
  }
  return parts.filter(Boolean).join(' · ');
}

function packLabel(packType) {
  return PACK_TYPES.find((item) => item.value === packType)?.label ?? packType;
}

function DetailRow({ label, value }) {
  if (!value) return null;
  return (
    <div className="grid grid-cols-[4.5rem_1fr] items-start gap-2">
      <span className="text-[10px] font-semibold uppercase tracking-wide text-deep-violet-blue/45">
        {label}
      </span>
      <span className="text-[11px] font-medium text-deep-violet-blue">{value}</span>
    </div>
  );
}

export default function ForecastPromoPanel({
  monthLabel,
  seriesValues,
  details,
  formatValue,
  promos,
  openPromoId,
  onTogglePromo,
}) {
  if (!promos?.length) return null;
  const visibleSeries = (seriesValues ?? []).filter((row) => row.value != null);

  return (
    <div
      data-promo-panel="true"
      className="w-[19rem] overflow-hidden rounded-xl border border-violet/40 bg-white shadow-lg"
    >
      <div className="border-b border-lavander px-3 py-2">
        <p className="font-serif text-sm text-deep-violet-blue">{monthLabel}</p>
        {visibleSeries.length ? (
          <ul className="mt-1.5 space-y-1">
            {visibleSeries.map((row) => (
              <li key={row.key} className="flex items-center justify-between gap-3 text-[11px]">
                <span className="inline-flex min-w-0 items-center gap-1.5 text-deep-violet-blue/70">
                  <span
                    className="size-2 shrink-0 rounded-full"
                    style={{ backgroundColor: row.color }}
                    aria-hidden="true"
                  />
                  <span className="truncate">{row.label}</span>
                </span>
                <span className="font-medium tabular-nums text-deep-violet-blue">
                  {formatValue ? formatValue(row.value) : row.value}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
        <ForecastPointDetails details={details} className="mt-2 border-t border-lavander pt-2" />
      </div>
      <div className="border-b border-lavander px-3 py-1.5">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-deep-violet-blue/45">
          Promotions
        </p>
      </div>
      <ul className="max-h-[min(48vh,400px)] divide-y divide-lavander overflow-y-auto">
        {promos.map((promo) => {
          const key = promoIdentity(promo);
          const isOpen = openPromoId === key;
          const { promoType, packType } = splitPromoType(promo.promo_type);
          const swatch = promoOverlayStyle(promoType)?.fill ?? '#DFE4F7';
          const skuNames = [...new Set((promo.skus ?? []).map((sku) => sku.product_name).filter(Boolean))];
          return (
            <li key={key}>
              <button
                type="button"
                aria-expanded={isOpen}
                onClick={() => onTogglePromo(key)}
                data-promo-interactive="true"
                className={cn(
                  'pointer-events-auto flex w-full items-center gap-2 px-3 py-2 text-left transition hover:bg-cream/70',
                  isOpen && 'bg-cream/80'
                )}
              >
                <span
                  className="mt-0.5 size-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: swatch }}
                  aria-hidden="true"
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12px] font-medium text-deep-violet-blue">
                    {promo.promotion_mechanic || promoTypeLabel(promo.promo_type)}
                  </span>
                  <span
                    className="block truncate text-[10px] text-deep-violet-blue/55"
                    title={promoSubtitle(promo)}
                  >
                    {promoSubtitle(promo)}
                  </span>
                </span>
                <ChevronDown
                  className={cn(
                    'size-3.5 shrink-0 text-deep-violet-blue/45 transition',
                    isOpen && 'rotate-180'
                  )}
                />
              </button>
              {isOpen ? (
                <div className="space-y-1.5 bg-cream/40 px-3 pt-2.5 pb-2.5">
                  <DetailRow label="Period" value={promoPeriodText(promo)} />
                  <DetailRow label="Type" value={promoTypeLabel(promo.promo_type)} />
                  <DetailRow label="Pack" value={packLabel(packType)} />
                  <DetailRow label="Mechanic" value={promo.promotion_mechanic} />
                  <DetailRow label="Voucher" value={promo.voucher} />
                  {skuNames.length ? (
                    <div className="grid grid-cols-[4.5rem_1fr] items-start gap-2">
                      <span className="text-[10px] font-semibold uppercase tracking-wide text-deep-violet-blue/45">
                        SKUs
                      </span>
                      <ul className="flex flex-wrap gap-1">
                        {skuNames.map((name) => (
                          <li
                            key={name}
                            className="rounded-full border border-lavander bg-white px-2 py-0.5 text-[10px] font-medium text-deep-violet-blue"
                          >
                            {name}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
