# Cue Tip — Snooker Café

Cloudflare-ready React + TypeScript frontend prototype for Cue Tip.

## Prototype features
- Staff dashboard for two snooker tables, one pool table and one PS5 station
- Local start, pause, resume and stop timers
- Demo per-minute billing: ₹6 snooker, ₹5 pool, ₹5 PS5; each started minute is charged in full
- Customer-facing station listing
- Mobile-responsive interface and PWA manifest

**Important:** This is an in-memory demo. Timers and bills reset on refresh and do not sync across devices. Do not use for real billing. There is no authentication or live database yet.

## Run locally
```sh
npm install
npm run dev
```

## Deploy on Cloudflare Pages
In Cloudflare dashboard go to Workers & Pages > Create > Pages > Connect to Git. Select this repository, use Vite preset, build command `npm run build`, output directory `dist`. The Pages Function `/api/health` returns a simple health check. No database is required for the demo.

## Next milestones
1. Staff/customer authentication and role-based access
2. D1-backed server-side timers and billing
3. Customer records, payments, printable receipts
4. Bookings, menu, memberships, wallets, reports

Never commit credentials to GitHub.
