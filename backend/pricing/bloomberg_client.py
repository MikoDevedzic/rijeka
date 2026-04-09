# bloomberg_client.py
# blpapi wrapper — gracefully handles missing installation or disconnected terminal.
# All snap functions open a fresh session per call (fine for infrequent snapshot ops).

import logging
from datetime import date
from typing import Optional

logger = logging.getLogger(__name__)

try:
    import blpapi
    BLOOMBERG_AVAILABLE = True
except ImportError:
    BLOOMBERG_AVAILABLE = False

# ── Default ticker catalogue ──────────────────────────────────────────────────
# Format: { curve_id: { tenor: "TICKER Field" } }
# PX_LAST on BGN Curncy tickers gives the BGN composite mid rate in %.
# Verify tickers in your terminal before going live — run BDH on each.

CURVE_TICKERS: dict = {

    # ── OIS / RFR curves ──────────────────────────────────────────────────────

    "USD_SOFR": {
        "ON":  "SOFRRATE Index",
        "1W":  "USOSFR1Z BGN Curncy",
        "2W":  "USOSFR2Z BGN Curncy",
        "3W":  "USOSFR3Z BGN Curncy",
        "1M":  "USOSFRA BGN Curncy",
        "2M":  "USOSFRB BGN Curncy",
        "3M":  "USOSFRC BGN Curncy",
        "4M":  "USOSFRD BGN Curncy",
        "5M":  "USOSFRE BGN Curncy",
        "6M":  "USOSFRF BGN Curncy",
        "7M":  "USOSFRG BGN Curncy",
        "8M":  "USOSFRH BGN Curncy",
        "9M":  "USOSFRI BGN Curncy",
        "10M": "USOSFRJ BGN Curncy",
        "11M": "USOSFRK BGN Curncy",
        "1Y":  "USOSFR1 BGN Curncy",
        "18M": "USOSFR1F BGN Curncy",
        "2Y":  "USOSFR2 BGN Curncy",
        "3Y":  "USOSFR3 BGN Curncy",
        "4Y":  "USOSFR4 BGN Curncy",
        "5Y":  "USOSFR5 BGN Curncy",
        "6Y":  "USOSFR6 BGN Curncy",
        "7Y":  "USOSFR7 BGN Curncy",
        "8Y":  "USOSFR8 BGN Curncy",
        "9Y":  "USOSFR9 BGN Curncy",
        "10Y": "USOSFR10 BGN Curncy",
        "12Y": "USOSFR12 BGN Curncy",
        "15Y": "USOSFR15 BGN Curncy",
        "20Y": "USOSFR20 BGN Curncy",
        "25Y": "USOSFR25 BGN Curncy",
        "30Y": "USOSFR30 BGN Curncy",
        "40Y": "USOSFR40 BGN Curncy",
        "50Y": "USOSFR50 BGN Curncy",
    },

    "EUR_ESTR": {
        "ON":  "ESTRON Index",
        "1W":  "EUSWEC1Z BGN Curncy",
        "1M":  "EUSWEC1Z BGN Curncy",
        "3M":  "EUSWEC3 BGN Curncy",
        "6M":  "EUSWEC6 BGN Curncy",
        "9M":  "EUSWEC9 BGN Curncy",
        "1Y":  "EUSWEC1 BGN Curncy",
        "2Y":  "EUSWEC2 BGN Curncy",
        "3Y":  "EUSWEC3 BGN Curncy",
        "5Y":  "EUSWEC5 BGN Curncy",
        "7Y":  "EUSWEC7 BGN Curncy",
        "10Y": "EUSWEC10 BGN Curncy",
        "15Y": "EUSWEC15 BGN Curncy",
        "20Y": "EUSWEC20 BGN Curncy",
        "30Y": "EUSWEC30 BGN Curncy",
    },

    "GBP_SONIA": {
        "ON":  "SONIO/N Index",
        "1W":  "BPSWSC1Z BGN Curncy",
        "1M":  "BPSWSC1 BGN Curncy",
        "3M":  "BPSWSC3 BGN Curncy",
        "6M":  "BPSWSC6 BGN Curncy",
        "9M":  "BPSWSC9 BGN Curncy",
        "1Y":  "BPSWSC1 BGN Curncy",
        "2Y":  "BPSWSC2 BGN Curncy",
        "3Y":  "BPSWSC3 BGN Curncy",
        "5Y":  "BPSWSC5 BGN Curncy",
        "7Y":  "BPSWSC7 BGN Curncy",
        "10Y": "BPSWSC10 BGN Curncy",
        "15Y": "BPSWSC15 BGN Curncy",
        "20Y": "BPSWSC20 BGN Curncy",
        "25Y": "BPSWSC25 BGN Curncy",
        "30Y": "BPSWSC30 BGN Curncy",
        "40Y": "BPSWSC40 BGN Curncy",
        "50Y": "BPSWSC50 BGN Curncy",
    },

    "JPY_TONA": {
        "ON":  "TONAR Index",
        "1M":  "JYSOC1 BGN Curncy",
        "3M":  "JYSOC3 BGN Curncy",
        "6M":  "JYSOC6 BGN Curncy",
        "1Y":  "JYSOC1 BGN Curncy",
        "2Y":  "JYSOC2 BGN Curncy",
        "3Y":  "JYSOC3 BGN Curncy",
        "5Y":  "JYSOC5 BGN Curncy",
        "7Y":  "JYSOC7 BGN Curncy",
        "10Y": "JYSOC10 BGN Curncy",
        "20Y": "JYSOC20 BGN Curncy",
        "30Y": "JYSOC30 BGN Curncy",
    },

    "CHF_SARON": {
        "ON":  "SARON Index",
        "1M":  "SFSWAP1 BGN Curncy",
        "3M":  "SFSWAP3 BGN Curncy",
        "6M":  "SFSWAP6 BGN Curncy",
        "1Y":  "SFSWAP1 BGN Curncy",
        "2Y":  "SFSWAP2 BGN Curncy",
        "3Y":  "SFSWAP3 BGN Curncy",
        "5Y":  "SFSWAP5 BGN Curncy",
        "7Y":  "SFSWAP7 BGN Curncy",
        "10Y": "SFSWAP10 BGN Curncy",
        "20Y": "SFSWAP20 BGN Curncy",
        "30Y": "SFSWAP30 BGN Curncy",
    },

    "AUD_AONIA": {
        "ON":  "RBATCTR Index",
        "1M":  "ADSWAP1 BGN Curncy",
        "3M":  "ADSWAP3 BGN Curncy",
        "6M":  "ADSWAP6 BGN Curncy",
        "1Y":  "ADSWAP1 BGN Curncy",
        "2Y":  "ADSWAP2 BGN Curncy",
        "3Y":  "ADSWAP3 BGN Curncy",
        "5Y":  "ADSWAP5 BGN Curncy",
        "7Y":  "ADSWAP7 BGN Curncy",
        "10Y": "ADSWAP10 BGN Curncy",
        "15Y": "ADSWAP15 BGN Curncy",
        "20Y": "ADSWAP20 BGN Curncy",
        "30Y": "ADSWAP30 BGN Curncy",
    },

    "CAD_CORRA": {
        "ON":  "CAONREPO Index",
        "1M":  "CDSWAP1 BGN Curncy",
        "3M":  "CDSWAP3 BGN Curncy",
        "6M":  "CDSWAP6 BGN Curncy",
        "1Y":  "CDSWAP1 BGN Curncy",
        "2Y":  "CDSWAP2 BGN Curncy",
        "3Y":  "CDSWAP3 BGN Curncy",
        "5Y":  "CDSWAP5 BGN Curncy",
        "7Y":  "CDSWAP7 BGN Curncy",
        "10Y": "CDSWAP10 BGN Curncy",
        "20Y": "CDSWAP20 BGN Curncy",
        "30Y": "CDSWAP30 BGN Curncy",
    },

    "SEK_STIBOR": {
        "ON":  "SEKSTRON Index",
        "1M":  "SKSWAP1 BGN Curncy",
        "3M":  "SKSWAP3 BGN Curncy",
        "6M":  "SKSWAP6 BGN Curncy",
        "1Y":  "SKSWAP1 BGN Curncy",
        "2Y":  "SKSWAP2 BGN Curncy",
        "5Y":  "SKSWAP5 BGN Curncy",
        "10Y": "SKSWAP10 BGN Curncy",
        "20Y": "SKSWAP20 BGN Curncy",
        "30Y": "SKSWAP30 BGN Curncy",
    },

    "NOK_NOWA": {
        "ON":  "NONIBTOL Index",
        "1M":  "NKSWAP1 BGN Curncy",
        "3M":  "NKSWAP3 BGN Curncy",
        "6M":  "NKSWAP6 BGN Curncy",
        "1Y":  "NKSWAP1 BGN Curncy",
        "2Y":  "NKSWAP2 BGN Curncy",
        "5Y":  "NKSWAP5 BGN Curncy",
        "10Y": "NKSWAP10 BGN Curncy",
        "20Y": "NKSWAP20 BGN Curncy",
    },

    "DKK_DESTR": {
        "ON":  "DESTR Index",
        "1M":  "DKSWAP1 BGN Curncy",
        "3M":  "DKSWAP3 BGN Curncy",
        "6M":  "DKSWAP6 BGN Curncy",
        "1Y":  "DKSWAP1 BGN Curncy",
        "2Y":  "DKSWAP2 BGN Curncy",
        "5Y":  "DKSWAP5 BGN Curncy",
        "10Y": "DKSWAP10 BGN Curncy",
    },

    # ── IBOR curves ───────────────────────────────────────────────────────────

    "EUR_EURIBOR_6M": {
        "1M":  "EUR001M Index",
        "3M":  "EUR003M Index",
        "6M":  "EUR006M Index",
        "1Y":  "EUSWF1 BGN Curncy",
        "2Y":  "EUSWF2 BGN Curncy",
        "3Y":  "EUSWF3 BGN Curncy",
        "4Y":  "EUSWF4 BGN Curncy",
        "5Y":  "EUSWF5 BGN Curncy",
        "6Y":  "EUSWF6 BGN Curncy",
        "7Y":  "EUSWF7 BGN Curncy",
        "8Y":  "EUSWF8 BGN Curncy",
        "9Y":  "EUSWF9 BGN Curncy",
        "10Y": "EUSWF10 BGN Curncy",
        "12Y": "EUSWF12 BGN Curncy",
        "15Y": "EUSWF15 BGN Curncy",
        "20Y": "EUSWF20 BGN Curncy",
        "25Y": "EUSWF25 BGN Curncy",
        "30Y": "EUSWF30 BGN Curncy",
        "40Y": "EUSWF40 BGN Curncy",
        "50Y": "EUSWF50 BGN Curncy",
    },

    "EUR_EURIBOR_3M": {
        "1M":  "EUR001M Index",
        "3M":  "EUR003M Index",
        "6M":  "EUR006M Index",
        "1Y":  "EUSWE1 BGN Curncy",
        "2Y":  "EUSWE2 BGN Curncy",
        "3Y":  "EUSWE3 BGN Curncy",
        "5Y":  "EUSWE5 BGN Curncy",
        "10Y": "EUSWE10 BGN Curncy",
        "30Y": "EUSWE30 BGN Curncy",
    },

    "USD_LIBOR_3M": {
        "1M":  "US0001M Index",
        "3M":  "US0003M Index",
        "6M":  "US0006M Index",
        "1Y":  "USSW1 BGN Curncy",
        "2Y":  "USSW2 BGN Curncy",
        "3Y":  "USSW3 BGN Curncy",
        "4Y":  "USSW4 BGN Curncy",
        "5Y":  "USSW5 BGN Curncy",
        "6Y":  "USSW6 BGN Curncy",
        "7Y":  "USSW7 BGN Curncy",
        "8Y":  "USSW8 BGN Curncy",
        "9Y":  "USSW9 BGN Curncy",
        "10Y": "USSW10 BGN Curncy",
        "12Y": "USSW12 BGN Curncy",
        "15Y": "USSW15 BGN Curncy",
        "20Y": "USSW20 BGN Curncy",
        "25Y": "USSW25 BGN Curncy",
        "30Y": "USSW30 BGN Curncy",
    },

    "GBP_LIBOR_6M": {
        "1M":  "BP0001M Index",
        "3M":  "BP0003M Index",
        "6M":  "BP0006M Index",
        "1Y":  "BPSWF1 BGN Curncy",
        "2Y":  "BPSWF2 BGN Curncy",
        "3Y":  "BPSWF3 BGN Curncy",
        "5Y":  "BPSWF5 BGN Curncy",
        "7Y":  "BPSWF7 BGN Curncy",
        "10Y": "BPSWF10 BGN Curncy",
        "15Y": "BPSWF15 BGN Curncy",
        "20Y": "BPSWF20 BGN Curncy",
        "30Y": "BPSWF30 BGN Curncy",
        "50Y": "BPSWF50 BGN Curncy",
    },

    "JPY_TIBOR_3M": {
        "1M":  "JY0001M Index",
        "3M":  "JY0003M Index",
        "6M":  "JY0006M Index",
        "1Y":  "JYSW1 BGN Curncy",
        "2Y":  "JYSW2 BGN Curncy",
        "3Y":  "JYSW3 BGN Curncy",
        "5Y":  "JYSW5 BGN Curncy",
        "7Y":  "JYSW7 BGN Curncy",
        "10Y": "JYSW10 BGN Curncy",
        "20Y": "JYSW20 BGN Curncy",
        "30Y": "JYSW30 BGN Curncy",
    },

    "CHF_LIBOR_6M": {
        "1M":  "SF0001M Index",
        "3M":  "SF0003M Index",
        "6M":  "SF0006M Index",
        "1Y":  "SFSWIT1 BGN Curncy",
        "2Y":  "SFSWIT2 BGN Curncy",
        "3Y":  "SFSWIT3 BGN Curncy",
        "5Y":  "SFSWIT5 BGN Curncy",
        "10Y": "SFSWIT10 BGN Curncy",
        "20Y": "SFSWIT20 BGN Curncy",
        "30Y": "SFSWIT30 BGN Curncy",
    },

    # ── Basis curves ─────────────────────────────────────────────────────────

    "USD_SOFR_FF_BASIS": {
        "1M":  "USBG1M Curncy",
        "3M":  "USBG3M Curncy",
        "6M":  "USBG6M Curncy",
        "1Y":  "USBG1 Curncy",
        "2Y":  "USBG2 Curncy",
        "3Y":  "USBG3 Curncy",
        "5Y":  "USBG5 Curncy",
        "10Y": "USBG10 Curncy",
        "30Y": "USBG30 Curncy",
    },

    "USD_SOFR_1M_3M_BASIS": {
        "1Y":  "USSOB1Y BGN Curncy",
        "2Y":  "USSOB2Y BGN Curncy",
        "3Y":  "USSOB3Y BGN Curncy",
        "5Y":  "USSOB5Y BGN Curncy",
        "7Y":  "USSOB7Y BGN Curncy",
        "10Y": "USSOB10Y BGN Curncy",
        "30Y": "USSOB30Y BGN Curncy",
    },

    "EUR_ESTR_EURIBOR_BASIS": {
        "1Y":  "EUBS1Y BGN Curncy",
        "2Y":  "EUBS2Y BGN Curncy",
        "3Y":  "EUBS3Y BGN Curncy",
        "5Y":  "EUBS5Y BGN Curncy",
        "10Y": "EUBS10Y BGN Curncy",
        "20Y": "EUBS20Y BGN Curncy",
        "30Y": "EUBS30Y BGN Curncy",
    },

    "EUR_3M_6M_BASIS": {
        "1Y":  "EUBS36M1Y BGN Curncy",
        "2Y":  "EUBS36M2Y BGN Curncy",
        "5Y":  "EUBS36M5Y BGN Curncy",
        "10Y": "EUBS36M10Y BGN Curncy",
        "30Y": "EUBS36M30Y BGN Curncy",
    },

    "GBP_SONIA_LIBOR_BASIS": {
        "1Y":  "BPBS1Y BGN Curncy",
        "2Y":  "BPBS2Y BGN Curncy",
        "5Y":  "BPBS5Y BGN Curncy",
        "10Y": "BPBS10Y BGN Curncy",
        "30Y": "BPBS30Y BGN Curncy",
    },

    # ── XCCY basis ────────────────────────────────────────────────────────────

    "XCCY_EURUSD": {
        "1Y":  "EUUSDCS1Y BGN Curncy",
        "2Y":  "EUUSDCS2Y BGN Curncy",
        "3Y":  "EUUSDCS3Y BGN Curncy",
        "5Y":  "EUUSDCS5Y BGN Curncy",
        "7Y":  "EUUSDCS7Y BGN Curncy",
        "10Y": "EUUSDCS10Y BGN Curncy",
        "15Y": "EUUSDCS15Y BGN Curncy",
        "20Y": "EUUSDCS20Y BGN Curncy",
        "30Y": "EUUSDCS30Y BGN Curncy",
    },

    "XCCY_GBPUSD": {
        "1Y":  "BPUSDCS1Y BGN Curncy",
        "2Y":  "BPUSDCS2Y BGN Curncy",
        "3Y":  "BPUSDCS3Y BGN Curncy",
        "5Y":  "BPUSDCS5Y BGN Curncy",
        "7Y":  "BPUSDCS7Y BGN Curncy",
        "10Y": "BPUSDCS10Y BGN Curncy",
        "20Y": "BPUSDCS20Y BGN Curncy",
        "30Y": "BPUSDCS30Y BGN Curncy",
    },

    "XCCY_JPYUSD": {
        "1Y":  "JPUSDCS1Y BGN Curncy",
        "2Y":  "JPUSDCS2Y BGN Curncy",
        "3Y":  "JPUSDCS3Y BGN Curncy",
        "5Y":  "JPUSDCS5Y BGN Curncy",
        "7Y":  "JPUSDCS7Y BGN Curncy",
        "10Y": "JPUSDCS10Y BGN Curncy",
        "20Y": "JPUSDCS20Y BGN Curncy",
        "30Y": "JPUSDCS30Y BGN Curncy",
    },

    "XCCY_AUDUSD": {
        "1Y":  "ADUSDCS1Y BGN Curncy",
        "2Y":  "ADUSDCS2Y BGN Curncy",
        "3Y":  "ADUSDCS3Y BGN Curncy",
        "5Y":  "ADUSDCS5Y BGN Curncy",
        "10Y": "ADUSDCS10Y BGN Curncy",
    },

    "XCCY_CADUSD": {
        "1Y":  "CDUSDCS1Y BGN Curncy",
        "2Y":  "CDUSDCS2Y BGN Curncy",
        "3Y":  "CDUSDCS3Y BGN Curncy",
        "5Y":  "CDUSDCS5Y BGN Curncy",
        "10Y": "CDUSDCS10Y BGN Curncy",
    },

    # ── FX forward curves (implied from FX forwards) ─────────────────────────

    "FX_EURUSD": {
        "1M":  "EURUSD1M BGN Curncy",
        "3M":  "EURUSD3M BGN Curncy",
        "6M":  "EURUSD6M BGN Curncy",
        "1Y":  "EURUSD1Y BGN Curncy",
        "2Y":  "EURUSD2Y BGN Curncy",
        "5Y":  "EURUSD5Y BGN Curncy",
    },

    "FX_GBPUSD": {
        "1M":  "GBPUSD1M BGN Curncy",
        "3M":  "GBPUSD3M BGN Curncy",
        "6M":  "GBPUSD6M BGN Curncy",
        "1Y":  "GBPUSD1Y BGN Curncy",
        "2Y":  "GBPUSD2Y BGN Curncy",
    },

    "FX_USDJPY": {
        "1M":  "USDJPY1M BGN Curncy",
        "3M":  "USDJPY3M BGN Curncy",
        "6M":  "USDJPY6M BGN Curncy",
        "1Y":  "USDJPY1Y BGN Curncy",
    },

    # ── Credit / CDS indices ──────────────────────────────────────────────────

    "CDS_IG_CDX": {
        "1Y":  "CDX IG 1Y Index",
        "3Y":  "CDX IG 3Y Index",
        "5Y":  "CDX IG 5Y Index",
        "7Y":  "CDX IG 7Y Index",
        "10Y": "CDX IG 10Y Index",
    },

    "CDS_HY_CDX": {
        "3Y":  "CDX HY 3Y Index",
        "5Y":  "CDX HY 5Y Index",
        "7Y":  "CDX HY 7Y Index",
        "10Y": "CDX HY 10Y Index",
    },

    "CDS_ITRAXX_MAIN": {
        "1Y":  "ITRAXX MAIN 1Y Index",
        "3Y":  "ITRAXX MAIN 3Y Index",
        "5Y":  "ITRAXX MAIN 5Y Index",
        "7Y":  "ITRAXX MAIN 7Y Index",
        "10Y": "ITRAXX MAIN 10Y Index",
    },

    # ── Commodity curves ──────────────────────────────────────────────────────

    "WTI_CRUDE": {
        "1M":  "CLF5 Comdty",
        "3M":  "CLH5 Comdty",
        "6M":  "CLM5 Comdty",
        "12M": "CLZ5 Comdty",
        "24M": "CLZ6 Comdty",
    },

    "BRENT_CRUDE": {
        "1M":  "COf5 Comdty",
        "3M":  "COH5 Comdty",
        "6M":  "COM5 Comdty",
        "12M": "COZ5 Comdty",
    },

    "HENRY_HUB_GAS": {
        "1M":  "NGF5 Comdty",
        "3M":  "NGH5 Comdty",
        "6M":  "NGM5 Comdty",
        "12M": "NGZ5 Comdty",
    },

    "TTF_GAS": {
        "1M":  "TTFM5 Comdty",
        "3M":  "TTFH5 Comdty",
        "12M": "TTFZ5 Comdty",
    },

    "EUA_CARBON": {
        "DEC25": "MOAZ5 Comdty",
        "DEC26": "MOAZ6 Comdty",
        "DEC27": "MOAZ7 Comdty",
    },
}


