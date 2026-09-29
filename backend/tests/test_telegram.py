"""
Telegram channel adapter: rendering, link codes, the after-commit outbox and
the webhook's authentication. No network — the Bot API client is faked.
"""
import uuid
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest

from chain import telegram as tg


class FakeBot:
    def __init__(self):
        self.sent = []
    def send_message(self, chat_id, text, **kw):
        self.sent.append((str(chat_id), text)); return {"ok": True}
    def get_me(self):
        return {"ok": True, "result": {"username": "RijekaConfirmBot"}}
    def set_webhook(self, url, secret):
        return {"ok": True}


# ── Rendering ────────────────────────────────────────────────────────────────

class TestRender:
    ROOM = uuid.uuid4(); MSG = uuid.uuid4()

    def _card(self):
        return {"type": "trade", "trade_ref": "TRD-1", "booker_firm": "RIJEKA CAPITAL", "cp_firm": "CONFLUENCE BANK AG",
                "trade_hash": "0x" + "ab" * 32, "schema_version": 2, "uti": "254900OPPU84GM83MG36" + "Z" * 32,
                "summary": {"instrument": "IR_SWAP", "structure": "VANILLA", "notional": "10,000,000", "ccy": "USD",
                            "effective_date": "2026-09-24", "maturity_date": "2031-09-24",
                            "legs": [{"leg_type": "FIXED", "rate": "4.115%", "frequency": "ANNUAL", "day_count": "ACT/360"},
                                     {"leg_type": "FLOAT", "index": "USD_SOFR", "spread_bp": 0, "frequency": "ANNUAL"}]}}

    def test_trade_card_has_terms_hash_and_deep_link(self, monkeypatch):
        monkeypatch.setenv("RIJEKA_PUBLIC_URL", "https://rijeka.app/")
        t = tg.render_card(self._card(), self.ROOM, self.MSG)
        assert "Trade for confirmation · TRD-1" in t
        assert "RIJEKA CAPITAL → CONFLUENCE BANK AG" in t
        assert "IR_SWAP · VANILLA · 10,000,000 USD" in t
        assert "FIXED · 4.115% · ANNUAL · ACT/360" in t and "FLOAT · USD_SOFR" in t
        assert "<code>0xabababab…ababab</code>" in t and "record v2" in t
        # the deep link is an anchor; '&' is attribute-escaped as HTML requires
        assert f'<a href="https://rijeka.app/messenger?room={self.ROOM}&amp;card={self.MSG}">' in t

    def test_html_is_escaped(self):
        c = self._card(); c["booker_firm"] = "<b>EVIL & CO</b>"
        t = tg.render_card(c, self.ROOM, self.MSG)
        assert "&lt;b&gt;EVIL &amp; CO&lt;/b&gt;" in t and "<b>EVIL" not in t

    def test_trade_event_card(self):
        c = {"type": "trade_event", "status": "CONFIRMED", "card_message_id": str(self.MSG),
             "explorer_tx": "https://sepolia.etherscan.io/tx/0x1", "body": "✓ TRD-1 confirmed on-chain"}
        t = tg.render_card(c, self.ROOM, uuid.uuid4())
        assert t.startswith("<b>✓ Confirmed on-chain</b>") and 'href="https://sepolia.etherscan.io/tx/0x1"' in t
        assert f"room={self.ROOM}&amp;card={self.MSG}" in t

    def test_other_cards_and_plain_messages_are_not_mirrored(self):
        assert tg.render_card({"type": "poll"}, self.ROOM, self.MSG) is None
        assert tg.render_card({}, self.ROOM, self.MSG) is None


# ── Link codes ───────────────────────────────────────────────────────────────

def _code_row(room_id, user_id, *, used=False, expired=False):
    now = datetime.now(timezone.utc)
    return SimpleNamespace(code="ABCD2345", room_id=room_id, user_id=user_id, used_at=(now if used else None),
                           expires_at=now + (timedelta(minutes=-1) if expired else timedelta(minutes=5)))


