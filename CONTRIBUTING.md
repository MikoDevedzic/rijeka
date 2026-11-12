# Contributing to Rijeka

Rijeka is built in public. The engine and the standard are Apache-2.0; the platform is Business Source License 1.1 (see the path table in [LICENSE](LICENSE)). There are four ways in, and each has
its own door so nobody has to guess.

| You want to… | Go to |
|---|---|
| **Validate a model** independently and be named on the report | [docs/VALIDATION.md](docs/VALIDATION.md) and the [validation issues](https://github.com/MikoDevedzic/rijeka/issues?q=label%3Avalidation) |
| **Report a pricing or risk bug** | [New pricing-bug issue](https://github.com/MikoDevedzic/rijeka/issues/new?template=pricing_bug.yml) |
| **Contribute code or docs** | this page, then a pull request |
| **Sponsor, pilot, or teach with it** | [docs/VALIDATION.md#work-with-us](docs/VALIDATION.md#work-with-us) or miko@rijeka.app |

## Ground rules for code

- **Sign your commits (DCO).** Add `Signed-off-by: Your Name <you@example.com>` to every commit
  (`git commit -s`). It certifies you have the right to contribute the change and that you license it
  inbound under Apache-2.0, whichever part of the tree it lands in. Platform contributions are then
  distributed under the BSL and relicensed to Apache-2.0 on the Change Date, like the rest of the
  platform. No assignment of copyright.
- **Pricing changes come with a test and a number.** A change to anything under `backend/pricing/`,
  `backend/risk/`, `backend/ccr/`, `backend/pnl/` or `backend/chain/` needs a test that pins the new behaviour and, in the pull request, the before
  and after value on the default trade of the affected product (the Methodology tab's Excel export
  is the quickest way to produce it).
- **No silent methodology changes.** If a formula changes, `docs/methodology/rijeka_methodology.tex`
  changes in the same pull request, and the known-limitations section is updated if a limitation is
  removed or added.
- **Risk vocabulary is ISDA SIMM's.** `IR01`, `IR01_DISC`, `FX01` / `CRY01`, `FUND01`, `VEGA`, `THETA`, `GAMMA`: the one table is [docs/glossary.md](docs/glossary.md). Not PV01, not DV01.
- **Nothing in the app may depend on Rijeka's servers to verify a confirmation.** The verifier stays
  self-contained.

## Running it

```bash
cd backend && pip install -r requirements.txt -r requirements-dev.txt     # QuantLib for tests/reference, ruff
python -m pytest -q                                                       # ~700 tests, no network; ruff check . first
cd frontend && npm install && npm run dev
```

The API-level integration tests need a local Postgres 16 and nothing else:

```bash
cd backend && ./stack/up.sh && eval "$(./stack/up.sh --env)"       # schema, seed, keys on postgresql:///rijeka_test
python -m pytest -q -m integration tests/integration                # 59 tests, every product booked and priced
```

They are skipped without `RIJEKA_STACK_DATABASE_URL`; CI runs them on a `postgres:16` service
(`backend/stack/README.md`).
Never point tests at a shared database: both suites write rows.

The browser journeys (`cd frontend && npm run e2e`, `frontend/e2e/README.md`) run the built app on the same stack and
need PostgREST; `npm run e2e:chain` adds a local test chain and needs Foundry's `anvil`
([getfoundry.sh](https://getfoundry.sh)), as the contract tests in `chain/` do.

## Review

One maintainer review for docs and UI; two for anything under `pricing/`, `chain/` or the registry
contract. Pricing pull requests are checked against the validation reports before merge.

## Conduct

Be precise and be kind. Disagree with numbers, not with people.
