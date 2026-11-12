"""The settlement price sources a digital-asset trade may name, and the checks on a name.

Two kinds. A feed source ("Deribit BTC delivery price") is stored by the feed as a shared row every account
settles on; nobody enters it by hand and nobody may store their own number under a name that reads like it. A
desk source ("CME CF BRR", or any plain name a desk uses) is the account's own entry.

A name is compared by its skeleton: NFKC, case folded, everything that is not a letter or a digit removed, and the
characters that pass for one another folded together (I, l and 1; O and 0). A name whose skeleton carries the
venue's name anywhere, or equals a feed source's, is reserved: "Deribit BTC delivery price.", "deribit btc
delivery-price", "Deribit BTC deIivery price" and "Der1bit ..." are all the feed's.

check_booked() is the booking rule, used by both booking routes: a digital-asset trade names either its pair's
feed source exactly or a desk source, and where the source is one the pair lists, the valuation time on the record
is that source's time. Trades already booked are not re-read against it."""
from __future__ import annotations

import re
import unicodedata
from datetime import date
from typing import Optional

from market_data import deribit

FEED_TIME = deribit.DELIVERY_TIME
# per pair: the licensed benchmark a desk enters itself, and the venue's delivery price the feed stores (`auto`).
# The order carries no meaning: which one a new ticket starts on is api/routes/currencies.settlement_default.
SETTLEMENT_SOURCES = {
    "BTCUSD": [{"source": "CME CF BRR", "time": "16:00 London", "auto": False},
               {"source": "Deribit BTC delivery price", "time": "08:00 UTC", "auto": True}],
    "ETHUSD": [{"source": "CME CF ETHUSD_RR", "time": "16:00 London", "auto": False},
               {"source": "Deribit ETH delivery price", "time": "08:00 UTC", "auto": True}],
    "SOLUSD": [{"source": "Coinbase SOL-USD", "time": "16:00 London", "auto": False},
               {"source": "Deribit SOL delivery price", "time": "08:00 UTC", "auto": True}],
}
INSTRUMENTS = ("CRYPTO_FORWARD", "CRYPTO_OPTION")
SETTLEMENT_FIELDS = ("digital_asset", "settlement_price_source", "valuation_time", "valuation_date", "settlement_date")     # what the rule reads
SOURCE_MAX = 80
TYPO_DISTANCE = 2                        # a name this close to the feed's or the venue's is taken for it
TYPO_TOKEN_MIN = 5                       # only a word this long is compared with the venue's name, so short real names pass
# What an option ticket older than 0.14.0 writes beside the benchmark. Countersigning depends on it too: booking the
# counterparty's side of a confirmed record (api/routes/trade_cards.book_mirror) goes through the booking model, so
# an option confirmed before 0.14.0 could not be mirrored if this pairing were refused.
LEGACY_OPTION_TIME = "08:00 UTC"
SOURCE = re.compile(r"[A-Za-z0-9](?:[A-Za-z0-9 ._/:()&+-]{0,78}[A-Za-z0-9.)])?")      # plain ASCII, no markup
_FOLD = str.maketrans({"i": "l", "1": "l", "o": "0"})                                   # after case folding: I l 1, O 0


def skeleton(source) -> str:
    s = unicodedata.normalize("NFKC", str(source or "")).casefold()
    return "".join(ch for ch in s if ch.isalnum()).translate(_FOLD)


VENUE = skeleton(deribit.PROVIDER)
FEED_SKELETONS = frozenset(skeleton(s["source"]) for srcs in SETTLEMENT_SOURCES.values() for s in srcs if s["auto"])


def feed_source(pair: str) -> Optional[str]:
    """The pair's feed source, or None for a pair the feed does not fix."""
    return next((s["source"] for s in SETTLEMENT_SOURCES.get(pair, []) if s["auto"]), None)


def _within(a: str, b: str, limit: int) -> bool:
    """Whether two short texts are within `limit` edits of each other (insertions, deletions, substitutions)."""
    if abs(len(a) - len(b)) > limit:
        return False
    row = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        nxt = [i]
        for j, cb in enumerate(b, 1):
            nxt.append(min(row[j] + 1, nxt[j - 1] + 1, row[j - 1] + (ca != cb)))
        if min(nxt) > limit:
            return False
        row = nxt
    return row[-1] <= limit


def _words(source) -> list[str]:
    """The words of a name, each as its skeleton."""
    s = unicodedata.normalize("NFKC", str(source or "")).casefold()
    return [w.translate(_FOLD) for w in re.split(r"[^0-9a-z]+", "".join(ch if ch.isalnum() else " " for ch in s)) if w]


