"""The watch must fail when production is wrong: each check is given a good answer and then the same answer broken
in one way. Run by CI (the `backend tests` job): python -m pytest -q .github/scripts"""
import copy
import http.server
import json
import threading
from datetime import datetime, timedelta, timezone

import pytest

import watch
from watch import Answer

NOW = datetime(2026, 11, 11, 23, 33, 24, tzinfo=timezone.utc)
SHA = "ea5422c5cc1bae50036fe22e3e8a92cf7eb9ce29"
REGISTRY = "0x920AE5AC65f72CB58af5bD3eF48168d9151dEd6e"


def answer(body, status=200, type_="application/json", headers=None) -> Answer:
    raw = body if isinstance(body, bytes) else (body if isinstance(body, str) else json.dumps(body)).encode()
    return Answer(status, type_, raw, headers or {})


def health():
    return {
        "ok": True, "checked_at": NOW.isoformat(),
        "checks": {"news": {"ok": True, "last": "2026-11-11T23:28:59+00:00", "rule": "within 3h", "feeds": "the NEWS room"},
                   "pnl": {"ok": True, "last": "2026-11-11", "rule": "on or after 2026-11-10", "feeds": "P&L"}},
        "client_errors": {"last_24h": 0},
        "scheduler": {"enabled": True, "started_at": (NOW - timedelta(hours=5)).isoformat(), "last_cycle": (NOW - timedelta(seconds=20)).isoformat(),
                      "steps": {"news": {"at": "2026-11-11T23:28:59+00:00", "ok": True, "detail": {"posted": 2}}}},
        "migrations": {"enabled": True, "approved": 4, "applied": 4, "pending": 0, "problems": 0},
        "version": "0.23.0", "commit": SHA,
    }


def broken(make, change):
    d = copy.deepcopy(make())
    change(d)
    return d


class TestHealth:
    def test_a_healthy_answer_has_nothing_wrong(self):
        assert watch.check_health(answer(health()), NOW) == []
        assert watch.check_health(answer(health()), NOW, api_commit="ea5422c") == []

    @pytest.mark.parametrize("change,says", [
        (lambda d: d["checks"]["pnl"].update(ok=False), "batch stale: pnl"),
        (lambda d: d.update(ok=False), "ok is not true"),
        (lambda d: d.update(checks={}), "no batch checks"),
        (lambda d: d["scheduler"].update(enabled=False), "scheduler: not enabled"),
        (lambda d: d["scheduler"].update(last_cycle=(NOW - timedelta(minutes=40)).isoformat()), "its loop last passed"),
        (lambda d: d["scheduler"].update(last_cycle=None), "has not passed its loop once"),
        (lambda d: d["scheduler"]["steps"]["news"].update(ok=False), "scheduler step failed: news"),
        (lambda d: d["migrations"].update(problems=1), "migrations: 1 in trouble"),
        (lambda d: d["client_errors"].update(last_24h=watch.CLIENT_ERRORS_MAX + 1), "browser errors"),
        (lambda d: d.pop("commit"), "no commit reported"),
    ])
    def test_each_thing_that_can_be_wrong_is_said(self, change, says):
        found = watch.check_health(answer(broken(health, change)), NOW)
        assert any(says in f for f in found), found

    def test_a_process_that_has_just_started_is_given_time(self):
        just = lambda d: d["scheduler"].update(started_at=(NOW - timedelta(minutes=10)).isoformat(), last_cycle=None, steps={})   # noqa: E731
        assert watch.check_health(answer(broken(health, just)), NOW) == []
        late = lambda d: d["scheduler"].update(started_at=(NOW - timedelta(minutes=40)).isoformat(), last_cycle=None, steps={})   # noqa: E731
        assert any("has not passed its loop once" in f for f in watch.check_health(answer(broken(health, late)), NOW))
        # a pass with the daily batches in it is longer than a minute and is not an alarm; an hour is
        slow = lambda d: d["scheduler"].update(last_cycle=(NOW - timedelta(minutes=20)).isoformat())                             # noqa: E731
        assert watch.check_health(answer(broken(health, slow)), NOW) == []

    def test_steps_in_a_shape_not_expected_do_not_end_the_run(self):
        assert watch.check_health(answer(broken(health, lambda d: d["scheduler"].update(steps=["news"]))), NOW) == []

    def test_the_wrong_commit_is_said(self):
        assert watch.check_health(answer(health()), NOW, api_commit="deadbee") == ["the API runs ea5422c, not deadbee"]

    @pytest.mark.parametrize("a", [answer(health(), status=503), answer("<html>bad gateway</html>", type_="text/html"),
                                   Answer(0, "", b"timed out", {}), answer([1, 2])])
    def test_no_answer_or_not_the_answer(self, a):
        assert len(watch.check_health(a, NOW)) == 1

    def test_no_answer_says_why(self):
        assert "timed out" in watch.check_health(Answer(0, "", b"timed out", {}), NOW)[0]


