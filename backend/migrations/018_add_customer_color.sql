-- Run in Singapore aireos after 017_start_legacy_sku_prices_in_2023.sql.
-- Each customer's chart colour, stored once so it never moves when another
-- customer is added, renamed or deleted. Existing customers keep the colours
-- the frontend gives them today (frontend utils/customerColors.js): the five
-- named customers by customer_id, every other customer the next spare colour
-- in customer_id order. Spare colours are kept clear of the Forecast, Scenario
-- and Sell-in Outlook line colours. A customer past the spares, or one created
-- before the app picks colours itself, is left NULL and the frontend falls
-- back to a colour of its own.

BEGIN;

ALTER TABLE customers
    ADD COLUMN IF NOT EXISTS color CHAR(7);

ALTER TABLE customers
    DROP CONSTRAINT IF EXISTS ck_customers_color_hex;
ALTER TABLE customers
    ADD CONSTRAINT ck_customers_color_hex CHECK (color IS NULL OR color ~ '^#[0-9A-F]{6}$');

-- The five named customers.
UPDATE customers AS c
SET color = named.color
FROM (VALUES
    (1,  '#7A70B8'),  -- FairPrice (violet)
    (16, '#9A7B00'),  -- Sheng Siong (gold)
    (21, '#2E7BA6'),  -- NHG (blue)
    (22, '#C45C26'),  -- SingHealth (rust)
    (23, '#6B8E23')   -- Prime (olive green)
) AS named (customer_id, color)
WHERE c.customer_id = named.customer_id
  AND c.color IS NULL;

-- Every other customer: the next spare colour, in customer_id order.
WITH others AS (
    SELECT customer_id, ROW_NUMBER() OVER (ORDER BY customer_id) AS position
    FROM customers
    WHERE customer_id NOT IN (1, 16, 21, 22, 23)
      AND color IS NULL
),
spares (position, color) AS (
    VALUES
        (1, '#2D4A22'),  -- dark green
        (2, '#8E5572'),  -- mauve
        (3, '#7B2D26'),  -- maroon
        (4, '#5F0F40'),  -- plum
        (5, '#3B2F80')   -- indigo
)
UPDATE customers AS c
SET color = spares.color
FROM others
JOIN spares ON spares.position = others.position
WHERE c.customer_id = others.customer_id;

-- No two customers may share a colour.
CREATE UNIQUE INDEX IF NOT EXISTS uq_customers_color ON customers (color) WHERE color IS NOT NULL;

COMMIT;

-- Check: every customer and its colour.
-- SELECT customer_id, customer_name, color FROM customers ORDER BY customer_id;
