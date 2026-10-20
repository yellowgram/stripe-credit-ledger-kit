#!/usr/bin/env bash
# This repo ships as a GitHub template, not an npm package. Prove the template works the way a
# user gets it: copy only the committed files of HEAD (what "Use this template" copies) into an
# empty directory, install, typecheck, migrate and run the demo on SQLite, build the Next.js app,
# import a named export from the ledger library, and check that `npm pack` refuses.
set -euo pipefail
root=$(git rev-parse --show-toplevel)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
git -C "$root" archive --format=tar HEAD | tar -x -C "$work"
cd "$work"
echo "template copy: $(git -C "$root" ls-files | wc -l) committed files"
npm ci --silent --no-audit --no-fund
npx tsc --noEmit
echo "typecheck ok"
export SQLITE_PATH="$work/demo.sqlite"
env -u DATABASE_URL npm run --silent db:migrate >/dev/null
env -u DATABASE_URL npm run --silent demo | tail -1
npm run --silent build >/dev/null
[ -f .next/BUILD_ID ] || { echo "TEMPLATE SMOKE FAIL: next build produced no .next/BUILD_ID"; exit 1; }
echo "next build ok"
npx tsx -e 'const { handleStripeEvent, ...rest } = require("./src/billing/webhook"); if (typeof handleStripeEvent !== "function") { console.error("TEMPLATE SMOKE FAIL: handleStripeEvent is not exported"); process.exit(1); } console.log("import ok: src/billing/webhook (handleStripeEvent + " + Object.keys(rest).length + " more named exports)");'
if npm pack --dry-run >/dev/null 2>&1; then echo "TEMPLATE SMOKE FAIL: npm pack did not refuse"; exit 1; fi
echo "npm pack refuses (template, not an npm package)"
echo "template smoke OK"
