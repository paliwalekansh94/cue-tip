# Cue Tip CMS 3.0 deployment and data integrity

## Deploy
1. Deploy latest main branch through Cloudflare Workers (`npm run build`, `npx wrangler deploy`).
2. In Cloudflare D1 `cue-tip-db` Console, run `migrations/0003_advance_reservations.sql` if its tables are missing. Then run `migrations/0004_cms_finance.sql`.
3. Verify `/tables` includes `reservations`, `reservation_slots`, `cms_transactions`, `cms_customers`, and `cms_import_batches`.
4. Log in to `/staff` and open Finance, Customers and Import.
5. Enter one test expense and one test revenue, verify summary, then void both with reasons. Do not use actual production transactions until verified.
6. Test reservation overlap protection separately. Reservations and the financial ledger are currently separate; completing a reservation does not create a charge.

## Data handling
- All amounts are stored as integer paise, and timestamps as Unix milliseconds.
- Financial entries are never deleted from the UI; voiding preserves the original record and records the staff user, timestamp and reason.
- Monthly reporting groups non-voided transactions by transaction date and category, not by import date.
- Historical CSV header: `external_key,entry_type,category,description,amount,payment_method,date`.
- `amount` is in rupees, `entry_type` is `revenue` or `expense`, `payment_method` is `cash`, `upi`, `card`, `bank`, or `other`. Use an ISO 8601 timestamp with timezone, e.g. `2026-11-11T12:00:00+05:30`.
- External keys must be unique across all imported rows. Failed batch imports should not be counted as successful.
- Never import café purchases as an expense twice if the same costs are already included elsewhere in the ledger.

## Current limitations
- The older floor/session billing UI still uses local browser storage and is not integrated with the D1 financial ledger.
- No automatic receipt generation, snack stock ledger, staff role separation, customer-to-session linkage, booking-to-session conversion, or verified public rankings.
- The manual revenue ledger must not be interpreted as proof of collected payments unless reconciled.
- The UI currently displays up to 1,000 transactions per month; reporting summaries aggregate all matching entries.
- CSV import supports up to 100 records per batch; export Excel files to CSV first.
- Database migrations must be applied manually. Code deployment alone does not create tables.
- Verify the Worker build and the production API before relying on financial totals.