def pulse():
    return {"curve": {"curve_id": "USD_SOFR", "quotes": [{"tenor": "ON", "rate": 3.88}]},
            "chain": {"anchored": True, "chain_id": 11155111, "registry": REGISTRY, "latest_block": 12115007}}


class TestPulse:
    def test_good(self):
        assert watch.check_pulse(answer(pulse())) == []

    @pytest.mark.parametrize("change,says", [
        (lambda d: d["chain"].update(anchored=False), "no chain to anchor to"),
        (lambda d: d["chain"].update(latest_block=None), "node did not answer"),
        (lambda d: d["chain"].update(registry="0x12"), "no registry address"),
        (lambda d: d["chain"].update(chain_id=5), "unexpected chain id"),
        (lambda d: d.update(curve=None), "no curve published"),
    ])
    def test_broken(self, change, says):
        found = watch.check_pulse(answer(broken(pulse, change)))
        assert any(says in f for f in found), found

    def test_cors(self):
        ok = answer(pulse(), headers={"access-control-allow-origin": watch.APP})
        assert watch.check_cors(ok, watch.APP) == []
        assert watch.check_cors(answer(pulse(), headers={"access-control-allow-origin": "*"}), watch.APP) == []
        assert "is not allowed" in watch.check_cors(answer(pulse()), watch.APP)[0]
        assert "is not allowed" in watch.check_cors(ok, watch.SITE)[0]


def row():
    tx = "0x" + "3c" * 32
    return {"trade_hash": "0x" + "db" * 32, "package": True, "block_number": 12113678, "tx_hash": tx,
            "explorer_tx": f"https://sepolia.etherscan.io/tx/{tx}", "chain_id": 11155111, "registry": REGISTRY,
            "confirmed_at": 1794423852, "parties": ["254900OPPU84GM83MG36", "DEMO0000RIJEKABANK01"],
            "addresses": ["0x" + "34" * 20, "0x" + "0d" * 20], "bilateral": False, "key_sources": ["env", "dev"],
            "asset_class": "CRYPTO", "instrument_type": "CRYPTO_FORWARD", "structure": "NDF", "schema_version": 2}


def register(rows=None, total=None):
    rows = [row()] if rows is None else rows
    return {"total": len(rows) + 5 if total is None else total, "bilateral": 0, "confirmations": rows}


