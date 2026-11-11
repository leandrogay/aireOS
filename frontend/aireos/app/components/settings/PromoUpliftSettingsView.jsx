'use client';

import { useState } from 'react';
import { RefreshCw } from 'lucide-react';

import PageLayout from '@/components/layout/PageLayout';
import { Button } from '@/components/ui/button';
import { cardClass } from '@/components/ui/formStyles';
import InfoTooltip from '@/components/ui/InfoTooltip';
import RefreshButton from '@/components/ui/RefreshButton';
import StatusPill from '@/components/ui/StatusPill';
import Toast from '@/components/ui/Toast';
import usePromoMoments from '@/hooks/usePromoMoments';
import usePromoUpliftCalc from '@/hooks/usePromoUpliftCalc';
import usePromoUpliftSettings from '@/hooks/usePromoUpliftSettings';
import useToast from '@/hooks/useToast';
import { adoptPromoAnchor, recalculatePromoUplifts } from '@/app/services/promoUpliftsApi';
import { calcStatus, monthText } from '@/app/utils/promoUpliftCalc';
import { anchorLabel } from '@/app/utils/promoUpliftSettings';

import PromoAnchorDetails from './PromoAnchorDetails';
import PromoAnchorForm from './PromoAnchorForm';
import PromoAnchorOverwriteForm from './PromoAnchorOverwriteForm';
import PromoAnchorTable from './PromoAnchorTable';
import PromoMechanicDiscountForm from './PromoMechanicDiscountForm';
import PromoMechanicTable from './PromoMechanicTable';
import PromoUpliftTable from './PromoUpliftTable';

const headingClass = 'text-sm font-medium text-deep-violet-blue';

/**
 * The Promotion uplift settings page: each customer's anchor (the mechanic
 * of an ordinary month) with its versions, the fallback anchor, each
 * mechanic's discount, and the uplift per customer x SKU range x mechanic,
 * worked out from moments (promo_recalc) -- never typed here. Edits are to
 * anchors and discounts only; each queues a recalculation, so the page
 * refetches after one and shows whether a recalculation is still waiting.
 */
