# Watch Price Check

Dealer desk app for luxury watch market research. Enter a **full reference** and **year** (plus month when the watch is 2026). The app applies your B2B / B2C checklist and builds the send-ready report.

## What it does

| Step | In the app |
| --- | --- |
| Reference + dial | Normalizes the full reference; dial hint from the suffix (e.g. `-010`) |
| Year rules | 2026 → check 2026 + 2025 (month matters). 2024/2025 → check 2024 + 2025 only (no 2026 comps) |
| B2B | Deep link to [timedealer.io](https://timedealer.io) + fields for price / currency / source. **HKD stays HKD** |
| B2C | Chrono24 links for lowest world, highest world, lowest UAE per comparison year |
| Report | Copy-paste block matching your team template |

## What can be fully automatic?

**Honest answer:**

- **B2C (Chrono24)** — partially. Chrono24 blocks direct scraping (Cloudflare). With an optional [ReefAPI](https://reefapi.com/docs/chrono24) key, the app can auto-fill **lowest / highest world**. **Lowest UAE** still needs a quick check via the UAE Chrono24 link (country filter is not in that API).
- **B2B (TimeDealer + dealer groups)** — **not automatic** without your team login. The app opens TimeDealer and you enter the quotes. That keeps dealer credentials and group chats off the server.

So day-to-day you still only type **reference + year** (and month for 2026), then fill B2B prices and confirm UAE — much faster than starting from a blank message.

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
