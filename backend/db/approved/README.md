# Approved migrations

The SQL the deployed API applies to its database at start-up (`../migrate.py`). It reads only this directory:
nothing outside `backend/` exists on the service. Each file is a byte-identical copy of `docs/migrations/<name>`
made when the owner approved it, with a line in `../migrations_approved.txt` carrying its sha256 and his words.

Never edit a file here: an approved migration is immutable, and a correction is a new file in `docs/migrations`.
To add one: `cd backend && python -m db.migrate --stage <name>.sql`, add the line it prints to the manifest with
the approval after the `#`, then `python -m db.migrate --check`.