export default function PromoUpliftSettingsView() {
  const [refreshKey, setRefreshKey] = useState(0);
  const { settings, anchors, loading, error } = usePromoUpliftSettings({ refreshKey });
  const calculated = usePromoUpliftCalc({ refreshKey });
  const moments = usePromoMoments({ refreshKey });
  const readOnly = !settings;
  const [anchorTarget, setAnchorTarget] = useState(null);
  const [anchorDetails, setAnchorDetails] = useState(null);
  const [editingFallback, setEditingFallback] = useState(false);
  const [mechanicTarget, setMechanicTarget] = useState(null);
  const [recalculating, setRecalculating] = useState(false);
  const { toast, notify, dismissToast } = useToast();

  const refresh = () => setRefreshKey((key) => key + 1);
  const rows = settings?.settings ?? [];
  const mechanics = rows.filter((row) => row.scope === 'all');
  const fallback = anchors?.fallback ?? null;
  const calcRows = calculated.data?.rows ?? [];
  const status = calcStatus(calculated.data?.calc_status);

  function savedNotice(result, message) {
    refresh();
    notify('success', result.changed ? `${message} · recalculating` : 'No changes to save');
  }

  async function handleAnchorAdopt(target) {
    try {
      const result = await adoptPromoAnchor(target.customerId, target.skuRange);
      const entry = result.anchor.ranges.find((item) => item.sku_range === target.skuRange) ?? result.anchor;
      setAnchorDetails(null);
      savedNotice(result, `Anchor set to ${anchorLabel(entry)}`);
    } catch (err) {
      notify('error', err.message);
    }
  }

  async function handleRecalculate() {
    setRecalculating(true);
    try {
      const result = await recalculatePromoUplifts();
      refresh();
      if (result.failed.length) {
        notify('error', `Recalculated, but ${result.failed.length} customer${result.failed.length === 1 ? '' : 's'} failed`);
      } else {
        notify('success', 'Recalculated');
      }
    } catch (err) {
      notify('error', err.message);
    } finally {
      setRecalculating(false);
    }
  }

  return (
    <PageLayout title="Promotion uplift settings">
      <div className="grid grid-cols-1 gap-3">
        <section className={cardClass}>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h2 className={headingClass}>Ordinary-month discount by customer</h2>
            <div className="flex items-center gap-2">
              {calculated.data ? (
                <span className="inline-flex items-center gap-1">
                  <StatusPill tone={status.tone}>{status.label}</StatusPill>
                  {status.error ? (
                    <InfoTooltip label="Why the last run failed">{status.error}</InfoTooltip>
                  ) : null}
                </span>
              ) : null}
              {readOnly ? null : (
                <Button variant="outline" size="sm" onClick={handleRecalculate} disabled={recalculating}>
                  <RefreshCw data-icon="inline-start" className={recalculating ? 'animate-spin' : undefined} />
                  {recalculating ? 'Recalculating…' : 'Recalculate'}
                </Button>
              )}
              <RefreshButton onClick={refresh} isRefreshing={loading} label="Refresh promotion uplift settings" />
            </div>
          </div>
          {error ? (
            <p className="mb-2 text-sm text-red-600" role="alert">
              {error}
            </p>
          ) : null}
          {anchors ? (
            <PromoAnchorTable
              anchors={anchors}
              editingKey={anchorTarget?.key ?? null}
              readOnly={readOnly}
              onView={setAnchorDetails}
              onEdit={setAnchorTarget}
              onAdopt={handleAnchorAdopt}
            />
          ) : (
            !error && <p className="text-sm text-deep-violet-blue/70">Loading…</p>
          )}
          {fallback ? (
            <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-deep-violet-blue">
              <span className="inline-flex items-center gap-1">
                If nothing is set: <span className="font-medium">{fallback.anchor_pct}% off</span>
                {fallback.effective_from ? ` · from ${monthText(fallback.effective_from)}` : null}
                <InfoTooltip label="About the fallback anchor">
                  A SKU range with no anchor uses its customer&apos;s; a customer with none uses this.
                </InfoTooltip>
              </span>
              {readOnly ? null : (
                <Button variant="outline" size="sm" onClick={() => setEditingFallback(true)}>
                  Edit
                </Button>
              )}
            </div>
          ) : null}
        </section>

        {anchorDetails ? (
          <PromoAnchorDetails
            key={anchorDetails.key}
            target={anchorDetails}
            windowMonths={anchors?.window_months}
            readOnly={readOnly}
            onEdit={(target) => {
              setAnchorDetails(null);
              setAnchorTarget(target);
            }}
            onAdopt={handleAnchorAdopt}
            onClose={() => setAnchorDetails(null)}
          />
        ) : null}

        {anchorTarget ? (
          <PromoAnchorOverwriteForm
            key={anchorTarget.key}
            target={anchorTarget}
            onSaved={(result) => {
              setAnchorTarget(null);
              savedNotice(result, 'Anchor saved');
            }}
            onCancel={() => setAnchorTarget(null)}
          />
        ) : null}

        {editingFallback && fallback ? (
          <PromoAnchorForm
            anchorPct={fallback.anchor_pct}
            settings={rows}
            onSaved={(result) => {
              setEditingFallback(false);
              savedNotice(result, 'Fallback anchor saved');
            }}
            onCancel={() => setEditingFallback(false)}
          />
        ) : null}

        <section className={cardClass}>
          <h2 className={`mb-2 flex items-center gap-1 ${headingClass}`}>
            Mechanic discounts
            <InfoTooltip label="About mechanic discounts">
              The discount each mechanic counts as. The placeholder rule and the anchors use it.
            </InfoTooltip>
          </h2>
          {settings ? (
            <PromoMechanicTable
              mechanics={mechanics}
              editingKey={mechanicTarget?.mechanic_key ?? null}
              readOnly={readOnly}
              onEdit={setMechanicTarget}
            />
          ) : (
            !error && <p className="text-sm text-deep-violet-blue/70">Loading…</p>
          )}
          {settings?.unmapped_mechanics?.length ? (
            <p className="mt-2 text-xs text-deep-violet-blue/70" role="status">
              No discount yet:{' '}
              {settings.unmapped_mechanics
                .map((row) => `${row.promotion_mechanic} (${row.promotions} promotion${row.promotions === 1 ? '' : 's'})`)
                .join(' · ')}
            </p>
          ) : null}
        </section>

        {mechanicTarget ? (
          <PromoMechanicDiscountForm
            key={mechanicTarget.mechanic_key}
            row={mechanicTarget}
            onSaved={(result) => {
              setMechanicTarget(null);
              savedNotice(result, 'Discount saved');
            }}
            onCancel={() => setMechanicTarget(null)}
          />
        ) : null}

        <PromoUpliftTable
          rows={calcRows}
          isLoading={calculated.loading}
          error={calculated.error}
          onRefresh={refresh}
          mechanicOptions={mechanics.map((row) => ({ value: row.mechanic_key, label: row.mechanic_label }))}
          moments={moments.data}
        />
        {moments.error ? (
          <p className="-mt-1 text-xs text-red-600" role="alert">
            Moments could not be loaded: {moments.error}
          </p>
        ) : null}

        <Toast toast={toast} onDismiss={dismissToast} />
      </div>
    </PageLayout>
  );
}
