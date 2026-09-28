# Troubleshooting

Eight failures that show up in real setups. There is no nonce to rotate. Webhooks are authenticated with `Stripe-Signature` and `STRIPE_WEBHOOK_SECRET` only.

The status contract: bad signature, missing or placeholder secret, or livemode mismatch → **HTTP 400** (event id not stored on livemode mismatch; Stripe stops). Database down or amount/currency mismatch → **HTTP 500** (event insert rolls back; Stripe retries). Refund or dispute for an unknown payment intent → **HTTP 200**, stored, ignored.

## 1. CLI `whsec_` is not the Dashboard secret

**What you see:** HTTP 400, `invalid_signature` or `missing_signature`.

**Why:** `stripe listen` prints a signing secret for events the CLI forwards. The Dashboard endpoint has a different `whsec_`. A value that still contains `replace_me` is rejected the same way.

**Do this:** Put the secret that belongs to the sender you are actually using into `STRIPE_WEBHOOK_SECRET`, then restart `npm run dev`. Do not mix the CLI secret and a Dashboard endpoint secret in one environment.

## 2. Success page loaded, balance did not move

**What you see:** The browser is on `/?checkout=success` and the balance is unchanged.

**Why:** The success URL is navigation. Credits are granted only when `checkout.session.completed` is processed with `payment_status=paid`, or on `checkout.session.async_payment_succeeded` for delayed methods. If nothing is forwarding events to `/api/webhooks/stripe`, the page still loads.

**Do this:** Run `stripe listen --forward-to localhost:3000/api/webhooks/stripe` (or your deployed endpoint) with the matching `whsec_`. Confirm the event, then the balance. `stripe events resend evt_...` of that same event must not grant again. `npm run demo` signs a local `checkout.session.completed`, grants `pack_100`, and replays that event id on the migrated database. It does not post to the dev server, call Stripe, or charge a card. `npm run demo:webhook` posts a local signed fixture to the dev server. It does not charge a card. The server and that script must share a non-placeholder `STRIPE_WEBHOOK_SECRET`.

## 3. Demo controls stay closed

**What you see:** Spend, race, reset, or Buy is missing, or checkout / check / track returns HTTP 404 `demo_controls_disabled`.

**Why:** `ALLOW_DEMO_CONTROLS` defaults to `false`. Only the exact string `true` opens the shell. `NODE_ENV=production` (`next start` as well as a real deploy) forces it closed anyway.

**Do this:** For a local walkthrough, set `ALLOW_DEMO_CONTROLS=true` in `.env.local` and restart. The first `npm run db:migrate` with the flag on, or the first request that opens the database with the flag on, grants 100 credits once (`seed:<DEMO_USER_ID>`). Later requests do not refill the balance. The reset control does. Leave the flag false in any deployed app. Spend, race, and reset stay closed in production. A matching `x-ledger-secret` does not open them. It only opens checkout, check, and track, still on `DEMO_USER_ID` (section 4).

## 4. `x-ledger-secret` still uses `DEMO_USER_ID`

**What you see:** Requests with the header succeed, and every caller shares one balance.

**Why:** A matching `x-ledger-secret` opens `POST /api/checkout`, `/api/credits/check`, and `/api/credits/track` when the demo flag is off. It does not choose a user. Those routes bill `DEMO_USER_ID`. A `userId` field in the JSON body is ignored.

**Do this:** Leave `LEDGER_API_SECRET` unset. Copy `src/billing` and pass the id from your session. This header is not multi-tenant auth.

## 5. SQLite locks under more than one process

**What you see:** `SQLITE_BUSY`, "database is locked", or a wait when two Node processes use one file.

**Why:** The SQLite adapter sets WAL and `busy_timeout = 5000` (wait up to five seconds). That is enough for `npm test` and a solo demo. It is not a multi-server database.

**Do this:** Keep SQLite for the offline suite and a single local process. For anything you ship, `docker compose up -d`, set `DATABASE_URL` to Postgres, and comment `SQLITE_PATH`. Do not point several servers at one SQLite file.

## 6. Holds never come back (reaper not running)

**What you see:** Balance dropped after `reserve`, the process died before `finalize` or `release`, and the credits stay gone.

**Why:** A hold stays `held` until `reapExpiredHolds` runs after the TTL (`CREDIT_HOLD_TTL_SECONDS`, default 900). Production must run `npm run holds:reap`. The demo server reaps once, on the first request that opens the database. `reserve` reaps again before each reservation. Those calls are not the production reaper. `track` does not reap. One pass expires at most 200 holds. If the process is down and the reaper is not running, the credits stay held.

**Do this:** In production, run `npm run holds:reap` (sleeps `CREDIT_HOLD_REAP_INTERVAL_SECONDS`, default 60) or cron `npm run holds:reap -- --once`. You own that process and you alert if it dies. Do not treat a later `reserve` from unrelated traffic as your reaper. An expired key stays consumed (`hold_expired`). Start a new idempotency key for a new call.

## 7. Refund or dispute removed a whole pack

**What you see:** A partial refund, or a dispute, took the full pack. Winning the dispute did not put credits back.

**Why:** `charge.refunded` and `charge.dispute.created` claw back the full pack for that payment intent, not a prorated amount. `charge.dispute.closed` is stored as `ignored_event` and does not restore credits. A refund that arrives before the grant is HTTP 200 `pending_clawback` and is applied when that grant arrives.

**Do this:** Read [REFUND_GLOSSARY.md](REFUND_GLOSSARY.md). This is your customer's Stripe charge, not a refund of the kit purchase. Customer-comms and whether the account should be unpaused are yours.

## 8. Account paused after a clawback

**What you see:** `reserve` or `track` returns `account_paused`. Buying another pack does not clear it.

**Why:** Clawback pauses the user only when the spendable balance could not cover the full pack after open holds were released. A `shortfall` journal row (delta 0) is written only when credits are actually missing. Grants do not call `unpauseUser`.

**Do this:** Call `unpauseUser` from your own admin auth after you decide the account is whole. The demo reset button does this for `DEMO_USER_ID` only. It is not a production admin panel.