class TestLinkCodes:

    def test_code_alphabet_and_length(self):
        for _ in range(50):
            c = tg.new_code()
            assert len(c) == 8 and set(c) <= set("ABCDEFGHJKLMNPQRSTUVWXYZ23456789")

    def test_issue_adds_row_with_ttl(self):
        db = MagicMock(); room, user = uuid.uuid4(), uuid.uuid4()
        code = tg.issue_code(db, room, user)
        row = db.add.call_args[0][0]
        assert row.code == code and row.room_id == room and row.user_id == user
        assert row.expires_at - datetime.now(timezone.utc) < tg.CODE_TTL + timedelta(seconds=5)

    def _db(self, code_row, existing_for_chat=None, existing_link=None):
        db = MagicMock()
        def get(model, key):
            if model.__name__ == "TelegramLinkCode":
                return code_row if key == "ABCD2345" else None
            if model.__name__ == "TelegramLink":
                return existing_link
            return None
        db.get.side_effect = get
        db.query.return_value.filter.return_value.first.return_value = existing_for_chat
        return db

    def test_redeem_success_creates_link_and_burns_code(self):
        room, user = uuid.uuid4(), uuid.uuid4()
        row = _code_row(room, user); db = self._db(row)
        link = tg.redeem_code(db, " abcd2345 ", "-1001", "Rijeka <> Confluence")
        assert (link.room_id, link.chat_id, link.chat_title, link.linked_by) == (room, "-1001", "Rijeka <> Confluence", user)
        assert row.used_at is not None
        db.add.assert_called_once()

    def test_redeem_rejects_unknown_used_expired(self):
        room, user = uuid.uuid4(), uuid.uuid4()
        with pytest.raises(ValueError, match="isn't one Rijeka issued"):
            tg.redeem_code(self._db(None), "ZZZZ9999", "-1", None)
        with pytest.raises(ValueError, match="already used"):
            tg.redeem_code(self._db(_code_row(room, user, used=True)), "ABCD2345", "-1", None)
        with pytest.raises(ValueError, match="expired"):
            tg.redeem_code(self._db(_code_row(room, user, expired=True)), "ABCD2345", "-1", None)

    def test_group_already_linked_elsewhere_is_refused(self):
        room, user = uuid.uuid4(), uuid.uuid4()
        other = SimpleNamespace(room_id=uuid.uuid4(), chat_id="-1")
        with pytest.raises(ValueError, match="already linked to a different"):
            tg.redeem_code(self._db(_code_row(room, user), existing_for_chat=other), "ABCD2345", "-1", None)

    def test_relink_same_room_updates_in_place(self):
        room, user = uuid.uuid4(), uuid.uuid4()
        existing = SimpleNamespace(room_id=room, chat_id="-old", chat_title="old", linked_by=None, linked_at=None)
        db = self._db(_code_row(room, user), existing_link=existing)
        link = tg.redeem_code(db, "ABCD2345", "-new", "new")
        assert link is existing and existing.chat_id == "-new"
        db.add.assert_not_called()


# ── Outbox ───────────────────────────────────────────────────────────────────