def _make_session():
    """Create and start a Bloomberg API session. Returns session or raises."""
    if not BLOOMBERG_AVAILABLE:
        raise RuntimeError(
            "blpapi not installed. "
            "Run: pip install blpapi --break-system-packages"
        )
    opts = blpapi.SessionOptions()
    opts.setServerHost("localhost")
    opts.setServerPort(8194)
    session = blpapi.Session(opts)
    if not session.start():
        raise RuntimeError(
            "Bloomberg terminal not connected. "
            "Open terminal, log in, then retry."
        )
    return session


def check_connection() -> dict:
    """Non-destructive connection test. Safe to call frequently."""
    if not BLOOMBERG_AVAILABLE:
        return {
            "connected": False,
            "installed": False,
            "error": "blpapi not installed. Run: pip install blpapi --break-system-packages",
        }
    try:
        session = _make_session()
        session.stop()
        return {"connected": True, "installed": True, "error": None}
    except Exception as e:
        return {"connected": False, "installed": True, "error": str(e)}


def snap_live(tickers: list[str], field: str = "PX_MID") -> dict[str, float | None]:
    """
    Fetch current BGN PX_LAST for each ticker.
    Returns {ticker: rate} — rate in % (e.g. 5.310 = 5.310%).
    Returns None for tickers with no data or errors.
    """
    session = _make_session()
    try:
        if not session.openService("//blp/refdata"):
            raise RuntimeError("Failed to open //blp/refdata service")

        svc = session.getService("//blp/refdata")
        req = svc.createRequest("ReferenceDataRequest")
        for t in tickers:
            req.getElement("securities").appendValue(t)
        req.getElement("fields").appendValue(field)

        session.sendRequest(req)

        results: dict[str, float | None] = {}
        while True:
            ev = session.nextEvent(2000)
            for msg in ev:
                if msg.hasElement("securityData"):
                    arr = msg.getElement("securityData")
                    for i in range(arr.numValues()):
                        sec = arr.getValue(i)
                        ticker = sec.getElementAsString("security")
                        fd = sec.getElement("fieldData")
                        if fd.hasElement(field):
                            results[ticker] = fd.getElementAsFloat(field)
                        else:
                            results[ticker] = None
            if ev.eventType() == blpapi.Event.RESPONSE:
                break
        return results
    finally:
        session.stop()


