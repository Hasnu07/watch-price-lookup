# Watch Price Check

Dealer desk app for luxury watch buying and selling. Enter a **full reference** and a **year range** (month optional). The app pulls dealer (TimeDealer) and retail (Chrono24) prices, tells you what the watch is worth buying or selling at after your costs and profit, and builds the send-ready report.

## What it does

| Step | In the app |
| --- | --- |
| Reference + dial | Normalizes the full reference; dial hint from the suffix (e.g. `-010`) |
| Year range | "Year from" → "Year to" (up to 6 years); every year is priced separately, newest first. Month (optional) applies to the newest year and flags same-month dealer quotes |
| Buy | Seller's asking price (+ your client's price if pre-sold) → the most you can pay for a quick dealer flip, a UAE retail sale or your client, and a verdict |
| Sell | Client's offer (+ your cost) → quick dealer price, UAE retail price, your floor, profit, and a verdict |
| B2B | Up to 10 TimeDealer price cards per year (last 90 days): the 9 cheapest plus the highest. Seller, phone / WhatsApp, group, dated, condition, dial, posted time, verified. Reposts are merged, price typos dropped, HKD mislabelled as USD fixed. **HKD stays HKD** |
| B2C | Chrono24 lowest world, highest world, lowest UAE per comparison year (auto with ReefAPI, links otherwise). Lowest / highest come from Chrono24's year search (same list as the year-filtered link); lowest UAE by opening the cheapest listings |
| Report | Copy-paste block matching your team template: lowest, #2, #3 and highest dealer quote per year, market levels, and any buy / sell check |

## Buy / Sell maths

Costs/commission % and target profit % are both **% of the sale price** and are remembered in the browser (defaults 2% and 5%).

- **Pay at most** = resale price × (1 − costs% − profit%). Resale price is the lowest dealer price (quick flip), the lowest UAE Chrono24 listing (retail), or your client's price.
- **Floor** (sell) = your cost ÷ (1 − costs% − profit%).
- **Profit** = sale price × (1 − costs%) − what you paid.
- Market levels (dealer low / median / high, retail low / median / lowest UAE) combine every year in the range. Amounts can be entered in USD, HKD or AED — both pegged to the dollar (7.80 and 3.6725) — and dealer quotes are compared using TimeDealer's own USD rate. Quote cards and report lines still show HKD as HKD.

## What is automatic?

- **B2B (TimeDealer)** — automatic when `TIMEDEALER_PHONE` + `TIMEDEALER_PASSWORD` are set on the server. The app logs in once and reuses the session for 2 hours (re-login only if it expires), so it doesn't keep kicking your team's session.
- **B2C (Chrono24)** — with a [ReefAPI](https://reefapi.com/docs/chrono24) key. Searching `"<ref> <year>"` makes Chrono24 apply its year filter, so lowest / highest world come straight from the search (ReefAPI's own `year` param is ignored). Search cards carry no country, so lowest UAE opens the 8 cheapest listings — slower, and loads separately. Chrono24 sometimes blocks ReefAPI ("did not serve the page (403)"); searches are retried and anything missing is named in the note.
- Dealer quotes and Chrono24 load separately: dealer cards show in ~5s while Chrono24 keeps loading. Chrono24 prices and the UAE lookup are separate requests too, and repeat checks of the same watch are cached for 20 minutes. Each check stops within ~50s at worst; the Chrono24 links are always there as a fallback.

## Deep links

`/?ref=7118/1200A-010&from=2024&to=2026&month=3&tab=sell&autorun=1` fills the form and runs the check. Add `&b2b=0` to skip TimeDealer for that run. `tab` is `buy` (default), `sell`, `b2b`, `b2c` or `report`. Old links with `&year=2026` still work (→ 2025–2026).

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
