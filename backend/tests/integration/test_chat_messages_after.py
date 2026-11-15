"""A room's messages after a time: what a window asks for every few seconds while its live stream is not
delivering (GET /api/chat/rooms/{id}/messages?after=...). On the local stack, two seeded users of one firm."""
from datetime import datetime, timedelta, timezone

from tests.integration.conftest import USER_B


def _room(client, auth_a) -> str:
    r = client.post("/api/chat/rooms/direct", json={"user_id": USER_B}, headers=auth_a)
    assert r.status_code == 201, r.text
    return r.json()["id"]


def _send(client, auth, room: str, body: str) -> dict:
    r = client.post(f"/api/chat/rooms/{room}/messages", json={"body": body}, headers=auth)
    assert r.status_code == 201, r.text
    return r.json()["message"]


def test_after_returns_only_what_was_sent_later_and_nothing_twice(client, auth_a, auth_b):
    room = _room(client, auth_a)
    first = _send(client, auth_a, room, "one")
    second = _send(client, auth_b, room, "two")
    third = _send(client, auth_a, room, "three")

    whole = client.get(f"/api/chat/rooms/{room}/messages", headers=auth_b).json()
    assert [m["id"] for m in whole][-3:] == [first["id"], second["id"], third["id"]]                 # oldest first, as before

    later = client.get(f"/api/chat/rooms/{room}/messages", params={"after": first["created_at"]}, headers=auth_b)
    assert later.status_code == 200, later.text
    assert [m["id"] for m in later.json()] == [second["id"], third["id"]]                              # not the one named, nor anything before it

    none = client.get(f"/api/chat/rooms/{room}/messages", params={"after": third["created_at"]}, headers=auth_b).json()
    assert none == []


def test_after_reads_a_time_in_any_zone_and_one_without_a_zone_as_utc(client, auth_a, auth_b):
    room = _room(client, auth_a)
    sent = _send(client, auth_a, room, "zones")
    at = datetime.fromisoformat(sent["created_at"])
    before = at - timedelta(seconds=30)
    for stamp in (before.astimezone(timezone.utc).isoformat().replace("+00:00", "Z"),               # as a browser writes it
                  before.astimezone(timezone(timedelta(hours=-5))).isoformat(),                       # another zone, the same instant
                  before.astimezone(timezone.utc).replace(tzinfo=None).isoformat()):                  # no zone: read as UTC
        got = client.get(f"/api/chat/rooms/{room}/messages", params={"after": stamp}, headers=auth_b)
        assert got.status_code == 200, (stamp, got.text)
        assert sent["id"] in [m["id"] for m in got.json()], stamp
    assert client.get(f"/api/chat/rooms/{room}/messages", params={"after": "yesterday"}, headers=auth_b).status_code == 422


def test_after_does_not_open_a_room_to_someone_outside_it(client, auth_a, expired_auth):
    room = _room(client, auth_a)
    assert client.get(f"/api/chat/rooms/{room}/messages", params={"after": "2026-01-01T00:00:00Z"}, headers=expired_auth).status_code == 401
    assert client.get("/api/chat/rooms/00000000-0000-0000-0000-000000000000/messages",
                      params={"after": "2026-01-01T00:00:00Z"}, headers=auth_a).status_code == 404
