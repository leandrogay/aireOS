import PromoUpliftSettingsView from '@/components/settings/PromoUpliftSettingsView';

// Promotion uplift settings: each customer's ordinary-month discount and the
// uplift per promotion mechanic, used by the Scenario builder. All data
// loading happens in the client tree under PromoUpliftSettingsView (backend
// /api/settings/promo-uplifts).
export default function PromoUpliftSettingsPage() {
  return <PromoUpliftSettingsView />;
}
