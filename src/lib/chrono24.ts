import { fetchWithTimeout, isAbortError, timeLeft } from "@/lib/http";
import type { MarketListing } from "@/lib/watch-research";

const OUT_OF_TIME =
  "Stopped at the time limit — some Chrono24 prices may be missing. Use the Open Chrono24 year links.";
/** Listings opened per wave from each end (cheapest / priciest). */
const DETAIL_WAVE = 4;
/** Waves per end before settling (so at most 16 detail calls per year). */
const MAX_WAVES = 2;
const DETAIL_TTL_MS = 6 * 60 * 60 * 1000;
const YEAR_TTL_MS = 20 * 60 * 1000;
const MAX_CACHED_DETAILS = 2_000;
/** Listings per search recorded in debug output. */
const DEBUG_TOP = 20;

type ReefSearchResponse = {
  ok?: boolean;
  data?: {
    listings?: Array<{
      listing_id?: string;
      title?: string;
      price?: number | null;
      currency?: string | null;
      url?: string;
      image?: string;
      availability?: string;
    }>;
    aggregate?: {
      currency?: string;
    };
  } & Record<string, unknown>;
  error?: { message?: string } | string | null;
};

type ReefDetailResponse = {
  ok?: boolean;
  data?: {
    watch?: {
      listing_id?: string;
      title?: string;
      price?: number | null;
      currency?: string | null;
      url?: string;
      image?: string;
      year?: string | null;
      reference_number?: string | null;
      seller_location?: {
        addressCountry?: string;
        addressLocality?: string;
      } | null;
    };
  };
  error?: { message?: string } | string | null;
};

export type Chrono24FetchResult = {
  listings: MarketListing[];
  currency: string;
  source: "reefapi" | "manual";
  error?: string;
  /** Search response minus the listings (debug only). */
  meta?: string;
};

type DetailResult = { listing: MarketListing | null; failure?: string };

type YearMarket = {
  lowestWorld: MarketListing | null;
  highestWorld: MarketListing | null;
  lowestUae: MarketListing | null;
  verifiedCount: number;
  note?: string;
};

export type VerifiedChrono24Market = {
  byYear: Record<number, YearMarket>;
  error?: string;
};

/** What ReefAPI returned for each year, for `debug: true` research runs. */
export type Chrono24Debug = Record<
  number,
  {
    searches: Record<
      string,
      {
        error?: string;
        count: number;
        meta?: string;
        top: { id: string; price: number; title: string }[];
      }
    >;
    details: {
      id: string;
      from: string;
      price?: number;
      year?: string;
      location?: string;
      failure?: string;
    }[];
  }
>;

/** Never dump HTML / Cloudflare pages into the UI. */
export function sanitizeApiError(status: number, body: string): string {
  const compact = body.replace(/\s+/g, " ").trim();
  const looksHtml = /<!DOCTYPE|<html|cf-error|Cloudflare/i.test(body);
  if (status === 524 || /524/.test(body)) {
    return "Chrono24 provider timed out (HTTP 524). Try again in a moment, or use the Open Chrono24 year links below.";
  }
  if (status === 502 || status === 503 || status === 504) {
    return `Chrono24 provider temporarily unavailable (HTTP ${status}). Retry shortly or use the Chrono24 links.`;
  }
  if (looksHtml) {
    return `Chrono24 provider error (HTTP ${status}). Retry or use the Open Chrono24 year links.`;
  }
  const snippet = compact.slice(0, 140);
  return snippet
    ? `Chrono24 provider HTTP ${status}: ${snippet}`
    : `Chrono24 provider HTTP ${status}`;
}

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

