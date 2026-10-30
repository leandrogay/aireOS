import * as demo from '@/app/utils/promoUpliftsDemo';
import * as live from '@/app/services/settingsApi';

// The one switch between the Promotion Uplift Settings demo and the real
// backend. Everything that reads or writes promotion uplifts imports from
// here, never from settingsApi or the demo directly.
//
// true:  an in-memory demo (app/utils/promoUpliftsDemo.js). Every button
//        works, nothing is saved, and the state resets on reload.
// false: the real /api/settings/promo-uplifts endpoints (settingsApi.js).
//
// Go live once migrations 006 and 008 have been run (docs/promo-uplift-runbook.md):
// set this to false, then delete promoUpliftsDemo.js and the `demo` import.
export const PROMO_UPLIFTS_DEMO = true;

const api = PROMO_UPLIFTS_DEMO ? demo : live;

export const {
  getPromoUpliftSettings,
  getResolvedPromoUplifts,
  savePromoUplift,
  resetPromoUplift,
  archivePromoUplift,
  restorePromoUplift,
  addPromoMechanic,
  addPromoUpliftOverride,
  getPromoUpliftHistory,
  getPromoAnchors,
  savePromoAnchor,
  resetPromoAnchor,
  getPromoAnchorHistory,
  runPromoMeasurement,
  measurePromoUpliftsIfChanged,
  getPromoMeasurementStatus,
  getPromoUpliftEvidence,
  getPromoUpliftNotes,
  applyPromoMeasuredValue,
  keepPromoTypedValue,
  getPromoRule,
  savePromoRule,
  resetPromoRule,
} = api;