class TestRegister:
    def test_good(self):
        assert watch.check_register(answer(register())) == []
        assert watch.check_register(answer(register(rows=[]))) == []

    @pytest.mark.parametrize("change,says", [
        (lambda r: r.update(trade_hash="0x12"), "hash"),
        (lambda r: r.update(tx_hash="0x12"), "transaction"),
        (lambda r: r.update(tx_hash=None), "explorer link"),            # no transaction, yet a link to one
        (lambda r: r.update(registry="registry"), "registry"),
        (lambda r: r.update(block_number=0), "block"),
        (lambda r: r.update(chain_id=31337), "chain 31337"),
        (lambda r: r.update(explorer_tx="https://evil.example/tx/1"), "explorer link"),
        (lambda r: r.update(explorer_tx="https://sepolia.etherscan.io/tx/0x" + "ff" * 32), "explorer link"),
        (lambda r: r.update(parties=["254900OPPU84GM83MG36", "short"]), "parties"),
        (lambda r: r.update(parties=["254900OPPU84GM83MG36\n", "DEMO0000RIJEKABANK01"]), "parties"),
        (lambda r: r.update(asset_class="CRYPTO; DROP"), "asset_class"),
        (lambda r: r.update(tx_hash=None, explorer_tx="https://sepolia.etherscan.io/address/0x" + "ab" * 20), "explorer link"),
        (lambda r: r.update(bilateral="yes"), "bilateral"),
    ])
    def test_a_row_out_of_shape_is_said(self, change, says):
        found = watch.check_register(answer(register(rows=[broken(row, change)])))
        assert len(found) == 1 and says in found[0], found

    def test_a_record_the_registry_already_held_has_no_transaction_and_links_to_the_registry(self):
        recorded = broken(row, lambda r: r.update(tx_hash=None, explorer_tx=f"https://sepolia.etherscan.io/address/{REGISTRY}"))
        assert watch.check_register(answer(register(rows=[recorded]))) == []
        assert watch.check_register(answer(register(rows=[broken(row, lambda r: r.update(tx_hash=None, explorer_tx=None))]))) == []

    def test_a_word_is_what_the_register_itself_allows(self):
        assert watch.check_register(answer(register(rows=[broken(row, lambda r: r.update(structure="RISK REVERSAL", instrument_type="FX/NDF"))]))) == []

    def test_markup_anywhere_is_said(self):
        found = watch.check_register(answer(register(rows=[broken(row, lambda r: r.update(structure="<img src=x>"))])))
        assert any("markup" in f for f in found)

    def test_a_total_below_the_rows_and_no_answer(self):
        assert any("total" in f for f in watch.check_register(answer(register(total=0))))
        assert len(watch.check_register(answer({"detail": "nope"}, status=500))) == 1
        assert len(watch.check_register(answer({"total": 1}))) == 1

    def test_many_bad_rows_are_not_all_listed(self):
        rows = [broken(row, lambda r: r.update(trade_hash="x")) for _ in range(40)]
        found = watch.check_register(answer(register(rows=rows)))
        assert len(found) <= 9 and found[-1] == "register: further rows not listed"


PAGE = ('<!doctype html><html><head><script type="module" crossorigin src="/assets/index-abc.js"></script>'
        '<link rel="modulepreload" crossorigin href="/assets/react-def.js"><link rel="stylesheet" href="/assets/index-ghi.css">'
        '<link rel="icon" href="/favicon.svg"></head><body><div id="root"></div></body></html>')


def app_host(**replace):
    files = {"/assets/index-abc.js": answer("console.log(1)", type_="application/javascript"),
             "/assets/react-def.js": answer("export{}", type_="text/javascript"),
             "/assets/index-ghi.css": answer("body{}", type_="text/css"),
             "/version.json": answer({"commit": SHA, "built": "2026-11-11T22:57:22.033Z"}),
             "/methodology/rijeka_methodology.pdf": answer(b"%PDF-1.7 ...", type_="application/pdf")}
    files.update(replace)
    # a static host that answers a path it does not have with the page itself, as the app's host does
    return lambda path: files.get(path) or answer(PAGE, type_="text/html")


