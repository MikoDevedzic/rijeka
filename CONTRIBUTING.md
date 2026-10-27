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
- **Pricing changes come with a test and a number.** A change to anything under `backend/pricing/`
  or `backend/chain/` needs a test that pins the new behaviour and, in the pull request, the before
  and after value on the default trade of the affected product (the Methodology tab's Excel export
  is the quickest way to produce it).
- **No silent methodology changes.** If a formula changes, `docs/methodology/rijeka_methodology.tex`
  changes in the same pull request, and the known-limitations section is updated if a limitation is
  removed or added.
- **Risk vocabulary is ISDA SIMM's.** `IR01`, `IR01_DISC`, `THETA`, `GAMMA`, `VEGA`. Not PV01, not DV01.
- **Nothing in the app may depend on Rijeka's servers to verify a confirmation.** The verifier stays
  self-contained.

## Running it

```bash
cd backend && pip install -r requirements.txt && python -m pytest -q      # ~400 tests, no network
cd frontend && npm install && npm run dev
```

The backend tests that touch a database are skipped unless `.env.test` points at a Supabase project
of your own. Never point tests at a shared database: the suite writes rows.

## Review

One maintainer review for docs and UI; two for anything under `pricing/`, `chain/` or the registry
contract. Pricing pull requests are checked against the validation reports before merge.

## Conduct

Be precise and be kind. Disagree with numbers, not with people.
