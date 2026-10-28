"""
Measure promotion uplifts from sales data and update Promotion Uplift Settings.

This is what the Cloud Run Job `aireos-promo-measure` runs every day at
04:00 Singapore time (set up in docs/promo-uplift-runbook.md). The settings
page's Re-measure button runs the same code through the API.

Run from backend/ with the venv active (same credentials as the API):

    python -m scripts.measure_promo_uplifts

It does nothing (and records a 'skipped_unchanged' run) when no input has
changed since the last successful run. Exits with status 1 on a failure, so
Cloud Run marks the execution failed; the failure is also recorded as a
'failed' run and nothing in the settings changes.
"""

import json
import logging
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services.settings import promo_measurement


def main() -> int:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    try:
        summary = promo_measurement.run_measurement("scheduler")
    except promo_measurement.MeasurementRunningError as error:
        # Another run (e.g. a Re-measure click) is already doing the work.
        logging.info("%s", error)
        return 0
    except Exception:
        # Already logged at ERROR and recorded as a failed run.
        return 1

    print(json.dumps(summary, indent=2, default=str))
    return 0


if __name__ == "__main__":
    sys.exit(main())
