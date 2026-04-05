// deploy_schedules.js
// Run: node C:\Users\mikod\OneDrive\Desktop\Rijeka\deploy_schedules.js

const fs   = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const BASE = 'C:\\Users\\mikod\\OneDrive\\Desktop\\Rijeka\\backend';

// ── 1. Install holidays package ───────────────────────────────────────────────
console.log('Installing holidays package...');
try {
  execSync('pip install holidays --break-system-packages', { stdio: 'inherit' });
  console.log('✓ holidays installed');
} catch(e) {
  console.error('✗ pip install failed — install manually: pip install holidays');
}

// ── 2. Write calendars.py ─────────────────────────────────────────────────────
const CALENDARS = String.raw`"""
Rijeka — Business Day Calendars
Uses the holidays package for accurate holiday data per currency.
Falls back to weekend-only if holidays package unavailable.
"""

from datetime import date, timedelta
from typing import Set

try:
    import holidays as _holidays
    _HAS_HOLIDAYS = True
except ImportError:
    _HAS_HOLIDAYS = False

_CACHE: dict = {}

def _load(calendar: str, year: int) -> Set[date]:
    key = (calendar.upper(), year)
    if key in _CACHE:
        return _CACHE[key]
    hols: Set[date] = set()
    if not _HAS_HOLIDAYS:
        _CACHE[key] = hols
        return hols
    try:
        cal = calendar.upper().replace(' ','_')
        if cal == 'NEW_YORK':
            hols = set(_holidays.US(years=year).keys())
        elif cal == 'LONDON':
            hols = set(_holidays.UK(years=year).keys())
        elif cal == 'TARGET':
            # ECB TARGET: New Year, Good Friday, Easter Monday, May 1, Dec 25-26
            de = _holidays.Germany(years=year)
            for d, n in de.items():
                if 'Good Friday' in n or 'Easter Monday' in n:
                    hols.add(d)
            hols |= {date(year,1,1), date(year,5,1), date(year,12,25), date(year,12,26)}
        elif cal == 'TOKYO':
            hols = set(_holidays.Japan(years=year).keys())
        elif cal == 'ZURICH':
            hols = set(_holidays.Switzerland(years=year).keys())
        elif cal == 'SYDNEY':
            hols = set(_holidays.Australia(years=year).keys())
        elif cal == 'TORONTO':
            hols = set(_holidays.Canada(years=year).keys())
        elif '+' in cal:
            for part in cal.split('+'):
                hols |= _load(part.strip(), year)
    except Exception:
        pass
    _CACHE[key] = hols
    return hols

def is_business_day(d: date, calendar: str = 'NEW_YORK') -> bool:
    if d.weekday() >= 5:
        return False
    return d not in _load(calendar, d.year)

def next_business_day(d: date, calendar: str = 'NEW_YORK') -> date:
    while not is_business_day(d, calendar):
        d += timedelta(days=1)
    return d

def prev_business_day(d: date, calendar: str = 'NEW_YORK') -> date:
    while not is_business_day(d, calendar):
        d -= timedelta(days=1)
    return d

def add_business_days(d: date, n: int, calendar: str = 'NEW_YORK') -> date:
    step = 1 if n >= 0 else -1
    remaining = abs(n)
    while remaining > 0:
        d += timedelta(days=step)
        if is_business_day(d, calendar):
            remaining -= 1
    return d

def apply_bdc(d: date, bdc: str, calendar: str = 'NEW_YORK') -> date:
    bdc = (bdc or 'MOD_FOLLOWING').upper().replace(' ','_')
    if bdc == 'UNADJUSTED':
        return d
    if bdc == 'FOLLOWING':
        return next_business_day(d, calendar)
    if bdc == 'MOD_FOLLOWING':
        adj = next_business_day(d, calendar)
        return prev_business_day(d, calendar) if adj.month != d.month else adj
    if bdc == 'PRECEDING':
        return prev_business_day(d, calendar)
    if bdc == 'MOD_PRECEDING':
        adj = prev_business_day(d, calendar)
        return next_business_day(d, calendar) if adj.month != d.month else adj
    return next_business_day(d, calendar)

CCY_CALENDAR = {
    'USD': 'NEW_YORK', 'EUR': 'TARGET', 'GBP': 'LONDON',
    'JPY': 'TOKYO',   'CHF': 'ZURICH', 'AUD': 'SYDNEY', 'CAD': 'TORONTO',
}

def ccy_to_calendar(ccy: str) -> str:
    return CCY_CALENDAR.get((ccy or 'USD').upper(), 'NEW_YORK')
`;

