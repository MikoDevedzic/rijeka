"""The desk's clock is New York from the moment the API or the worker starts, whatever the process had read before.

main.py set TZ in the environment and nothing else. glibc reads TZ once, and `import time` is that read, so every
process that imports main (uvicorn, the worker, pytest) had already made it and stayed on the host's zone until
something called tzset() for it; the first strptime does. On CI, at 00:24 UTC on 10 November 2026, the
integration suite wrote the day's marks under 10 November, parsed a timestamp, and then looked for them under
9 November. The same process, two dates. This runs the sequence in a fresh interpreter started in Tokyo, where
the wrong answer differs from the right one at every hour of the day."""
import os
import subprocess
import sys
import time
from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parents[1]
PROBE = ("import time; before = time.localtime().tm_zone; {start}; t = time.localtime(); "
         "print('CLOCK', before, time.tzname[0], t.tm_zone, t.tm_gmtoff)")


@pytest.mark.skipif(not hasattr(time, "tzset"), reason="no tzset on this platform: TZ is read by the C runtime at start")
@pytest.mark.parametrize("start", ["import main", "import worker; worker.loop = lambda *a, **k: 0; worker.main()"])
def test_the_clock_is_set_for_a_process_that_has_already_read_the_time(start):
    env = {**os.environ, "TZ": "Asia/Tokyo", "DATABASE_URL": "postgresql://clock.invalid/none", "RIJEKA_SCHEDULER": "0",
           "RIJEKA_NO_DOTENV": "1"}                           # the probe needs no settings: it never loads a developer's .env
    out = subprocess.run([sys.executable, "-c", PROBE.format(start=start)], cwd=BACKEND, env=env, capture_output=True, text=True, timeout=180)
    assert out.returncode == 0, out.stderr[-400:]
    line = [ln for ln in out.stdout.splitlines() if ln.startswith("CLOCK ")][-1].split()
    before, name, zone, offset = line[1], line[2], line[3], int(line[4])
    assert before == "JST"                                   # the process had read the clock, in the host's zone
    assert name == "EST"                                     # tzset() ran: the names Python holds are New York's
    assert zone in ("EST", "EDT") and offset in (-18000, -14400)      # and local time is New York's, not the host's