async function reefSearch(opts: {
  apiKey: string;
  query: string;
  sort: "price_asc" | "price_desc" | "relevance";
  deadline: number;
  /** ReefAPI's year-of-production filter. */
  year?: number;
  attempts?: number;
}): Promise<Chrono24FetchResult> {
  const attempts = opts.attempts ?? 3;
  let lastError = "Chrono24 search failed";

  for (let attempt = 1; attempt <= attempts; attempt++) {
    const budget = Math.min(25_000, timeLeft(opts.deadline) - 500);
    if (budget < 3_000) {
      lastError = OUT_OF_TIME;
      break;
    }
    try {
      const res = await fetchWithTimeout(
        "https://api.reefapi.com/chrono24/v1/search",
        {
          method: "POST",
          headers: {
            "x-api-key": opts.apiKey,
            authorization: `Bearer ${opts.apiKey}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            query: opts.query,
            sort: opts.sort,
            page: 1,
            ...(opts.year ? { year: opts.year } : {}),
          }),
        },
        budget,
      );

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        lastError = sanitizeApiError(res.status, text);
        // Retry gateway timeouts / transient errors
        if ([502, 503, 504, 524, 429].includes(res.status) && attempt < attempts) {
          await sleep(800 * attempt);
          continue;
        }
        return {
          listings: [],
          currency: "USD",
          source: "reefapi",
          error: lastError,
        };
      }

      const json = (await res.json()) as ReefSearchResponse;
      if (json.ok === false) {
        const msg =
          typeof json.error === "string"
            ? json.error
            : json.error?.message || "ReefAPI returned ok=false";
        return { listings: [], currency: "USD", source: "reefapi", error: msg };
      }

      const currency = json.data?.aggregate?.currency || "USD";
      const listings: MarketListing[] = (json.data?.listings ?? [])
        .filter((l) => typeof l.price === "number" && l.price > 0)
        .map((l) => ({
          id: String(l.listing_id ?? l.url ?? Math.random()),
          title: l.title ?? opts.query,
          price: Number(l.price),
          currency: l.currency || currency,
          url:
            l.url ??
            `https://www.chrono24.com/search/index.htm?query=${encodeURIComponent(opts.query)}`,
          image: l.image,
        }));

      const { listings: _listings, ...meta } = json.data ?? {};
      void _listings;
      return {
        listings,
        currency,
        source: "reefapi",
        meta: JSON.stringify(meta).slice(0, 600),
      };
    } catch (e) {
      lastError =
        isAbortError(e)
          ? "Chrono24 search timed out. Retry or use the Open Chrono24 links."
          : e instanceof Error
            ? e.message
            : "Chrono24 search network error";
      if (attempt < attempts) await sleep(800 * attempt);
    }
  }

  return {
    listings: [],
    currency: "USD",
    source: "reefapi",
    error: lastError,
  };
}

async function reefDetail(
  apiKey: string,
  listingId: string,
  deadline: number,
): Promise<DetailResult> {
  const budget = Math.min(12_000, timeLeft(deadline) - 300);
  if (budget < 1_500) return { listing: null, failure: "out of time" };
  try {
    const res = await fetchWithTimeout(
      "https://api.reefapi.com/chrono24/v1/detail",
      {
        method: "POST",
        headers: {
          "x-api-key": apiKey,
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ listing_id: listingId }),
      },
      budget,
    );
    if (!res.ok) return { listing: null, failure: `HTTP ${res.status}` };
    const json = (await res.json()) as ReefDetailResponse;
    const watch = json.data?.watch;
    if (!watch || typeof watch.price !== "number" || watch.price <= 0) {
      return { listing: null, failure: "no price in detail" };
    }
    return {
      listing: {
        id: String(watch.listing_id ?? listingId),
        title: watch.title ?? listingId,
        price: Number(watch.price),
        currency: watch.currency || "USD",
        url:
          watch.url ??
          `https://www.chrono24.com/search/index.htm?query=${encodeURIComponent(listingId)}`,
        image: watch.image,
        year: watch.year ?? undefined,
        location: watch.seller_location?.addressCountry || undefined,
      },
    };
  } catch (e) {
    return { listing: null, failure: isAbortError(e) ? "timed out" : "network error" };
  }
}

/** Parse Chrono24 year text like "2024" or "2025 (Approximation)". */
export function parseChrono24Year(raw: string | null | undefined): {
  year: number | null;
  approximate: boolean;
} {
  if (!raw) return { year: null, approximate: false };
  const m = String(raw).match(/(19|20)\d{2}/);
  if (!m) return { year: null, approximate: false };
  return {
    year: Number(m[0]),
    approximate: /approx/i.test(raw),
  };
}

