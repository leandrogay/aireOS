-- Consolidate legacy archived snapshots into sku_history. The skus row stays
-- as the stable foreign-key target and is_active controls catalog visibility.
BEGIN;

DO $$
BEGIN
    IF to_regclass('public.old_skus') IS NOT NULL THEN
        INSERT INTO sku_history (
            sku,
            action,
            sku_range,
            product_name,
            size,
            brand,
            uom,
            pack_size,
            price,
            changed_at
        )
        SELECT
            legacy.sku,
            'archived',
            legacy.sku_range,
            legacy.product_name,
            legacy.size,
            legacy.brand,
            legacy.uom,
            legacy.pack_size,
            legacy.price,
            legacy.archived_at
        FROM old_skus AS legacy
        WHERE NOT EXISTS (
            SELECT 1
            FROM sku_history AS history
            WHERE
                history.sku = legacy.sku
                AND history.action = 'archived'
        );

        UPDATE skus AS master
        SET
            is_active = FALSE,
            archived_at = COALESCE(master.archived_at, legacy.archived_at)
        FROM old_skus AS legacy
        WHERE master.sku = legacy.sku;

        DROP TABLE old_skus;
    END IF;

    -- Also handles an environment where the earlier rename migration was
    -- applied before this consolidated design replaced it.
    IF to_regclass('public.archived_skus') IS NOT NULL THEN
        INSERT INTO sku_history (
            sku,
            action,
            sku_range,
            product_name,
            size,
            brand,
            uom,
            pack_size,
            price,
            changed_at
        )
        SELECT
            legacy.sku,
            'archived',
            legacy.sku_range,
            legacy.product_name,
            legacy.size,
            legacy.brand,
            legacy.uom,
            legacy.pack_size,
            legacy.price,
            legacy.archived_at
        FROM archived_skus AS legacy
        WHERE NOT EXISTS (
            SELECT 1
            FROM sku_history AS history
            WHERE
                history.sku = legacy.sku
                AND history.action = 'archived'
        );

        UPDATE skus AS master
        SET
            is_active = FALSE,
            archived_at = COALESCE(master.archived_at, legacy.archived_at)
        FROM archived_skus AS legacy
        WHERE master.sku = legacy.sku;

        DROP TABLE archived_skus;
    END IF;
END
$$;

COMMIT;