def feed_owns(source) -> bool:
    """A feed source, or a name that reads like one: never a desk's to store or book under. The venue's name
    anywhere in it; a feed source's own name, or one within TYPO_DISTANCE edits of it; or a word of at least
    TYPO_TOKEN_MIN characters within TYPO_DISTANCE edits of the venue's name ("Derbit", "Deribt", "Dcribit",
    "Deribil"). A venue with a different name passes ("Derive" is three edits away, "Bybit" four)."""
    k = skeleton(source)
    if not k:
        return False
    if VENUE in k or k in FEED_SKELETONS or any(_within(k, f, TYPO_DISTANCE) for f in FEED_SKELETONS):
        return True
    return any(len(w) >= TYPO_TOKEN_MIN and _within(w, VENUE, TYPO_DISTANCE) for w in _words(source))


def printable(text_) -> bool:
    """No control, format (zero-width, direction marks), private-use or unassigned character, no line separator."""
    return all(unicodedata.category(ch) not in ("Cc", "Cf", "Co", "Cn", "Cs", "Zl", "Zp") for ch in str(text_))


def check_desk_source(source) -> str:
    """The name of a desk's own source, trimmed, or ValueError saying why it is refused."""
    if not isinstance(source, str):
        raise ValueError("the settlement price source is a short text")
    if not printable(source):              # before trimming: a line separator at the end is whitespace to strip()
        raise ValueError("the settlement price source carries a non-printing character")
    s = source.strip(" ")
    if not s:
        raise ValueError("the settlement price source is empty")
    if len(s) > SOURCE_MAX:
        raise ValueError(f"the settlement price source is at most {SOURCE_MAX} characters")
    if feed_owns(s):
        raise ValueError("this settlement price source is the feed's, or reads like it; choose the listed source or a name of your own")
    if not SOURCE.fullmatch(s):
        raise ValueError("the settlement price source: letters, digits, spaces and . _ / : ( ) & + - only")
    return s


def _day(v) -> Optional[date]:
    """A date, or a text that starts with a plain ISO date (2027-01-29, with or without a time after it)."""
    if isinstance(v, date):
        return v
    if not isinstance(v, str) or not re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}", v[:10]):
        return None
    try:
        return date.fromisoformat(v[:10])
    except ValueError:
        return None


def check_booked(instrument_type, terms, trade_date=None, maturity_date=None) -> None:
    """The booking rule for a digital-asset forward or option (ValueError with a plain message otherwise).

    The source the terms name is the pair's feed source exactly, or a desk source that passes check_desk_source.
    Where it is one of the pair's listed sources, terms.valuation_time must be that source's time: a fixing is
    published at one time, and a record that says another could not be settled on it. A trade that names no
    source is left to the confirmation, which requires one.

    A forward's fixing date (terms.valuation_date) lies after the trade date and on or before the settlement date;
    a record without one fixes on its settlement date, as every forward did before the ticket could say otherwise.
    (Until 0.26.0 it could be at most seven days before the settlement date, because the forward was carried to the
    settlement date; it is priced to its fixing date now.)"""
    itype = str(instrument_type or "").upper()
    if itype not in INSTRUMENTS or not isinstance(terms, dict):
        return
    if itype == "CRYPTO_FORWARD":
        settle, traded = _day(terms.get("settlement_date") or maturity_date), _day(trade_date)
        named = terms.get("valuation_date") not in (None, "")
        fixing = _day(terms.get("valuation_date")) if named else settle       # a record without one fixes on its settlement date
        if named and fixing is None:
            raise ValueError("valuation_date (the fixing date) is not a date")
    if itype == "CRYPTO_FORWARD" and fixing is not None:
        if settle is not None and fixing > settle:
            raise ValueError(f"valuation_date (the fixing date, {fixing}) cannot be after the settlement date ({settle})")
        if traded is not None and fixing <= traded:
            # a fixing dated the trade date may be published already (the venue's is, from 08:10 UTC): a price known
            # when the trade is struck is not a fixing of it
            raise ValueError(f"the fixing date must be after the trade date (valuation_date {fixing}, trade date {traded})")
    source = terms.get("settlement_price_source")
    if source is None or source == "":
        return
    pair = f"{str(terms.get('digital_asset') or '').upper()}USD"
    listed = {s["source"]: s for s in SETTLEMENT_SOURCES.get(pair, [])}
    if not (isinstance(source, str) and source == feed_source(pair)):
        check_desk_source(source)
        if source != source.strip(" "):
            raise ValueError("the settlement price source has spaces around it")
    hit = listed.get(source)
    if hit is None:
        return
    allowed = {hit["time"]}
    if not hit["auto"] and itype == "CRYPTO_OPTION":
        # Accepted for compatibility: the option ticket of every client before 0.14.0 books the benchmark with a
        # hard-coded 08:00 UTC (and tests/integration/bodies.py carries that body). It is wrong in principle, the
        # benchmark is published at 16:00 London, and it is to be removed once no client older than 0.14.0 is in use.
        allowed.add(LEGACY_OPTION_TIME)
    if terms.get("valuation_time") not in allowed:
        raise ValueError(f"valuation_time must be {hit['time']}, the time {source} is published; the terms say {str(terms.get('valuation_time'))[:40]!r}")
