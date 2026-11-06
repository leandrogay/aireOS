-- Run in Singapore aireos as postgres before enabling event refresh.
-- Archive and restore must be recorded in the same transaction as the SKU write.
BEGIN;

ALTER TABLE public.forecast_refresh_requests
    DROP CONSTRAINT IF EXISTS forecast_refresh_requests_kind_check;
ALTER TABLE public.forecast_refresh_requests
    ADD CONSTRAINT forecast_refresh_requests_kind_check
    CHECK (kind IN ('sales_upload', 'promotion_change', 'sku_change'));

ALTER TABLE public.sku_history
    DROP CONSTRAINT IF EXISTS ck_sku_history_action;
ALTER TABLE public.sku_history
    ADD CONSTRAINT ck_sku_history_action
    CHECK (action IN ('created', 'updated', 'archived', 'restored'));

COMMIT;