fs.writeFileSync(path.join(BASE, 'pricing', 'calendars.py'), CALENDARS, 'utf8');
console.log('✓ pricing/calendars.py written');

// ── 3. Write schedules route ──────────────────────────────────────────────────
const SCHEDULES_ROUTE = String.raw`"""
Rijeka — Schedule Preview Route
POST /api/schedules/preview  — returns effective date, maturity date, full cashflow schedule
POST /api/schedules/advance-date — advance a date by N business days
"""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional, List
from datetime import date
from dateutil.relativedelta import relativedelta
from decimal import Decimal

from middleware.auth import verify_token
from pricing.calendars import add_business_days, apply_bdc, next_business_day, ccy_to_calendar
from pricing.schedule import generate_schedule

router = APIRouter(prefix="/api/schedules", tags=["schedules"])

TENOR_MAP = {
    '1D': relativedelta(days=1), '1W': relativedelta(weeks=1),
    '2W': relativedelta(weeks=2), '1M': relativedelta(months=1),
    '2M': relativedelta(months=2), '3M': relativedelta(months=3),
    '6M': relativedelta(months=6), '9M': relativedelta(months=9),
    '1Y': relativedelta(years=1), '18M': relativedelta(months=18),
    '2Y': relativedelta(years=2), '3Y': relativedelta(years=3),
    '4Y': relativedelta(years=4), '5Y': relativedelta(years=5),
    '6Y': relativedelta(years=6), '7Y': relativedelta(years=7),
    '8Y': relativedelta(years=8), '9Y': relativedelta(years=9),
    '10Y': relativedelta(years=10), '12Y': relativedelta(years=12),
    '15Y': relativedelta(years=15), '20Y': relativedelta(years=20),
    '25Y': relativedelta(years=25), '30Y': relativedelta(years=30),
    '40Y': relativedelta(years=40), '50Y': relativedelta(years=50),
}

SETTLEMENT_DAYS = {
    'USD': 2, 'EUR': 2, 'GBP': 0, 'JPY': 2,
    'CHF': 2, 'AUD': 0, 'CAD': 1,
}

class LegPreviewRequest(BaseModel):
    leg_type:          str = 'FIXED'
    payment_frequency: str = 'SEMI_ANNUAL'
    day_count:         str = 'ACT/360'
    bdc:               str = 'MOD_FOLLOWING'
    calendar:          Optional[str] = None
    notional:          float = 10_000_000
    payment_lag:       int = 0
    stub_type:         str = 'SHORT_FRONT'

class SchedulePreviewRequest(BaseModel):
    trade_date:      str
    tenor:           Optional[str] = None
    effective_date:  Optional[str] = None
    maturity_date:   Optional[str] = None
    currency:        str = 'USD'
    settlement_days: Optional[int] = None
    legs:            List[LegPreviewRequest] = []

class CashflowPreview(BaseModel):
    period_start: str
    period_end:   str
    payment_date: str
    fixing_date:  Optional[str]
    dcf:          float
    notional:     float

class LegPreview(BaseModel):
    leg_type:     str
    period_count: int
    cashflows:    List[CashflowPreview]

class SchedulePreviewResponse(BaseModel):
    trade_date:      str
    effective_date:  str
    maturity_date:   str
    tenor:           Optional[str]
    calendar:        str
    settlement_days: int
    legs:            List[LegPreview]

@router.post('/preview', response_model=SchedulePreviewResponse)
async def preview_schedule(req: SchedulePreviewRequest, user: dict = Depends(verify_token)):
    ccy      = (req.currency or 'USD').upper()
    calendar = ccy_to_calendar(ccy)
    settle   = req.settlement_days if req.settlement_days is not None else SETTLEMENT_DAYS.get(ccy, 2)
    trade_date = date.fromisoformat(req.trade_date)

    # Effective date
    if req.effective_date:
        eff = next_business_day(date.fromisoformat(req.effective_date), calendar)
    else:
        eff = add_business_days(trade_date, settle, calendar)

    # Maturity date
    if req.maturity_date:
        mat = apply_bdc(date.fromisoformat(req.maturity_date), 'MOD_FOLLOWING', calendar)
    elif req.tenor:
        delta = TENOR_MAP.get(req.tenor.upper().strip())
        if not delta:
            raise HTTPException(status_code=422, detail=f"Unknown tenor: {req.tenor}")
        mat = apply_bdc(eff + delta, 'MOD_FOLLOWING', calendar)
    else:
        mat = apply_bdc(eff + relativedelta(years=5), 'MOD_FOLLOWING', calendar)

    # Generate leg schedules
    leg_previews = []
    for leg_req in req.legs:
        periods = generate_schedule(
            effective_date=eff, maturity_date=mat,
            frequency=leg_req.payment_frequency,
            day_count=leg_req.day_count,
            notional=Decimal(str(leg_req.notional)),
            bdc=leg_req.bdc,
            payment_lag=leg_req.payment_lag,
            stub_type=leg_req.stub_type,
            is_float=(leg_req.leg_type.upper() == 'FLOAT'),
        )
        leg_previews.append(LegPreview(
            leg_type=leg_req.leg_type,
            period_count=len(periods),
            cashflows=[CashflowPreview(
                period_start=str(p.period_start),
                period_end=str(p.period_end),
                payment_date=str(p.payment_date),
                fixing_date=str(p.fixing_date) if p.fixing_date else None,
                dcf=float(p.dcf),
                notional=float(p.notional),
            ) for p in periods],
        ))

    return SchedulePreviewResponse(
        trade_date=str(trade_date),
        effective_date=str(eff),
        maturity_date=str(mat),
        tenor=req.tenor,
        calendar=calendar,
        settlement_days=settle,
        legs=leg_previews,
    )

class AdvanceDateRequest(BaseModel):
    date:     str
    calendar: str = 'NEW_YORK'
    days:     int = 2

@router.post('/advance-date')
async def advance_date(req: AdvanceDateRequest, user: dict = Depends(verify_token)):
    d   = date.fromisoformat(req.date)
    out = add_business_days(d, req.days, req.calendar)
    return {'input': str(d), 'output': str(out), 'calendar': req.calendar, 'days': req.days}
`;

