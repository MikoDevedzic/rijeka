# Security

Rijeka is an open OTC derivatives desk (the engine and the standard are open source under Apache-2.0; the
platform's source is open under the Business Source License 1.1). The hosted demo at app.rijeka.app runs
on the Sepolia testnet with public market data; it holds no customer money and no
production trades. Self-hosted installs hold whatever their operators put in them, so
the code is treated as production code.

## Reporting a vulnerability

Email **miko@rijeka.app** (subject: SECURITY) with what you found, where (file, route, or page), and how
to reproduce it. Every report is read and answered. Please do not open a public issue for a security
problem until it is fixed, and do not test against accounts that are not yours.

In scope: the API (backend/), the app (frontend/), the registry contracts (chain/),
the deploy and cron workflows (.github/). Out of scope: Supabase, Render, Netlify and
GitHub themselves; social engineering; volumetric denial of service.

## What is in place

- Authentication: Supabase ES256 tokens verified by public key (PyJWT, algorithm
  pinned); no shared-secret path. After verification the caller's role is read from
  the database (profiles.role) and overrides whatever the token claims.
- Data isolation: every table carries Postgres row-level security; the API queries by
  the caller's user id and firm.
- Secrets: never in the repository (.env files ignored, GitHub secret scanning and push
  protection on); the cron talks to the API with a shared secret in a header.
- Public endpoints are read-only aggregates or bounded beacons with per-address rate
  limits and body size caps.
- Dependencies are pinned and audited (`pip-audit`, `npm audit`); Dependabot is
  configured in `.github/dependabot.yml`.
- Transport: HSTS (set by Netlify), frame denial and content-type sniffing protection
  on the app; the API is reached over HTTPS only. A content security policy is sent in
  report-only mode (`Content-Security-Policy-Report-Only` in `netlify.toml`, reports to
  `POST /api/ops/csp-report`, read back at `GET /api/ops/csp-reports`); it is switched to
  enforcing once the report list has stayed empty for a week. No script is loaded from a
  CDN at runtime: three.js and ExcelJS are bundled, and the one static page that still
  references a CDN (`xva.html`) pins it with subresource integrity.

## Credit

The reporter of a confirmed vulnerability is named in the changelog entry of the fix and in
[CONTRIBUTORS.md](CONTRIBUTORS.md), once the fix is live and not before. Say in your report how you want to be
named, or that you do not. No payment is offered for reports.

## Supported versions

The `main` branch is the supported version. Hosted demo deploys follow it after CI.
