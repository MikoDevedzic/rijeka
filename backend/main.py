"""Rijeka: the FastAPI application. Routers, CORS, the unhandled-error envelope, the in-process scheduler."""
import logging
import os
import time

# The desk's clock. Setting TZ alone changes nothing on Linux: glibc reads TZ once, and `import time` (which
# `import logging` above already did, as has any server or test runner that imports this) is that read. The
# process kept the host's zone, UTC on Render, until something called tzset() for it (the first strptime does),
# and date.today() changed under a running process between 19:00 and midnight New York. tzset() here makes it
# New York from this line on.
os.environ["TZ"] = "America/New_York"
if hasattr(time, "tzset"):                      # not on Windows, where TZ is read by the C runtime at start
    time.tzset()

# Under uvicorn the root logger has no handler at INFO, so every log.info in the batches and the
# auth layer was dropped on Render. One configuration, env-driven; uvicorn keeps its own loggers.
logging.basicConfig(level=os.getenv("RIJEKA_LOG_LEVEL", "INFO").upper(),
                    format="%(asctime)s %(levelname)s %(name)s: %(message)s")

from fastapi import FastAPI

from version import VERSION
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from api.routes import (
    schedules,
    collateral,
    curves,
    org,
    legal_entities,
    counterparties,
    trades,
    booking,
    analyse,
    trade_events,
    trade_legs,
    cashflows,
    pricer,
    market_data,
    bloomberg,
    xva,
    capital,
    modules,
    ipv,
    chain,
    chat,
    trade_cards,
    telegram,
    demo,
    news,
    methodology,
    public,
    crypto,
    currencies,
    demo_market_data,
    book_brief,
    desk,
    pnl,
    me,
    risk,
    ccr,
    ops,
    usage,
    csp,
)

app = FastAPI(
    title="Rijeka API",
    description="Open-source full revaluation derivatives risk platform.",
    version=VERSION,
)

class _UnhandledToJson:
    """An exception no route handles becomes a JSON 500 here, inside the CORS layer, so the browser
    sees an error with a message instead of a blocked response it reports as a lost connection.
    Added before CORSMiddleware so that CORS wraps it (Starlette's last add_middleware is outermost)."""
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        try:
            await self.app(scope, receive, send)
        except Exception:
            logging.getLogger("rijeka").exception("unhandled error on %s %s", scope.get("method"), scope.get("path"))
            response = JSONResponse({"detail": "Rijeka hit an internal error on this request; it is in the server log."}, status_code=500)
            await response(scope, receive, send)


app.add_middleware(_UnhandledToJson)
app.add_middleware(
    CORSMiddleware,
    allow_origins=sorted({
        "http://localhost:5173",
        "http://localhost:5174",
        "http://localhost:5175",
        "https://app.rijeka.app",
        "https://rijeka.app",
        "https://rijeka-landing.netlify.app",
        *(o.strip() for o in (os.getenv("FRONTEND_URL", "") + "," + os.getenv("CORS_ORIGINS", "")).split(",") if o.strip()),
    }),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(curves.router)
app.include_router(org.router)
app.include_router(legal_entities.router, prefix="/api/legal-entities", tags=["legal-entities"])
app.include_router(counterparties.router, prefix="/api/counterparties", tags=["counterparties"])
app.include_router(trades.router, prefix="/api/trades", tags=["trades"])
app.include_router(booking.router)
app.include_router(analyse.router, prefix="/api/analyse", tags=["analyse"])
app.include_router(trade_events.router)
app.include_router(trade_legs.router)
app.include_router(cashflows.router)
app.include_router(pricer.router)
app.include_router(market_data.router)
app.include_router(xva.router)
app.include_router(capital.router)
app.include_router(collateral.router)
app.include_router(modules.router)
app.include_router(ipv.router)
app.include_router(bloomberg.router, prefix="/api")
app.include_router(schedules.router)
app.include_router(chain.router)
app.include_router(chat.router)
app.include_router(trade_cards.router)
app.include_router(telegram.router)
app.include_router(demo.router)
app.include_router(news.router)
app.include_router(methodology.router)
app.include_router(public.router)
app.include_router(demo_market_data.router)
app.include_router(book_brief.router)
app.include_router(desk.router)
app.include_router(pnl.router)
app.include_router(me.router)
app.include_router(risk.router)
app.include_router(ccr.router)
app.include_router(ops.router)
app.include_router(usage.router)
app.include_router(csp.router)

@app.on_event("startup")
def _apply_approved_migrations():
    # First of the start-up functions, before anything asks whether a table is there: the migrations the owner
    # approved in db/migrations_approved.txt are applied by this process (db/migrate.py), on Render or where
    # RIJEKA_MIGRATE is on, never from a developer's shell. Nothing here can stop the start: a migration that
    # does not apply stays pending: GET /api/ops/health counts it under `migrations`, GET /api/ops/migrations (admin) says why.
    try:
        from db import migrate
        if migrate.enabled():
            from db.session import engine
            migrate.run(engine)
    except Exception as e:           # noqa: BLE001 — the class only: a driver's message can name the host
        logging.getLogger("rijeka.migrate").error("migrations: the start-up hook failed (%s)", type(e).__name__)


@app.on_event("startup")
def _warm_public_pulse():
    try:
        public.warm()
    except Exception:
        pass


@app.on_event("startup")
def _start_scheduler():
    # Batches and the release move run inside this process on Render (see scheduler.py); the
    # GitHub workflows remain a second driver and the external stale-batch alarm.
    import scheduler
    scheduler.start()
app.include_router(crypto.router)
app.include_router(currencies.router)

# Telegram outbox: deliver mirrored cards only after their transaction commits.
from chain.telegram import register_listeners as _tg_listeners
_tg_listeners()


@app.get("/health", tags=["meta"])
def health():
    # Note: this path is shadowed by the curves router's /health (registered first); the commit the
    # release-sync workflow reads is served by GET /api/ops/health. Kept here for completeness.
    import os as _os
    return {"status": "ok", "service": "rijeka-api", "version": VERSION, "commit": _os.environ.get("RENDER_GIT_COMMIT") or _os.environ.get("GIT_COMMIT") or None}






