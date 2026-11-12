"""Work out the promotion moments, uplifts and projected anchors again.

Run after migration 023 (the first fill), after repairing promotion store
links, or whenever the worked-out tables look wrong: they are derived, so
rebuilding loses nothing. --customer-id limits it to one customer.
Writes to Cloud SQL (the three calc tables, and projected rows in
promo_anchor_settings when official promotions change a future anchor).
"""

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.services.settings import promo_recalc


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--customer-id", type=int, default=None, help="Only this customer (default: every customer)")
    args = parser.parse_args()

    result = promo_recalc.recalculate(args.customer_id)
    print(json.dumps(result, indent=2, default=str))
    if result["failed"]:
        sys.exit(1)


if __name__ == "__main__":
    main()
