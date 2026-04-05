"""
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
        mat = date.fromisoformat(req.maturity_date)  # keep unadjusted
    elif req.tenor:
        delta = TENOR_MAP.get(req.tenor.upper().strip())
        if not delta:
            raise HTTPException(status_code=422, detail=f"Unknown tenor: {req.tenor}")
        mat = eff + delta  # unadjusted — BDC applied only to payment dates
    else:
        mat = eff + relativedelta(years=5)  # unadjusted

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
