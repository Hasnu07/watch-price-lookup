import type { MarketListing } from "@/lib/watch-research";

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
  currency: string;
  source: "reefapi" | "manual";
  error?: string;
};

export type VerifiedChrono24Market = {
  byYear: Record<
    number,
    {
      lowestWorld: MarketListing | null;
      highestWorld: MarketListing | null;
      lowestUae: MarketListing | null;
      verifiedCount: number;
      note?: string;
    }
  >;
  error?: string;
};

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

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal, cache: "no-store" });
  } finally {
    clearTimeout(timer);
  }
}

async function reefSearch(opts: {
  apiKey: string;
  query: string;
  sort: "price_asc" | "price_desc" | "relevance";
  page?: number;
  attempts?: number;
}): Promise<Chrono24FetchResult> {
  const attempts = opts.attempts ?? 3;
  let lastError = "Chrono24 search failed";

  for (let attempt = 1; attempt <= attempts; attempt++) {
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
            page: opts.page ?? 1,
          }),
        },
        45_000,
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

      return { listings, currency, source: "reefapi" };
    } catch (e) {
      lastError =
        e instanceof Error && e.name === "AbortError"
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
): Promise<MarketListing | null> {
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
      25_000,
    );
    if (!res.ok) return null;
    const json = (await res.json()) as ReefDetailResponse;
    const watch = json.data?.watch;
    if (!watch || typeof watch.price !== "number" || watch.price <= 0) return null;
    return {
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
    };
  } catch {
    return null;
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

function yearsCovered(
  verified: MarketListing[],
  years: number[],
): boolean {
  return years.every((y) =>
    verified.some((l) => matchesExactYear(l, y, true)),
  );
}

/**
 * ReefAPI's search `year` param is unreliable (ignored).
 * We search by reference, then verify Year of production via detail,
 * matching Chrono24's year filter checkbox behaviour.
 */
export async function fetchChrono24VerifiedByYears(opts: {
  apiKey: string;
  query: string;
  years: number[];
  detailLimit?: number;
}): Promise<VerifiedChrono24Market> {
  const years = [...new Set(opts.years)].sort();
  const byYear: VerifiedChrono24Market["byYear"] = {};
  for (const y of years) {
    byYear[y] = {
      lowestWorld: null,
      highestWorld: null,
      lowestUae: null,
      verifiedCount: 0,
    };
  }

  // Sequential searches reduce provider load vs firing both at once (helps avoid 524).
  const asc = await reefSearch({
    apiKey: opts.apiKey,
    query: opts.query,
    sort: "price_asc",
  });
  const desc = asc.error
    ? await reefSearch({
        apiKey: opts.apiKey,
        query: opts.query,
        sort: "price_desc",
      })
    : await reefSearch({
        apiKey: opts.apiKey,
        query: opts.query,
        sort: "price_desc",
      });

  if (asc.error && desc.error) {
    return { byYear, error: asc.error || desc.error };
  }

  // Interleave cheap + expensive candidates so year coverage is better early.
  const seen = new Set<string>();
  const candidateIds: string[] = [];
  const a = asc.listings;
  const b = desc.listings;
  const maxLen = Math.max(a.length, b.length);
  for (let i = 0; i < maxLen; i++) {
    for (const item of [a[i], b[i]]) {
      if (!item || seen.has(item.id)) continue;
      seen.add(item.id);
      candidateIds.push(item.id);
    }
  }

  // Keep detail volume low on Railway to avoid provider timeouts.
  const limit = Math.min(opts.detailLimit ?? 16, candidateIds.length);
  const verified: MarketListing[] = [];
  const batchSize = 3;

  for (let i = 0; i < limit; i += batchSize) {
    const batch = candidateIds.slice(i, i + batchSize);
    const details = await Promise.all(
      batch.map((id) => reefDetail(opts.apiKey, id)),
    );
    for (const d of details) {
      if (d) verified.push(d);
    }
    // Early stop once every requested year has at least one verified listing
    // and we have enough samples for low/high within those years.
    if (yearsCovered(verified, years) && verified.length >= years.length * 2) {
      break;
    }
  }

  for (const y of years) {
    let yearListings = verified.filter((l) => matchesExactYear(l, y, false));
    let note: string | undefined;
    if (!yearListings.length) {
      yearListings = verified.filter((l) => matchesExactYear(l, y, true));
      if (yearListings.length) {
        note = `Only approximation-year listings found for ${y} after verifying Chrono24 details.`;
      }
    }

    const sorted = [...yearListings].sort((a, b) => a.price - b.price);
    const uae = sorted.filter(isUae);
    byYear[y] = {
      lowestWorld: sorted[0] ?? null,
      highestWorld: sorted.length ? sorted[sorted.length - 1]! : null,
      lowestUae: uae[0] ?? null,
      verifiedCount: yearListings.length,
      note:
        note ||
        (!yearListings.length
          ? `No Chrono24 listings verified for year ${y} (checked ${verified.length} details). Use the year-filtered Chrono24 link.`
          : undefined),
    };
  }

  return { byYear };
}

/** @deprecated Prefer fetchChrono24VerifiedByYears — search year filter is ignored by ReefAPI. */
export async function searchChrono24ViaReef(opts: {
  apiKey: string;
  query: string;
  year: number;
  sort: "price_asc" | "price_desc" | "relevance";
  page?: number;
}): Promise<Chrono24FetchResult> {
  return reefSearch({
    apiKey: opts.apiKey,
    query: opts.query,
    sort: opts.sort,
    page: opts.page,
  });
}

export function pickExtreme(
  listings: MarketListing[],
  which: "lowest" | "highest",
): MarketListing | null {
  if (!listings.length) return null;
  const sorted = [...listings].sort((a, b) => a.price - b.price);
  return which === "lowest" ? sorted[0]! : sorted[sorted.length - 1]!;
}