fs.writeFileSync(path.join(BASE, 'api', 'routes', 'schedules.py'), SCHEDULES_ROUTE, 'utf8');
console.log('✓ api/routes/schedules.py written');

// ── 4. Update schedule.py to use calendars.apply_bdc ─────────────────────────
let sched = fs.readFileSync(path.join(BASE, 'pricing', 'schedule.py'), 'utf8');

// Add import at top if not already there
if (!sched.includes('from pricing.calendars import')) {
  sched = sched.replace(
    'from pricing.day_count import dcf as calc_dcf',
    'from pricing.day_count import dcf as calc_dcf\nfrom pricing.calendars import apply_bdc as _cal_apply_bdc, add_business_days as _cal_add_bd'
  );

  // Replace the old apply_bdc function with one that delegates to calendars.py
  // Keep the old one as fallback but override the main one
  sched = sched.replace(
    'def apply_bdc(d: date, bdc: str) -> date:\n    """Apply business day convention to a raw schedule date."""',
    'def apply_bdc(d: date, bdc: str, calendar: str = "NEW_YORK") -> date:\n    """Apply business day convention with holiday-aware calendar."""\n    return _cal_apply_bdc(d, bdc, calendar)\n\ndef _apply_bdc_legacy(d: date, bdc: str) -> date:\n    """Legacy weekend-only fallback."""'
  );

  fs.writeFileSync(path.join(BASE, 'pricing', 'schedule.py'), sched, 'utf8');
  console.log('✓ pricing/schedule.py updated to use calendar-aware apply_bdc');
} else {
  console.log('  pricing/schedule.py already updated');
}

// ── 5. Register schedules router in main.py ───────────────────────────────────
let main = fs.readFileSync(path.join(BASE, 'main.py'), 'utf8');

if (!main.includes('schedules')) {
  main = main.replace(
    'from api.routes import (',
    'from api.routes import (\n    schedules,'
  );
  main = main.replace(
    'app.include_router(bloomberg.router, prefix="/api")',
    'app.include_router(bloomberg.router, prefix="/api")\napp.include_router(schedules.router)'
  );
  fs.writeFileSync(path.join(BASE, 'main.py'), main, 'utf8');
  console.log('✓ main.py updated with schedules router');
} else {
  console.log('  main.py already has schedules router');
}

console.log('');
console.log('Done. Now:');
console.log('1. Kill python3.13.exe');
console.log('2. Restart backend: cd backend && python -m uvicorn main:app --reload --port 8000');
console.log('3. Test: http://localhost:8000/docs → POST /api/schedules/preview');
console.log('');
console.log('Then we wire the frontend:');
console.log('- Add TENOR dropdown to booking window');
console.log('- On change: call /api/schedules/preview → auto-populate eff/mat dates');
console.log('- CONFIRM tab shows full cashflow schedule before booking');