class TestApp:
    def test_good(self):
        assert watch.check_app(answer(PAGE, type_="text/html"), app_host()) == []
        assert watch.check_app(answer(PAGE, type_="text/html"), app_host(), app_commit=SHA[:7]) == []

    def test_a_script_the_host_does_not_have_is_answered_with_the_page_and_caught(self):
        found = watch.check_app(answer(PAGE, type_="text/html"), app_host(**{"/assets/index-abc.js": None}))
        assert len(found) == 1 and "/assets/index-abc.js" in found[0] and "text/html" in found[0]

    def test_a_stylesheet_gone_a_preload_gone(self):
        assert "/assets/index-ghi.css" in watch.check_app(answer(PAGE, type_="text/html"), app_host(**{"/assets/index-ghi.css": answer("", status=404, type_="text/html")}))[0]
        assert "/assets/react-def.js" in watch.check_app(answer(PAGE, type_="text/html"), app_host(**{"/assets/react-def.js": Answer(0, "", b"reset", {})}))[0]

    def test_the_page_itself(self):
        assert len(watch.check_app(answer("oops", status=502, type_="text/html"), app_host())) == 1
        assert any("no root" in f for f in watch.check_app(answer(PAGE.replace('id="root"', 'id="app"'), type_="text/html"), app_host()))
        assert any("names no script" in f for f in watch.check_app(answer('<div id="root"></div>', type_="text/html"), app_host()))

    def test_version_and_the_document(self):
        assert any("version.json" in f for f in watch.check_app(answer(PAGE, type_="text/html"), app_host(**{"/version.json": None})))
        assert watch.check_app(answer(PAGE, type_="text/html"), app_host(), app_commit="1234567") == ["the app was built from ea5422c, not 1234567"]
        assert any("methodology PDF" in f for f in watch.check_app(answer(PAGE, type_="text/html"), app_host(**{"/methodology/rijeka_methodology.pdf": None})))


def site_host(**replace):
    pages = {"/": answer("", status=302, type_="text/plain", headers={"location": "https://app.rijeka.app/"}),
             "/about": answer("<title>Rijeka | Where the trading desk meets the chain</title>", type_="text/html"),
             "/verify/": answer(f"<script>const REGISTRIES = ['{REGISTRY.lower()}']</script>", type_="text/html"),
             "/confirmations/": answer("<script>fetch('https://rijeka-api.onrender.com/api/public/confirmations')</script>", type_="text/html")}
    pages.update(replace)
    return lambda path: pages[path]


class TestSite:
    def test_good(self):
        assert watch.check_site(site_host(), REGISTRY) == []
        assert watch.check_site(site_host(), None) == []

    def test_broken(self):
        assert "front door" in watch.check_site(site_host(**{"/": answer("", status=404, type_="text/html")}), REGISTRY)[0]
        # the door answering with a page of its own, or sending a visitor somewhere that is not the app, is a failure
        assert "front door" in watch.check_site(site_host(**{"/": answer("<title>Rijeka</title>", type_="text/html")}), REGISTRY)[0]
        for elsewhere in ("https://example.com/", "https://app.rijeka.app.example.com/", "https://app.rijeka.appx/", "https://app.rijeka.app@example.com/",
                          "https://app.rijeka.app:8443/", "http://app.rijeka.app/", "/login", ""):
            assert "front door" in watch.check_site(site_host(**{"/": answer("", status=302, type_="text/plain", headers={"location": elsewhere})}), REGISTRY)[0], elsewhere

    def test_the_door_may_be_any_redirect_to_the_app(self):
        for status, to in ((301, "https://app.rijeka.app"), (302, "https://app.rijeka.app/"), (307, "https://app.rijeka.app/login"), (308, "https://app.rijeka.app/?from=site")):
            assert watch.check_site(site_host(**{"/": answer("", status=status, type_="text/plain", headers={"location": to})}), REGISTRY) == [], (status, to)
        assert "landing page" in watch.check_site(site_host(**{"/about": answer("", status=404, type_="text/html")}), REGISTRY)[0]
        assert "does not list the registry" in watch.check_site(site_host(**{"/verify/": answer("<p>verifier</p>", type_="text/html")}), REGISTRY)[0]
        assert "verifier" in watch.check_site(site_host(**{"/verify/": Answer(0, "", b"refused", {})}), REGISTRY)[0]
        assert "no longer reads the API" in watch.check_site(site_host(**{"/confirmations/": answer("<p>soon</p>", type_="text/html")}), REGISTRY)[0]


