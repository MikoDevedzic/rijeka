"""Independent price verification: the market data the book is priced on, verified where the risk sits.

    inputs.py       what the trades in scope are valued on, and each input's pillars
    tolerances.py   the firm's rules: tolerance and materiality per input and pillar
    ladder.py       the sensitivity per pillar (one quote bumped, the book repriced)
    run.py          the run: inputs, states, overrides, first and second order, the gate, the sign-off
    store.py        the tables

The flash is the traders' marks; an override is a market-data event with author and reason; the official P&L
is the flash plus the IPV adjustments plus the XVA reserve change, signed by the controller."""
