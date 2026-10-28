-- To run this migration in Cloud SQL, in the `aireos` database on instance aireos-postgresql
-- (instructions: docs/promo-uplift-runbook.md).
--
-- Promotion uplift settings for the Scenario builder's Promotions tab and the
-- Forecast > Promotion uplift settings page (future promotions only; the
-- existing promotions table is not touched). All three tables are
-- append-only, like doh_settings: an edit supersedes the current row and
-- inserts a new one, so every earlier value is kept.
BEGIN;

CREATE TABLE IF NOT EXISTS promo_uplift_settings (
    id BIGSERIAL PRIMARY KEY,
    mechanic_key VARCHAR(50) NOT NULL,
    mechanic_label VARCHAR(100) NOT NULL,
    effective_discount_pct NUMERIC(5,2),
    scope VARCHAR(10) NOT NULL
        CHECK (scope IN ('all', 'customer', 'range', 'sku')),
    customer_id INTEGER REFERENCES customers(customer_id),
    sku_range VARCHAR(255),
    sku VARCHAR(100) REFERENCES skus(sku),
    uplift_pct NUMERIC(6,2) NOT NULL
        CHECK (uplift_pct BETWEEN -90 AND 300),
    -- rule_based: worked out from the rule (promo_rule_settings) and the
    -- customer's anchor; measured: the measurement job; estimate: typed by a
    -- person; learned: reserved for the forecasting model.
    source VARCHAR(20) NOT NULL
        CHECK (source IN ('rule_based', 'measured', 'estimate', 'learned')),
    -- 'voucher' rows have no discount of their own (e.g. "$5 off $50").
    kind VARCHAR(10) NOT NULL DEFAULT 'promotion'
        CHECK (kind IN ('promotion', 'voucher')),
    -- Months of evidence behind a measured uplift. Fractional: a side offer
    -- on a third of a month, or in a third of the usual stores, counts as a
    -- third of a month.
    evidence_months NUMERIC(6,2),
    note TEXT,
    changed_by VARCHAR(255) NOT NULL,
    changed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    superseded_at TIMESTAMPTZ,
    -- Set on the version a user archived: the mechanic stays in the table
    -- (and in history) but is no longer offered or measured. Restoring is a
    -- new version with this empty again.
    archived_at TIMESTAMPTZ,
    -- The scope columns must match the scope.
    CONSTRAINT chk_promo_uplift_scope_columns CHECK (
        (scope = 'all'      AND customer_id IS NULL     AND sku_range IS NULL     AND sku IS NULL) OR
        (scope = 'customer' AND customer_id IS NOT NULL AND sku_range IS NULL     AND sku IS NULL) OR
        (scope = 'range'    AND customer_id IS NOT NULL AND sku_range IS NOT NULL AND sku IS NULL) OR
        (scope = 'sku'      AND customer_id IS NOT NULL AND sku_range IS NULL     AND sku IS NOT NULL)
    )
);

-- One current row per mechanic and scope.
CREATE UNIQUE INDEX IF NOT EXISTS uq_promo_uplift_current
    ON promo_uplift_settings (
        mechanic_key, scope,
        COALESCE(customer_id, 0), COALESCE(sku_range, ''), COALESCE(sku, '')
    )
    WHERE superseded_at IS NULL;

CREATE TABLE IF NOT EXISTS promo_anchor_settings (
    id BIGSERIAL PRIMARY KEY,
    customer_id INTEGER REFERENCES customers(customer_id),  -- NULL = all customers
    anchor_pct NUMERIC(5,2) CHECK (anchor_pct BETWEEN 0 AND 100),
    source VARCHAR(20) NOT NULL CHECK (source IN ('manual', 'suggested')),
    changed_by VARCHAR(255) NOT NULL,
    changed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    superseded_at TIMESTAMPTZ,
    -- A manual row carries a value; a 'suggested' row means "use the data".
    CONSTRAINT chk_promo_anchor_value CHECK (
        (source = 'manual' AND anchor_pct IS NOT NULL) OR
        (source = 'suggested' AND anchor_pct IS NULL)
    )
);