def world(**replace):
    """Every address the run reads, answered well; `replace` breaks one."""
    cors = lambda origin: {"access-control-allow-origin": origin}      # noqa: E731
    app, site = app_host(), site_host()

    def get_(url, headers=None, **_):
        if url in replace:
            return replace[url]
        origin = (headers or {}).get("Origin")
        if url == f"{watch.API}/api/ops/health":
            return answer(health())
        if url == f"{watch.API}/api/public/pulse":
            return answer(pulse(), headers=cors(origin))
        if url.startswith(f"{watch.API}/api/public/confirmations"):
            return answer(register(), headers=cors(origin))
        if url == f"{watch.APP}/":
            return answer(PAGE, type_="text/html")
        if url.startswith(watch.APP):
            return app(url[len(watch.APP):])
        return site(url[len(watch.SITE):])
    return get_


class TestRun:
    def test_everything_well(self):
        results = watch.run(get_=world(), now=NOW, pause_s=0)
        assert [what for what, _ in results] == ["API health", "chain and published market", "the app and the site may read the API",
                                                 "public register", "web app", "public site"]
        assert all(problems == [] for _, problems in results)

    @pytest.mark.parametrize("url,a,what", [
        (f"{watch.API}/api/ops/health", Answer(0, "", b"refused", {}), "API health"),
        (f"{watch.API}/api/public/pulse", answer(pulse()), "the app and the site may read the API"),
        (f"{watch.API}/api/public/confirmations?limit={watch.REGISTER_ROWS}", answer({}, status=500), "public register"),
        (f"{watch.APP}/", answer("", status=503, type_="text/html"), "web app"),
        (f"{watch.SITE}/verify/", answer("gone", status=404, type_="text/html"), "public site"),
        (f"{watch.SITE}/", answer("<title>Rijeka</title>", type_="text/html"), "public site"),          # the door answering with a page
        (f"{watch.SITE}/about", answer("gone", status=404, type_="text/html"), "public site"),
    ])
    def test_one_thing_wrong_fails_its_own_line_only(self, url, a, what):
        results = dict(watch.run(get_=world(**{url: a}), now=NOW, pause_s=0))
        assert results[what], results
        assert [k for k, v in results.items() if v] == [what]

    @pytest.mark.parametrize("blip", [lambda d: d["chain"].update(latest_block=None), lambda d: d.update(chain={"anchored": False})])
    def test_a_node_that_does_not_answer_is_asked_once_more(self, blip):
        calls = []
        slow = answer(broken(pulse, blip), headers={"access-control-allow-origin": watch.APP})
        base = world()

        def get_(url, headers=None, **kw):
            if url.endswith("/api/public/pulse"):
                calls.append(url)
                return slow if len(calls) == 1 else base(url, headers=headers)
            return base(url, headers=headers)
        assert all(p == [] for _, p in watch.run(get_=get_, now=NOW, pause_s=0))
        assert len(calls) == 2

    def test_what_production_sent_cannot_give_the_runner_a_command(self, monkeypatch, capsys):
        hostile = broken(row, lambda r: r.update(trade_hash="::error::x", chain_id="\n::stop-commands::t\x1b[31m" + "9" * 900))
        found = watch.check_register(answer(register(rows=[hostile])))
        monkeypatch.setattr(watch, "run", lambda *a, **k: [("public register", found)])
        assert watch.main([]) == 1
        out = capsys.readouterr().out
        assert "::" not in out and "\x1b" not in out
        assert all(len(line) <= 408 for line in out.splitlines())
        assert out.count("\n") == 4                       # the line, its one problem, a blank, the count: nothing more

    def test_the_exit_code(self, monkeypatch, capsys):
        monkeypatch.setattr(watch, "run", lambda *a, **k: [("API health", []), ("web app", [])])
        assert watch.main([]) == 0 and "nothing wrong" in capsys.readouterr().out
        monkeypatch.setattr(watch, "run", lambda *a, **k: [("API health", ["batch stale: pnl"]), ("web app", [])])
        assert watch.main([]) == 1
        out = capsys.readouterr().out
        assert "FAIL  API health" in out and "batch stale: pnl" in out and "ok    web app" in out and "1 problem(s)" in out


