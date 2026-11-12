"""One version for the API: reported on /health and /api/ops/health, written to CHANGELOG.md, tagged
on the launch commit. The commit itself comes from Render (RENDER_GIT_COMMIT)."""
VERSION = "0.27.1"
# 0.16.3 reached main on 10 November 2026 (ac31220) and Render started no deploy for it. This line is the push
# that asks again: a deploy is asked for by a commit under backend/ (docs/ops/deploy.md, "When Render does not deploy").
