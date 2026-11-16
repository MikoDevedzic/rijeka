"""What each account does, by day: the record behind the operator's Adoption view.

    events.py     which signed-in requests count as which kind of activity (a fixed list; pure)
    store.py      the buffer, the flush into activity_daily, the reads
    adoption.py   the figures of the view, from accounts, activity and the trading tables (pure)

Recording begins with the table (docs/migrations/2026-11-16_activity.sql): without it nothing is kept.
"""