class TestOutbox:

    def test_enqueue_is_noop_without_token(self, monkeypatch):
        monkeypatch.delenv("TELEGRAM_BOT_TOKEN", raising=False)
        db = MagicMock(); db.info = {}
        tg.enqueue(db, uuid.uuid4())
        assert tg.OUTBOX_KEY not in db.info

    def test_enqueue_records_when_configured(self, monkeypatch):
        monkeypatch.setenv("TELEGRAM_BOT_TOKEN", "t")
        db = MagicMock(); db.info = {}
        a, b = uuid.uuid4(), uuid.uuid4()
        tg.enqueue(db, a); tg.enqueue(db, b)
        assert db.info[tg.OUTBOX_KEY] == [a, b]

    def test_rollback_discards_outbox(self):
        s = MagicMock(); s.info = {tg.OUTBOX_KEY: [uuid.uuid4()]}
        tg._discard(s)
        assert tg.OUTBOX_KEY not in s.info

    def _session(self, msg, link):
        db = MagicMock()
        def get(model, key):
            return {"ChatMessage": msg, "TelegramLink": link}.get(model.__name__)
        db.get.side_effect = get
        return db

    def test_deliver_sends_only_linked_mirrored_cards(self, monkeypatch):
        room, mid = uuid.uuid4(), uuid.uuid4()
        bot = FakeBot()
        msg = SimpleNamespace(id=mid, room_id=room, body="Shared TRD-1", card={"type": "trade", "trade_ref": "TRD-1",
                              "trade_hash": "0x" + "cd" * 32, "summary": {"legs": []}})
        link = SimpleNamespace(chat_id="-77", last_sent_at=None)
        with patch("db.session.SessionLocal", return_value=self._session(msg, link)):
            assert tg.deliver(mid, sender=bot) is True
        assert bot.sent and bot.sent[0][0] == "-77" and "TRD-1" in bot.sent[0][1]
        assert link.last_sent_at is not None

        # not linked → nothing; plain message → nothing
        bot2 = FakeBot()
        with patch("db.session.SessionLocal", return_value=self._session(msg, None)):
            assert tg.deliver(mid, sender=bot2) is False
        plain = SimpleNamespace(id=mid, room_id=room, body="hi", card=None)
        with patch("db.session.SessionLocal", return_value=self._session(plain, link)):
            assert tg.deliver(mid, sender=bot2) is False
        assert bot2.sent == []

    def test_deliver_failure_is_swallowed_and_rolled_back(self):
        room, mid = uuid.uuid4(), uuid.uuid4()
        class Boom(FakeBot):
            def send_message(self, *a, **k): raise RuntimeError("telegram down")
        msg = SimpleNamespace(id=mid, room_id=room, body="", card={"type": "trade", "summary": {}})
        link = SimpleNamespace(chat_id="-1", last_sent_at=None)
        db = self._session(msg, link)
        with patch("db.session.SessionLocal", return_value=db):
            assert tg.deliver(mid, sender=Boom()) is False
        db.rollback.assert_called_once(); db.commit.assert_not_called()


# ── Webhook authentication ───────────────────────────────────────────────────

class TestWebhookAuth:

    @pytest.fixture
    def app_client(self, monkeypatch):
        from fastapi.testclient import TestClient
        from main import app
        from db.session import get_db
        monkeypatch.setenv("TELEGRAM_WEBHOOK_SECRET", "s3cr3t")
        monkeypatch.setenv("TELEGRAM_BOT_TOKEN", "t")
        fake = FakeBot(); tg.set_client(fake)
        app.dependency_overrides[get_db] = lambda: MagicMock()
        try:
            yield TestClient(app), fake
        finally:
            app.dependency_overrides.pop(get_db, None); tg.set_client(None)

    def test_wrong_path_or_missing_header_is_403(self, app_client):
        c, _ = app_client
        body = {"message": {"chat": {"id": -1, "type": "group"}, "text": "/help"}}
        assert c.post("/api/telegram/webhook/nope", json=body, headers={"X-Telegram-Bot-Api-Secret-Token": "s3cr3t"}).status_code == 403
        assert c.post("/api/telegram/webhook/s3cr3t", json=body).status_code == 403
        assert c.post("/api/telegram/webhook/s3cr3t", json=body, headers={"X-Telegram-Bot-Api-Secret-Token": "wrong"}).status_code == 403

    def test_help_replies_and_non_commands_are_ignored(self, app_client):
        c, fake = app_client
        h = {"X-Telegram-Bot-Api-Secret-Token": "s3cr3t"}
        r = c.post("/api/telegram/webhook/s3cr3t", json={"message": {"chat": {"id": -5, "type": "group"}, "text": "/help@RijekaConfirmBot"}}, headers=h)
        assert r.status_code == 200 and fake.sent and "mirror trade confirmations" in fake.sent[-1][1]
        n = len(fake.sent)
        r = c.post("/api/telegram/webhook/s3cr3t", json={"message": {"chat": {"id": -5, "type": "group"}, "text": "morning, 10 BTC at 75k?"}}, headers=h)
        assert r.status_code == 200 and len(fake.sent) == n     # conversation is never touched

    def test_link_outside_a_group_is_refused(self, app_client):
        c, fake = app_client
        r = c.post("/api/telegram/webhook/s3cr3t", headers={"X-Telegram-Bot-Api-Secret-Token": "s3cr3t"},
                   json={"message": {"chat": {"id": 42, "type": "private"}, "text": "/link ABCD2345"}})
        assert r.status_code == 200 and "inside the group" in fake.sent[-1][1]