-- One current row per customer, and one for all customers.
CREATE UNIQUE INDEX IF NOT EXISTS uq_promo_anchor_current
    ON promo_anchor_settings (COALESCE(customer_id, 0))
    WHERE superseded_at IS NULL;

-- The rule behind rule-based uplifts, for all customers: assume sales rise
-- uplift_per_point_pct % for every percentage point of discount deeper than
-- the customer's normal (anchor) discount. 0.4 = 5 points deeper -> +2%.
-- No upper limit here: the rate only shapes planning values, and every
-- rule-based uplift is kept within -90..+300 where it is worked out.
CREATE TABLE IF NOT EXISTS promo_rule_settings (
    id BIGSERIAL PRIMARY KEY,
    uplift_per_point_pct NUMERIC(6,2) NOT NULL CHECK (uplift_per_point_pct > 0),
    changed_by VARCHAR(255) NOT NULL,
    changed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    superseded_at TIMESTAMPTZ
);

-- One current row.
CREATE UNIQUE INDEX IF NOT EXISTS uq_promo_rule_current
    ON promo_rule_settings ((superseded_at IS NULL))
    WHERE superseded_at IS NULL;

INSERT INTO promo_rule_settings (uplift_per_point_pct, changed_by)
SELECT 0.4, 'seed'
WHERE NOT EXISTS (SELECT 1 FROM promo_rule_settings);

INSERT INTO promo_anchor_settings (customer_id, anchor_pct, source, changed_by)
VALUES (NULL, 20, 'manual', 'seed')
ON CONFLICT DO NOTHING;

-- Starting rows: the rule at 0.4% per point with the all-customers anchor of
-- 20% (a reference only; rule-based uplifts are worked out again from each
-- customer's anchor whenever they are used). The voucher has no discount, so
-- the rule never applies to it: it stays +3.
INSERT INTO promo_uplift_settings
    (mechanic_key, mechanic_label, kind, effective_discount_pct, scope, uplift_pct, source, changed_by)
VALUES
    ('pct_off_5',     '5% Off',            'promotion', 5,    'all', -6, 'rule_based', 'seed'),
    ('pct_off_10',    '10% Off',           'promotion', 10,   'all', -4, 'rule_based', 'seed'),
    ('pct_off_15',    '15% Off',           'promotion', 15,   'all', -2, 'rule_based', 'seed'),
    ('pct_off_20',    '20% Off',           'promotion', 20,   'all',  0, 'rule_based', 'seed'),
    ('pct_off_25',    '25% Off',           'promotion', 25,   'all',  2, 'rule_based', 'seed'),
    ('b2_pct_off_25', 'Buy 2 Get 25% Off', 'promotion', 25,   'all',  2, 'rule_based', 'seed'),
    ('pct_off_27',    '27% Off',           'promotion', 27,   'all',  3, 'rule_based', 'seed'),
    ('pct_off_30',    '30% Off',           'promotion', 30,   'all',  4, 'rule_based', 'seed'),
    ('b2_pct_off_30', 'Buy 2 Get 30% Off', 'promotion', 30,   'all',  4, 'rule_based', 'seed'),
    ('b2g1',          'Buy 2 Get 1 Free',  'promotion', 33.3, 'all',  5, 'rule_based', 'seed'),
    ('pct_off_50',    '50% Off',           'promotion', 50,   'all', 12, 'rule_based', 'seed'),
    ('b1g1',          'Buy 1 Get 1 Free',  'promotion', 50,   'all', 12, 'rule_based', 'seed'),
    ('voucher',       'Voucher',           'voucher',   NULL, 'all',  3, 'rule_based', 'seed')
ON CONFLICT DO NOTHING;

COMMIT;