function matchesExactYear(
  listing: MarketListing,
  year: number,
  allowApproximate: boolean,
): boolean {
  const parsed = parseChrono24Year(listing.year);
  if (parsed.year !== year) return false;
  if (parsed.approximate && !allowApproximate) return false;
  return true;
}

function isUae(listing: MarketListing): boolean {
  const loc = (listing.location || "").toUpperCase();
  return loc === "AE" || loc === "UAE" || loc.includes("UNITED ARAB");
}

/**
 * Listing details barely change, so they're shared across requests (and
 * across both comparison years, whose searches overlap). In-flight lookups
 * are shared too; failed ones are dropped so they can be retried.
 */
const detailCache = new Map<string, { at: number; result: Promise<DetailResult> }>();

function cachedDetail(
  apiKey: string,
  listingId: string,
  deadline: number,
): Promise<DetailResult> {
  const hit = detailCache.get(listingId);
  if (hit && Date.now() - hit.at < DETAIL_TTL_MS) return hit.result;
  const result = reefDetail(apiKey, listingId, deadline);
  detailCache.set(listingId, { at: Date.now(), result });
  void result.then((d) => {
    if (!d.listing) detailCache.delete(listingId);
  });
  // Maps iterate in insertion order: drop the oldest entries first.
  for (const key of detailCache.keys()) {
    if (detailCache.size <= MAX_CACHED_DETAILS) break;
    detailCache.delete(key);
  }
  return result;
}

/** Finished year results, so re-running the same watch is instant. */
const yearCache = new Map<string, { at: number; market: YearMarket }>();

function debugSearch(result: Chrono24FetchResult) {
  return {
    error: result.error,
    count: result.listings.length,
    meta: result.meta,
    top: result.listings
      .slice(0, DEBUG_TOP)
      .map((l) => ({ id: l.id, price: l.price, title: l.title.slice(0, 80) })),
  };
}

/**
 * ReefAPI's `year` filter is ignored, but appending the year to the query
 * (Chrono24 search bar style: "5726A-001 2026") returns year-relevant hits.
 * We still verify Year of production via detail before quoting.
 *
 * Speed: both searches run together, then listings are opened in parallel
 * waves from the cheap and pricey ends at once, stopping as soon as each end
 * has a year-verified match. Lowest UAE comes from listings already opened.
 *
 * With `debug`, the cache is bypassed, the `year` filter is probed with an
 * extra search, and everything ReefAPI returned is recorded into it.
 */
