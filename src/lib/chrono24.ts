import { toUsd } from "@/lib/deal";
import { fetchWithTimeout, isAbortError, timeLeft } from "@/lib/http";
import type { MarketListing } from "@/lib/watch-research";

const OUT_OF_TIME =
  "Stopped at the time limit — some Chrono24 prices may be missing. Use the Open Chrono24 year links.";
/** Cheapest listings opened per year to find a UAE seller (search cards have no country). */
const UAE_CHECKS = 8;
/** Across a long year range, fewer per year so ReefAPI isn't flooded. */
const UAE_CHECKS_TOTAL = 16;
/** ReefAPI detail pages can take 15–20s while Chrono24 challenges them. */
const DETAIL_TIMEOUT_MS = 25_000;
const SEARCH_TIMEOUT_MS = 25_000;
const SEARCH_ATTEMPTS = 3;
const SEARCH_TTL_MS = 20 * 60 * 1000;
const DETAIL_TTL_MS = 6 * 60 * 60 * 1000;
const MAX_CACHED = 2_000;
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
      total_results?: number | string;
    };
  };
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
  /** Chrono24's result count for the whole search (all pages). */
  total: number | null;
  currency: string;
  error?: string;
  fetchedAt: number;
};

type DetailResult = { listing: MarketListing | null; failure?: string };

/** "prices" = lowest/highest from the search (fast); "uae" = open listings for a UAE seller. */
export type Chrono24Mode = "prices" | "uae" | "all";

type YearMarket = {
  lowestWorld: MarketListing | null;
  highestWorld: MarketListing | null;
  lowestUae: MarketListing | null;
  total: number | null;
  /** USD prices of the year search's listings, for market stats. */
  sampleUsd: number[];
  note?: string;
  uaeNote?: string;
};

export type VerifiedChrono24Market = {
  byYear: Record<number, YearMarket>;
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
        total: number | null;
        top: { id: string; price: number; title: string }[];
      }
    >;
    details: {
      id: string;
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

/** ReefAPI answers ok=false like this when Chrono24 challenges its scraper. */
function isTransientProviderError(message: string): boolean {
  return /did not serve|challeng|transient|retry|403|429/i.test(message);
}

async function reefSearch(opts: {
  apiKey: string;
  query: string;
  sort: "price_asc" | "price_desc";
  deadline: number;
}): Promise<Chrono24FetchResult> {
  let lastError = "Chrono24 search failed";
  const failed = (error: string): Chrono24FetchResult => ({
    listings: [],
    total: null,
    currency: "USD",
    error,
    fetchedAt: Date.now(),
  });

  for (let attempt = 1; attempt <= SEARCH_ATTEMPTS; attempt++) {
    const budget = Math.min(SEARCH_TIMEOUT_MS, timeLeft(opts.deadline) - 500);
    if (budget < 3_000) {
      lastError = attempt === 1 ? OUT_OF_TIME : lastError;
      break;
    }
    const retryable = (message: string) =>
      isTransientProviderError(message) &&
      attempt < SEARCH_ATTEMPTS &&
      timeLeft(opts.deadline) > 1_000 * attempt + 5_000;
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
          body: JSON.stringify({ query: opts.query, sort: opts.sort, page: 1 }),
        },
        budget,
      );

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        lastError = sanitizeApiError(res.status, text);
        if ([502, 503, 504, 524, 429, 403].includes(res.status) && retryable("retry")) {
          await sleep(1_000 * attempt);
          continue;
        }
        return failed(lastError);
      }

      const json = (await res.json()) as ReefSearchResponse;
      if (json.ok === false) {
        lastError =
          typeof json.error === "string"
            ? json.error
            : json.error?.message || "ReefAPI returned ok=false";
        if (retryable(lastError)) {
          await sleep(1_000 * attempt);
          continue;
        }
        return failed(lastError);
      }

      const currency = json.data?.aggregate?.currency || "USD";
      const total = Number(json.data?.aggregate?.total_results);
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

      return {
        listings,
        total: Number.isFinite(total) ? total : null,
        currency,
        fetchedAt: Date.now(),
      };
    } catch (e) {
      lastError = isAbortError(e)
        ? "Chrono24 search timed out. Retry or use the Open Chrono24 links."
        : e instanceof Error
          ? e.message
          : "Chrono24 search network error";
      if (retryable("retry")) await sleep(1_000 * attempt);
      else break;
    }
  }

  return failed(lastError);
}