def snap_historical(tickers: list[str], snap_date: date) -> dict[str, float | None]:
    """
    Fetch BGN PX_LAST for a specific past date.
    Returns {ticker: rate} — rate in % as above.
    Returns None for tickers with no data on that date (holiday, etc.).
    """
    session = _make_session()
    try:
        if not session.openService("//blp/refdata"):
            raise RuntimeError("Failed to open //blp/refdata service")

        svc = session.getService("//blp/refdata")
        req = svc.createRequest("HistoricalDataRequest")
        for t in tickers:
            req.getElement("securities").appendValue(t)
        req.getElement("fields").appendValue("PX_MID")

        date_str = snap_date.strftime("%Y%m%d")
        req.set("startDate", date_str)
        req.set("endDate", date_str)
        req.set("periodicitySelection", "DAILY")
        req.set("nonTradingDayFillOption", "PREVIOUS_VALUE")

        session.sendRequest(req)

        results: dict[str, float | None] = {}
        while True:
            ev = session.nextEvent(2000)
            for msg in ev:
                if msg.hasElement("securityData"):
                    sec = msg.getElement("securityData")
                    ticker = sec.getElementAsString("security")
                    fd_arr = sec.getElement("fieldData")
                    if fd_arr.numValues() > 0:
                        fd = fd_arr.getValue(0)
                        results[ticker] = (
                            fd.getElementAsFloat("PX_MID")
                            if fd.hasElement("PX_MID") else None
                        )
                    else:
                        results[ticker] = None
            if ev.eventType() == blpapi.Event.RESPONSE:
                break
        return results
    finally:
        session.stop()


def get_default_tickers(curve_id: str) -> dict[str, str]:
    """Return the default tenor→ticker mapping for a curve."""
    return CURVE_TICKERS.get(curve_id, {})
