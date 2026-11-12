-- Run in Singapore aireos after 011_audit_sku_price_date_corrections.sql.
-- The 1900 date was a placeholder for the first known price, not a real price date.
-- Keep historical sales from 2023 onward covered without recording a user correction.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM sku_price_periods AS legacy
        WHERE legacy.effective_from = DATE '1900-01-01'
          AND legacy.effective_to < DATE '2023-01-01'
    ) THEN
        RAISE EXCEPTION 'A legacy price period ends before 2023';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM sku_price_periods AS legacy
        JOIN sku_price_periods AS other ON other.sku = legacy.sku
            AND other.price_period_id <> legacy.price_period_id
        WHERE legacy.effective_from = DATE '1900-01-01'
          AND other.effective_from <= DATE '2023-01-01'
          AND (other.effective_to IS NULL OR other.effective_to >= DATE '2023-01-01')
    ) THEN
        RAISE EXCEPTION 'A SKU already has a price covering 1 Jan 2023';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM sku_price_periods AS legacy
        JOIN sellout AS sale ON sale.sku = legacy.sku
        WHERE legacy.effective_from = DATE '1900-01-01'
          AND sale.period_start < DATE '2023-01-01'
    ) THEN
        RAISE EXCEPTION 'Sales before 2023 would lose their effective price';
    END IF;

    UPDATE sku_price_periods
    SET effective_from = DATE '2023-01-01'
    WHERE effective_from = DATE '1900-01-01';
END
$$;
