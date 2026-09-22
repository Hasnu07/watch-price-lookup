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

### Optional auto B2C

Create `.env.local`:

```bash
REEF_API_KEY=your_reefapi_key
```

Or paste the key under **Settings** in the UI (stored in the browser only).

## Stack

Next.js · TypeScript · Tailwind · shadcn/ui
