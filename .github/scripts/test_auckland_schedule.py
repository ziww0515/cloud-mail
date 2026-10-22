import importlib.util
import re
import unittest
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

SOURCE = Path(__file__).with_name("auckland_schedule.py")
WORKFLOW = SOURCE.parents[1] / "workflows" / "upstream-review.yml"
spec = importlib.util.spec_from_file_location("auckland_schedule_guard", SOURCE)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

UTC = timezone.utc
NZ = ZoneInfo("Pacific/Auckland")


def local_midnight(day):
    return datetime.combine(day, time.min, NZ)


class AucklandScheduleTests(unittest.TestCase):
    def test_every_month_start_2026_through_2030_and_delays(self):
        day = date(2026, 1, 1)
        end = date(2030, 12, 1)
        while day <= end:
            midnight = local_midnight(day)
            expected = midnight.astimezone(UTC)
            offset_hours = int(midnight.utcoffset().total_seconds() // 3600)
            slot = f"0 {11 if offset_hours == 13 else 12} 28-31 * *"
            self.assertTrue(module.should_run("schedule", slot, expected), day)
            for minutes in range(60):
                self.assertTrue(module.should_run("schedule", slot, expected + timedelta(minutes=minutes)), (day, minutes))
            self.assertFalse(module.should_run("schedule", slot, expected + timedelta(minutes=60)), day)
            self.assertFalse(module.should_run("schedule", slot, expected + timedelta(minutes=61)), day)
            day = (day.replace(day=28) + timedelta(days=4)).replace(day=1)

    def test_wrong_season_delays_never_duplicate(self):
        for year in range(2026, 2031):
            for month in range(1, 13):
                midnight = local_midnight(date(year, month, 1))
                expected = midnight.astimezone(UTC)
                correct_hour = 11 if midnight.utcoffset().total_seconds() == 13 * 3600 else 12
                wrong_hour = 12 if correct_hour == 11 else 11
                wrong = f"0 {wrong_hour} 28-31 * *"
                wrong_candidate = expected + timedelta(hours=wrong_hour - correct_hour)
                self.assertFalse(module.should_run("schedule", wrong, wrong_candidate), (year, month, "on-time"))
                self.assertFalse(module.should_run("schedule", wrong, wrong_candidate + timedelta(minutes=60)), (year, month, "delayed"))

    def test_non_first_local_days_and_invalid_triggers_rejected(self):
        now = datetime(2026, 1, 2, 0, 0, tzinfo=NZ).astimezone(UTC)
        self.assertFalse(module.should_run("schedule", "0 12 28-31 * *", now))
        self.assertFalse(module.should_run("push", "0 12 28-31 * *", now))
        self.assertFalse(module.should_run("schedule", "0 10 28-31 * *", now))
        self.assertFalse(module.should_run("schedule", "", now))
        self.assertFalse(module.should_run("schedule", "0 12 * * *", now))

    def test_manual_dispatch_is_allowed(self):
        self.assertTrue(module.should_run("workflow_dispatch", "anything", datetime.now(UTC)))

    def test_workflow_crons_agree_with_helper_constants(self):
        text = WORKFLOW.read_text(encoding="utf-8")
        workflow_slots = set(re.findall(r"- cron: '([^']+)'", text))
        self.assertEqual(workflow_slots, set(module.SLOTS))


if __name__ == "__main__":
    unittest.main()