class _Handler(http.server.BaseHTTPRequestHandler):
    seen: list = []

    def do_GET(self):
        _Handler.seen.append(self.path)
        n = sum(1 for p in _Handler.seen if p == self.path)
        status = (404 if self.path == "/missing" else 500 if (self.path == "/flaky" and n < 3) or self.path == "/down"
                  else 302 if self.path == "/moved" else 200)
        self.send_response(status)
        if status == 302:
            self.send_header("Location", "/ok")
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", self.headers.get("Origin") or "none")
        self.end_headers()
        self.wfile.write(b"x" * 300_000 if self.path == "/long" else b'{"ok": true}')

    def log_message(self, *a):
        pass


@pytest.fixture()
def server():
    _Handler.seen = []
    s = http.server.HTTPServer(("127.0.0.1", 0), _Handler)
    threading.Thread(target=s.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{s.server_address[1]}"
    s.shutdown()


class TestGet:
    def test_an_answer_with_its_type_and_headers(self, server):
        a = watch.get(f"{server}/ok", headers={"Origin": "https://app.rijeka.app"})
        assert (a.status, a.type, a.json()) == (200, "application/json", {"ok": True})
        assert a.headers["access-control-allow-origin"] == "https://app.rijeka.app"
        assert len(_Handler.seen) == 1

    def test_a_server_error_is_tried_again_and_a_refusal_is_not(self, server):
        assert watch.get(f"{server}/flaky", wait_s=0).status == 200 and _Handler.seen.count("/flaky") == 3
        assert watch.get(f"{server}/down", wait_s=0).status == 500 and _Handler.seen.count("/down") == 3
        assert watch.get(f"{server}/missing", wait_s=0).status == 404 and _Handler.seen.count("/missing") == 1

    def test_a_redirect_is_not_followed(self, server):
        a = watch.get(f"{server}/moved", wait_s=0)
        assert a.status == 302 and _Handler.seen == ["/moved"]

    def test_an_answer_too_long_or_too_slow_is_no_answer(self, server, monkeypatch):
        monkeypatch.setattr(watch, "BODY_MAX", 100_000)
        a = watch.get(f"{server}/long", tries=1)
        assert a.status == 0 and "longer than" in a.said
        monkeypatch.setattr(watch, "BODY_MAX", 20_000_000)
        monkeypatch.setattr(watch, "ANSWER_MAX_S", -1.0)
        a = watch.get(f"{server}/long", tries=1)
        assert a.status == 0 and "took longer" in a.said

    def test_a_run_that_is_already_long_stops_trying_again(self, server, monkeypatch):
        monkeypatch.setattr(watch, "_budget_ends", watch.time.monotonic() - 1)
        assert watch.get(f"{server}/down", wait_s=0).status == 500 and _Handler.seen.count("/down") == 1
        monkeypatch.setattr(watch, "_budget_ends", watch.time.monotonic() + 60)
        assert watch.get(f"{server}/flaky", wait_s=0).status == 200 and _Handler.seen.count("/flaky") == 3

    def test_nothing_listening_is_no_answer_with_its_reason(self, server):
        a = watch.get(server.rsplit(":", 1)[0] + ":9", tries=2, wait_s=0, timeout=2)
        assert a.status == 0 and a.said.startswith("no answer (")
