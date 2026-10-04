# Regression suite (added 4 Oct 2026)

159 automated checks covering login, registration, the dashboard, alternate
contacts, the admin console, payments settings, login emails, access control,
and what happens when the database is unreachable.

Nothing here touches a real database, Twilio, or an email provider. The app is
built normally and pointed at `fake-supabase.js`, an in-memory stand-in for the
Supabase REST API, so tests can create, damage and delete accounts freely and
can simulate an outage (`/__ctl?down=1`).

## Run it

```bash
# 1. test settings (back up your real .env.local first)
cp qa/regression/env.example .env.local

# 2. stand-in database, then the app
node qa/regression/fake-supabase.js &
npm run build && npx next start -p 3000 &

# 3. the suites
node qa/regression/suite-api.js          # 76 API / access-control checks
npm i --no-save playwright && npx playwright install chromium
node qa/regression/suite-ui.js           # 83 browser checks (headless Chromium)
```

Each suite prints PASS/FAIL per check and writes `results-api.json` /
`results-ui.json` next to itself. Restore your real `.env.local` afterwards.

## Files

- `fake-supabase.js` – the stand-in database (kv_store and the settings tables).
- `lib.js` – browser helpers: login, paid registration, admin sign-in.
- `suite-api.js` – OTP rules, storage access control, admin, payments, email, outage.
- `suite-ui.js` – end-to-end flows in a real browser.
- `env.example` – the test-only environment the suites expect.
