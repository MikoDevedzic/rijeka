# SPRINT 5 HANDOFF
# For new chat session — read ARCHITECTURE_v26.md first
# April 2026

## WHAT WAS BUILT THIS SESSION

1. Curve Scenario Tab — complete redesign
   - Two-column layout: controls/rate table left, chart right
   - Interactive drag-to-reshape curve with Gaussian ripple
   - Editable par rates (8dp), per-tenor SHOCKED/ZERO/DF
   - Stats cards: 30Y DF, 5Y Zero Rate, 10Y 5Y×5Y Fwd
   - CONFIRM SHAPE → reprices, shows impact analytics

2. Design system applied sitewide
   - Theme: Pure Black (#000000 bg)
   - Fonts: IBM Plex Mono (numbers) + IBM Plex Sans (labels)
   - 16px base, 3-tier font size scale
   - Canvas chart standard locked (see ARCHITECTURE_v26.md §3)

3. Trade window improvements
   - 88vw × 96vh default size
   - Duplicate floating leg row removed
   - Rate display: 8 decimal places
   - Analytics scrollIntoView after pricing
   - Semantic button colors: amber=book, teal=confirm

## TOP PRIORITY NEXT SESSION

  1. trade_legs write on booking (CRITICAL — cashflows broken for new trades)
  2. Sprint 5B: Zero Coupon + Step Up instruments
  3. Sprint 5C: BASIS swaps

## TEST TRADE

  5Y IR_SWAP $10M USD SOFR at ~3.665%
  At par: NPV ≈ $0, IR01 ≈ +$4,651
  Bloomberg ref: NPV=$0.02, PV01=$4,552

## BACKEND HEALTH

  Swagger: http://localhost:8000/docs
  Frontend: http://localhost:5173
  Kill python3.13.exe + node.exe before restart

## KEY FILES

  TradeBookingWindow.jsx  — trade form, ScenarioTab, analytics
  TradeBookingWindow.css  — tabs, buttons, layout
  index.css               — CSS variables, IBM Plex import, 16px base
  AppBar.jsx              — nav bar
  BlotterShell.css        — blotter table
