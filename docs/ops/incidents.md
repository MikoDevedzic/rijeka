# Incidents

The account of each outage of the hosted demo: when it began, what a visitor saw, what was and was not the cause
and how that was established, what was changed, and what is still open. Kept by the operations keeper
(`.claude/agents/grace.md`), written the same day.

## 15 November 2026: the database stopped answering (19:32 to 21:50 UTC)

**What a visitor saw.** Sign-in stopped at "AUTHENTICATING…". Every page that reads the database hung. The public
health route and the door's pulse still answered.

**Timeline (UTC).** 19:26 the API restarted for release 0.40.0, and its batches ran, as they do at every start. 19:32 the database's own metrics stop. 19:35 the
first error in the API's log (a connection closed), then statements cancelled on timeout from 19:42. 19:49 one API
instance failed its health check and was replaced. 21:06 release 0.41.0 was pushed onto the failing service, and the API restarted at 21:09.
21:45 the database was resized; 21:50 it answered. 23:12 the daily batch, missed at 21:16, ran.

**The cause.** The database was on the smallest machine (0.5 GB). The hosting plan had been raised that morning,
but a plan and a machine size are two settings and the size had not changed. The machine had been in swap all day,
its memory commitment marked severe on the host's own graphs, and at 19:32 it stopped answering.

**What was not the cause, and how that is known.** Not release 0.41.0: the errors began ninety minutes before it.
Not the API host: its CPU and memory were flat throughout. Not the load of the tenor-level risk run of 0.40.0, which
was suspected: counted afterwards, a live risk report sends a few hundred small statements. It stopped six
minutes after the restart for 0.40.0, when every batch runs; whether that restart was what tipped it over is not
established, and two earlier restarts the same day did not.

**What was changed.** The database is on a machine four times the size. A report reads once what none of its
valuations changes (0.42.1). The scheduler does not start a batch against a database that does not answer, says so,
and tries again a minute later (0.42.1). Production is looked at before a release is pushed
(`docs/ops/release.md`). A risk report costs a fifth of the CPU it did (0.42.3). The sizes are written in
`docs/ops/environment.md`.

**Still open.** The presence checks of ten modules read an error as a missing table. The API is one instance on
one CPU and has not been measured under several users at once. Nothing tells the owner the database is down before
a visitor does: the watch is run by hand.