async function reefDetail(
  apiKey: string,
  listingId: string,
  deadline: number,
): Promise<DetailResult> {
  const budget = Math.min(DETAIL_TIMEOUT_MS, timeLeft(deadline) - 300);
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

function isUae(listing: MarketListing): boolean {
  const loc = (listing.location || "").toUpperCase();
  return loc === "AE" || loc === "UAE" || loc.includes("UNITED ARAB");
}

/** A tiny TTL cache of promises: concurrent callers share one call, failures are dropped. */
function promiseCache<T>(ttlMs: number, failed: (value: T) => boolean) {
  const entries = new Map<string, { at: number; value: Promise<T> }>();
  return (key: string, load: () => Promise<T>): Promise<T> => {
    const hit = entries.get(key);
    if (hit && Date.now() - hit.at < ttlMs) return hit.value;
    const value = load();
    entries.set(key, { at: Date.now(), value });
    void value.then((v) => {
      if (failed(v)) entries.delete(key);
    });
    // Maps iterate in insertion order: drop the oldest entries first.
    for (const k of entries.keys()) {
      if (entries.size <= MAX_CACHED) break;
      entries.delete(k);
    }
    return value;
  };
}

/**
 * Searches are shared across requests: the page's "prices" and "uae"
 * requests run at the same time and reuse one search, and re-checking the
 * same watch within 20 minutes costs nothing.
 */
const searchCache = promiseCache<Chrono24FetchResult>(SEARCH_TTL_MS, (r) => Boolean(r.error));
const detailCache = promiseCache<DetailResult>(DETAIL_TTL_MS, (r) => !r.listing);

/**
 * Lowest / highest from Chrono24's year search. Each search returns one page
 * (~60 listings): the cheapest-first page holds the true lowest and the
 * priciest-first page the true highest. If one search failed, the other
 * still answers for both ends when it holds every result.
 */
export function yearPricesFromSearch(
  asc: Pick<Chrono24FetchResult, "listings" | "total" | "error">,
  desc: Pick<Chrono24FetchResult, "listings" | "total" | "error">,
): { lowest: MarketListing | null; highest: MarketListing | null; total: number | null; error?: string } {
  const byPrice = (ls: MarketListing[]) => [...ls].sort((a, b) => a.price - b.price);
  const complete = (r: typeof asc) =>
    !r.error && (r.total === null || r.listings.length >= r.total);
  const ascOk = !asc.error;
  const descOk = !desc.error;
  if (!ascOk && !descOk) {
    return { lowest: null, highest: null, total: null, error: asc.error || desc.error };
  }
  const cheap = ascOk ? byPrice(asc.listings) : complete(desc) ? byPrice(desc.listings) : [];
  const pricey = descOk ? byPrice(desc.listings) : complete(asc) ? byPrice(asc.listings) : [];
  const missing = !cheap.length && !ascOk ? "lowest" : !pricey.length && !descOk ? "highest" : null;
  return {
    lowest: cheap[0] ?? null,
    highest: pricey[pricey.length - 1] ?? null,
    total: asc.total ?? desc.total ?? null,
    error: missing
      ? `Chrono24 blocked the ${missing === "lowest" ? "cheapest" : "priciest"}-first search — the ${missing} price may be missing. Retry in a moment.`
      : undefined,
  };
}

/**
 * Putting the year in the query ("7010/1G 2026") makes Chrono24 apply its
 * year-of-production filter — it returns the same listings as the
 * year-filtered Chrono24 link. (ReefAPI's own `year` param is ignored; a
 * debug probe on 2026-09-28 returned all 56 listings from every year.)
 */
export async function fetchChrono24ByYears(opts: {
  apiKey: string;
  query: string;
  years: number[];
  mode: Chrono24Mode;
  /** Epoch ms by which we must return, with whatever was found so far. */
  deadline: number;
  debug?: Chrono24Debug;
}): Promise<VerifiedChrono24Market> {
  const { apiKey, deadline, debug, mode } = opts;
  const years = [...new Set(opts.years)].sort();
  const uaeChecks = Math.min(UAE_CHECKS, Math.max(4, Math.floor(UAE_CHECKS_TOTAL / years.length)));

  async function forYear(y: number): Promise<YearMarket> {
    const yearQuery = `${opts.query} ${y}`;
    const search = (sort: "price_asc" | "price_desc") =>
      debug
        ? reefSearch({ apiKey, query: yearQuery, sort, deadline })
        : searchCache(`${yearQuery.toUpperCase()}|${sort}`, () =>
            reefSearch({ apiKey, query: yearQuery, sort, deadline }),
          );
    const [asc, desc] = await Promise.all([search("price_asc"), search("price_desc")]);

    let trace: Chrono24Debug[number] | null = null;
    if (debug) {
      trace = { searches: {}, details: [] };
      debug[y] = trace;
      for (const [name, r] of [["textAsc", asc], ["textDesc", desc]] as const) {
        trace.searches[name] = {
          error: r.error,
          count: r.listings.length,
          total: r.total,
          top: r.listings
            .slice(0, DEBUG_TOP)
            .map((l) => ({ id: l.id, price: l.price, title: l.title.slice(0, 80) })),
        };
      }
    }

    const prices = yearPricesFromSearch(asc, desc);
    const ageMinutes = Math.round((Date.now() - Math.min(asc.fetchedAt, desc.fetchedAt)) / 60_000);
    const market: YearMarket = {
      lowestWorld: null,
      highestWorld: null,
      lowestUae: null,
      total: prices.total,
      sampleUsd: (asc.error ? desc : asc).listings
        .map((l) => toUsd(l.price, l.currency))
        .filter((n): n is number => n !== null)
        .sort((a, b) => a - b),
    };

    if (mode !== "uae") {
      const tagYear = (l: MarketListing | null) => (l ? { ...l, year: String(y) } : null);
      market.lowestWorld = tagYear(prices.lowest);
      market.highestWorld = tagYear(prices.highest);
      const count = prices.total ?? asc.listings.length;
      market.note =
        prices.error && !prices.lowest && !prices.highest
          ? prices.error
          : [
              prices.lowest || prices.highest
                ? `Chrono24 ${y} search: ${count} listing${count === 1 ? "" : "s"} — same list as the Open Chrono24 link. Listing price before shipping.`
                : `No Chrono24 listings for year ${y}. Use the year-filtered Chrono24 link.`,
              prices.error,
              ageMinutes >= 1 ? `From a check ${ageMinutes} min ago.` : null,
            ]
              .filter(Boolean)
              .join(" ");
    }

    if (mode !== "prices") {
      const cheapest = (asc.error ? [...desc.listings].reverse() : asc.listings).slice(
        0,
        uaeChecks,
      );
      const results = await Promise.all(
        cheapest.map((l) =>
          debug
            ? reefDetail(apiKey, l.id, deadline)
            : detailCache(l.id, () => reefDetail(apiKey, l.id, deadline)),
        ),
      );
      results.forEach((r, i) =>
        trace?.details.push({
          id: cheapest[i]!.id,
          price: r.listing?.price ?? cheapest[i]!.price,
          year: r.listing?.year,
          location: r.listing?.location,
          failure: r.failure,
        }),
      );
      // Cheapest first; skip a UAE listing whose detail shows another year.
      market.lowestUae =
        results
          .map((r) => r.listing)
          .find((d) => {
            if (!d || !isUae(d)) return false;
            const { year } = parseChrono24Year(d.year);
            return year === null || year === y;
          }) ?? null;
      const failed = results.filter((r) => r.failure).length;
      market.uaeNote = market.lowestUae
        ? `UAE seller · year ${market.lowestUae.year || y}`
        : !cheapest.length
          ? prices.error || `No Chrono24 listings for year ${y}.`
          : failed
            ? `Couldn't open ${failed} of the ${cheapest.length} cheapest ${y} listings (Chrono24 is slow) — open the UAE Chrono24 link to confirm.`
            : `No UAE seller among the ${cheapest.length} cheapest ${y} listings — open the UAE Chrono24 link to confirm.`;
    }

    return market;
  }

  const markets = await Promise.all(years.map(forYear));
  return { byYear: Object.fromEntries(years.map((y, i) => [y, markets[i]!])) };
}
