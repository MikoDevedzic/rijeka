"""What went wrong for the people using the desk, kept and told to the operator.

    store.py    the problems: a browser's report, a 5xx, a slow answer; the buffer, the table, the reads
    alerts.py   what the operator is told and when: a message when a new problem appears, a summary once a day

Problems are kept with the table (docs/migrations/2026-11-16_health.sql). Without it the browser's reports stay
where they were before, in the API's memory (api/routes/ops.py), and nothing is sent.
"""
