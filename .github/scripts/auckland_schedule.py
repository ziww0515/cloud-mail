"""Guard the monthly Auckland-time upstream review schedule."""
import json
import os
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

NZ = ZoneInfo("Pacific/Auckland")
SLOTS = {"0 11 28-31 * *": 13, "0 12 28-31 * *": 12}


def should_run(event_name, schedule, now=None):
    """Return whether this invocation is the intended first-day Auckland midnight run."""
    if event_name == "workflow_dispatch":
        return True
    if event_name != "schedule" or schedule not in SLOTS:
        return False
    current = now or datetime.now(timezone.utc)
    if current.tzinfo is None:
        current = current.replace(tzinfo=timezone.utc)
    local = current.astimezone(NZ)
    offset = local.utcoffset()
    if offset is None or offset.total_seconds() not in (12 * 3600, 13 * 3600):
        return False
    expected_hour = 12 if offset.total_seconds() == 12 * 3600 else 11
    utc = current.astimezone(timezone.utc)
    return (local.day == 1 and local.hour == 0 and
            utc.hour == expected_hour and
            schedule == f"0 {expected_hour} 28-31 * *")


def main():
    event = os.environ.get("GITHUB_EVENT_NAME", "")
    schedule = ""
    path = os.environ.get("GITHUB_EVENT_PATH")
    if event == "schedule" and path:
        try:
            with open(path, encoding="utf-8") as handle:
                schedule = json.load(handle).get("schedule", "")
        except (OSError, ValueError, TypeError, AttributeError):
            schedule = ""
    now = datetime.now(timezone.utc)
    run = should_run(event, schedule, now)
    local = now.astimezone(NZ).isoformat(timespec="minutes")
    reason = "manual dispatch" if event == "workflow_dispatch" else ("matched Auckland first-of-month midnight slot" if run else "not the matching Auckland slot")
    print(f"run={'true' if run else 'false'} reason={reason} local={local}")
    output = os.environ.get("GITHUB_OUTPUT")
    if output:
        with open(output, "a", encoding="utf-8") as handle:
            handle.write(f"run={'true' if run else 'false'}\n")


if __name__ == "__main__":
    main()
