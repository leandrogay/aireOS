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
// Go live once migration 006_create_promo_uplift_settings.sql has been run:
// set this to false, then delete promoUpliftsDemo.js and the `demo` import.
export const PROMO_UPLIFTS_DEMO = true;

const api = PROMO_UPLIFTS_DEMO ? demo : live;

export const {
  getPromoUpliftSettings,
  getResolvedPromoUplifts,
  savePromoUplift,
  resetPromoUplift,
  addPromoUpliftOverride,
  getPromoUpliftHistory,
  getPromoAnchors,
  savePromoAnchor,
  resetPromoAnchor,
  getPromoAnchorHistory,
} = api;
