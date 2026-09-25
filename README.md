# Watch Price Check

Dealer desk app for luxury watch market research. Enter a **full reference** and **year** (month optional). The app applies your B2B / B2C checklist and builds the send-ready report.

## What it does

| Step | In the app |
| --- | --- |
| Reference + dial | Normalizes the full reference; dial hint from the suffix (e.g. `-010`) |
| Year rules | Relative to the current year. Current year → check it + the year before (month optional, used to flag same-month quotes). Previous two years → check those two only (no current-year comps). Older → that year + the one before |
| B2B | Price cards for **every** TimeDealer forsale quote (last 90 days): price, seller, phone / WhatsApp, group, dated, condition, dial, posted time, verified. Grouped by currency, cheapest first. **HKD stays HKD** |
| B2C | Chrono24 lowest world, highest world, lowest UAE per comparison year (auto with ReefAPI, links otherwise) |
| Report | Copy-paste block matching your team template, with the cheapest 3 dealer quotes per currency |

## What is automatic?

- **B2B (TimeDealer)** — automatic when `TIMEDEALER_PHONE` + `TIMEDEALER_PASSWORD` are set on the server. The app logs in once and reuses the session for 2 hours (re-login only if it expires), so it doesn't keep kicking your team's session.
- **B2C (Chrono24)** — partially. Chrono24 blocks direct scraping (Cloudflare). With a [ReefAPI](https://reefapi.com/docs/chrono24) key the app fills lowest / highest world and, when a UAE seller is among the verified listings, lowest UAE. Otherwise confirm UAE via the UAE Chrono24 link.
- Each check stops within ~50s. Anything a provider didn't return in time is marked, and the Chrono24 links are always there as a fallback.

## Deep links

`/?ref=7118/1200A-010&year=2026&month=3&tab=b2b&autorun=1` fills the form and runs the check. Add `&b2b=0` to skip TimeDealer for that run. `tab` is `b2b`, `b2c` (default) or `report`.

## Run locally

```bash
npm install
npm run dev
```

Open [http://127.0.0.1:43127](http://127.0.0.1:43127).

### Optional auto B2C (Chrono24)

```bash
REEF_API_KEY=your_reefapi_key
```

Or paste the key under **Settings** in the UI (browser only).

### Optional auto B2B (TimeDealer)

```bash
TIMEDEALER_PHONE=+92311…
TIMEDEALER_PASSWORD=your_password
```

Phone must be E.164 (e.g. `+923118598189`). Local `03…` Pakistan numbers are accepted and normalized. Quotes in HKD are kept in HKD.

## Deploy live

**Best fit:** [Vercel](https://vercel.com) (built for Next.js). **Also fine:** [Railway](https://railway.app) — yes, Railway works well for this app.

### Railway (recommended if you already use it)

1. Create a project at [railway.app](https://railway.app) → **Deploy from GitHub** (connect this repo).
2. Add variables (Variables tab):

```bash
REEF_API_KEY=…
TIMEDEALER_PHONE=+92311…
TIMEDEALER_PASSWORD=…
```

3. Deploy. Railway sets `PORT` automatically; `railway.json` is already in the repo.
4. Generate a public domain under **Settings → Networking**.

CLI alternative:

```bash
npm i -g @railway/cli
railway login
railway init
railway variables set REEF_API_KEY=… TIMEDEALER_PHONE=… TIMEDEALER_PASSWORD=…
railway up
```

### Vercel (simplest for Next.js)

```bash
npm i -g vercel
vercel login
vercel          # preview
vercel --prod   # live
```

Add the same env vars in the Vercel project settings.

## Stack

Next.js · TypeScript · Tailwind · shadcn/ui