export async function fetchChrono24VerifiedByYears(opts: {
  apiKey: string;
  query: string;
  years: number[];
  /** Epoch ms by which we must return, with whatever was verified so far. */
  deadline: number;
  debug?: Chrono24Debug;
}): Promise<VerifiedChrono24Market> {
  const { apiKey, deadline, debug } = opts;
  const years = [...new Set(opts.years)].sort();

  async function verifyYear(y: number): Promise<YearMarket> {
    const cacheKey = `${opts.query.toUpperCase()}|${y}`;
    const cached = yearCache.get(cacheKey);
    if (!debug && cached && Date.now() - cached.at < YEAR_TTL_MS) {
      const minutes = Math.max(1, Math.round((Date.now() - cached.at) / 60_000));
      return {
        ...cached.market,
        note: `${cached.market.note ?? ""} From a check ${minutes} min ago.`.trim(),
      };
    }
    let trace: Chrono24Debug[number] | null = null;
    if (debug) {
      trace = { searches: {}, details: [] };
      debug[y] = trace;
    }

    const yearQuery = `${opts.query} ${y}`;
    const [asc, desc, yearParamAsc, yearParamDesc] = await Promise.all([
      reefSearch({ apiKey, query: yearQuery, sort: "price_asc", deadline, attempts: 2 }),
      reefSearch({ apiKey, query: yearQuery, sort: "price_desc", deadline, attempts: 2 }),
      trace
        ? reefSearch({ apiKey, query: opts.query, year: y, sort: "price_asc", deadline, attempts: 1 })
        : null,
      trace
        ? reefSearch({ apiKey, query: opts.query, year: y, sort: "price_desc", deadline, attempts: 1 })
        : null,
    ]);
    if (trace) {
      trace.searches.textAsc = debugSearch(asc);
      trace.searches.textDesc = debugSearch(desc);
      if (yearParamAsc) trace.searches.yearParamAsc = debugSearch(yearParamAsc);
      if (yearParamDesc) trace.searches.yearParamDesc = debugSearch(yearParamDesc);
    }

    const empty: YearMarket = {
      lowestWorld: null,
      highestWorld: null,
      lowestUae: null,
      verifiedCount: 0,
    };
    if (asc.error && desc.error) return { ...empty, note: asc.error || desc.error };

    let outOfTime = false;
    const failures: string[] = [];
    const cheapEndDetails: MarketListing[] = [];
    const allDetails = new Map<string, MarketListing>();

    async function openListings(
      listings: MarketListing[],
      from: string,
    ): Promise<(MarketListing | null)[]> {
      const results = await Promise.all(
        listings.map((l) => cachedDetail(apiKey, l.id, deadline)),
      );
      return results.map((r, i) => {
        if (r.failure) failures.push(r.failure);
        trace?.details.push({
          id: listings[i]!.id,
          from,
          price: r.listing?.price ?? listings[i]!.price,
          year: r.listing?.year,
          location: r.listing?.location,
          failure: r.failure,
        });
        if (r.listing) allDetails.set(r.listing.id, r.listing);
        return r.listing;
      });
    }

    async function firstMatch(
      listings: MarketListing[],
      opened: MarketListing[],
      from: string,
    ): Promise<MarketListing | null> {
      for (let wave = 0; wave < MAX_WAVES; wave++) {
        const batch = listings.slice(wave * DETAIL_WAVE, (wave + 1) * DETAIL_WAVE);
        if (!batch.length) break;
        if (timeLeft(deadline) < 1_500) {
          outOfTime = true;
          break;
        }
        const details = await openListings(batch, from);
        for (const d of details) if (d) opened.push(d);
        // Keep search order: the first exact-year hit is the cheapest/priciest.
        const exact = details.find((d) => d && matchesExactYear(d, y, false));
        if (exact) return exact;
      }
      return opened.find((d) => matchesExactYear(d, y, true)) ?? null;
    }

    const [lowestWorld, highestWorld] = await Promise.all([
      firstMatch(asc.listings, cheapEndDetails, "textAsc"),
      firstMatch(desc.listings, [], "textDesc"),
      // Debug: check whether the year filter's cheapest results are that year.
      yearParamAsc ? openListings(yearParamAsc.listings.slice(0, 8), "yearParamAsc") : null,
    ]);
    const lowestUae =
      cheapEndDetails
        .filter((d) => isUae(d) && matchesExactYear(d, y, true))
        .sort((a, b) => a.price - b.price)[0] ?? null;
    const verifiedCount = [...allDetails.values()].filter((d) =>
      matchesExactYear(d, y, true),
    ).length;

    const failureNote = failures.length
      ? ` ${failures.length} listing check${failures.length === 1 ? "" : "s"} failed (${[...new Set(failures)].join(", ")}) — some prices may be missing.`
      : "";
    const market: YearMarket = {
      lowestWorld,
      highestWorld,
      lowestUae,
      verifiedCount,
      note:
        (outOfTime
          ? OUT_OF_TIME
          : !lowestWorld && !highestWorld
            ? `No Chrono24 listings verified for year ${y}. Use the year-filtered Chrono24 link.`
            : `Year ${y} search verified via Chrono24 details. Listing price before shipping.`) +
        failureNote,
    };
    if (!outOfTime && !failures.length && !asc.error && !desc.error) {
      yearCache.set(cacheKey, { at: Date.now(), market });
    }
    return market;
  }

  const markets = await Promise.all(years.map(verifyYear));
  return { byYear: Object.fromEntries(years.map((y, i) => [y, markets[i]!])) };
}
