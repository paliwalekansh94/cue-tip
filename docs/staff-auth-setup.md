# Cue Tip public/staff split — deployment checklist

## Current security posture
- Public `/`: read-only rates and placeholder rankings. No private billing or player data returned.
- Staff `/staff`: individual username and 6–10 digit PIN, verified by Worker against D1, HttpOnly Secure SameSite=Strict session cookie with 8-hour expiry.
- Existing React staff dashboard is a **browser-local prototype** after login, not D1-backed production billing. Do not use it to collect real money or rely on it across devices.
- Financial APIs are intentionally disabled in `worker/entry.ts`. The older `worker/index.ts` is not the deployed entrypoint. Never switch to it without an authenticated, audited integration.
- No default staff accounts, PINs, or credentials are committed.

## Required operator actions
1. In Cloudflare D1 `cue-tip-db`, run `migrations/0002_staff_auth.sql` after the initial migration. The database must already contain the `stations` table.
2. In Cloudflare Worker settings add encrypted secrets `STAFF_PIN_PEPPER` (long random secret) and `STAFF_BOOTSTRAP_SECRET` (different long random one-time secret). Never place these values in GitHub, client code or screenshots.
3. Deploy the latest GitHub commit. Open `/staff`, choose **Set up the first staff account**, enter a unique username, 6–10 digit PIN, and the bootstrap secret. Once created, sign in normally.
4. **Delete `STAFF_BOOTSTRAP_SECRET` from Worker secrets** after creating the first staff account. The bootstrap endpoint also rejects any second staff account.
5. Confirm `/api/staff/me` returns HTTP 401 without a staff session; confirm financial API endpoints are unavailable; confirm public pages show no bills, payers, or private data.

## Important remaining work
- Build authenticated admin-only staff provisioning and revocation (the first staff account is the only one provisionable in this phase).
- Integrate station bookings, frame results, payer allocations, bills, and snack orders with server-validated D1 operations and auditing.
- Link frame results to station kind before publishing actual category-specific rankings.
- Add production testing, backup/recovery, session invalidation, and rate limiting beyond per-username PIN lockout. Per-username lockout is not a substitute for network-level WAF rate limits.

No migrations or secrets are automatically applied by GitHub commits.
