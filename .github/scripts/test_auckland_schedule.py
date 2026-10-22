import importlib.util
import unittest
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

SOURCE = Path(__file__).with_name("auckland_schedule.py")
spec = importlib.util.spec_from_file_location("auckland_schedule_guard", SOURCE)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

UTC = timezone.utc
NZ = ZoneInfo("Pacific/Auckland")
SCHEDULES = {11: "0 11 * * 0", 12: "0 12 * * 0"}


def local_midnight(day):
    return datetime.combine(day, time.min, NZ)


class AucklandScheduleTests(unittest.TestCase):
    def test_every_monday_2026_through_2030(self):
        day = date(2026, 1, 1)
        end = date(2030, 12, 31)
        while day <= end:
            if day.weekday() == 0:
                midnight = local_midnight(day)
                expected = midnight.astimezone(UTC)
                offset_hours = int(midnight.utcoffset().total_seconds() // 3600)
                slot = SCHEDULES[12 if offset_hours == 12 else 11]
                self.assertTrue(module.should_run("schedule", slot, expected), day)
                self.assertTrue(module.should_run("schedule", slot, expected + timedelta(minutes=59)), day)
                # Delays of an hour or more are intentionally skipped; cron delivery is best effort.
                self.assertFalse(module.should_run("schedule", slot, expected + timedelta(minutes=60)), day)
                other_hour = 12 if expected.hour == 11 else 11
                other = expected.replace(hour=other_hour)
                self.assertFalse(module.should_run("schedule", SCHEDULES[other_hour], other), day)
                # Best effort: a delayed wrong seasonal slot must not duplicate the run.
                self.assertFalse(module.should_run("schedule", SCHEDULES[other_hour], other + timedelta(minutes=60)), day)
                self.assertFalse(module.should_run("schedule", SCHEDULES[other_hour], other + timedelta(minutes=65)), day)
            day += timedelta(days=1)

    def test_dst_transition_adjacent_dates_2026_2027(self):
        # Mondays immediately around the March/April and September/October changes.
        for year in (2026, 2027):
            dates = ((3, 30), (4, 6), (9, 28), (10, 5)) if year == 2026 else ((3, 29), (4, 5), (9, 27), (10, 4))
            for month, day in dates:
                midnight = local_midnight(date(year, month, day))
                utc_midnight = midnight.astimezone(UTC)
                hour = int(midnight.utcoffset().total_seconds() // 3600)
                slot = SCHEDULES[12 if hour == 12 else 11]
                self.assertTrue(module.should_run("schedule", slot, utc_midnight))

    def test_manual_dispatch_is_allowed(self):
        self.assertTrue(module.should_run("workflow_dispatch", "anything", datetime.now(UTC)))

    def test_invalid_events_and_crons_rejected(self):
        now = datetime(2026, 1, 5, tzinfo=NZ).astimezone(UTC)
        self.assertFalse(module.should_run("push", "0 12 * * 0", now))
        self.assertFalse(module.should_run("schedule", "0 10 * * 0", now))
        self.assertFalse(module.should_run("schedule", "", now))
        self.assertFalse(module.should_run("schedule", "0 12 * * 0", now.replace(hour=13)))


if __name__ == "__main__":
    unittest.main()
