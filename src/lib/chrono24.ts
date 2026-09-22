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

async function reefSearch(opts: {
  apiKey: string;
  query: string;
  sort: "price_asc" | "price_desc" | "relevance";
  page?: number;
}): Promise<Chrono24FetchResult> {
  const res = await fetch("https://api.reefapi.com/chrono24/v1/search", {
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
    cache: "no-store",
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return {
      listings: [],
      currency: "USD",
      source: "reefapi",
      error: `ReefAPI HTTP ${res.status}: ${text.slice(0, 200)}`,
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
}

async function reefDetail(
  apiKey: string,
  listingId: string,
): Promise<MarketListing | null> {
  const res = await fetch("https://api.reefapi.com/chrono24/v1/detail", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ listing_id: listingId }),
    cache: "no-store",
  });
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

  const [asc, desc] = await Promise.all([
    reefSearch({ apiKey: opts.apiKey, query: opts.query, sort: "price_asc" }),
    reefSearch({ apiKey: opts.apiKey, query: opts.query, sort: "price_desc" }),
  ]);

  if (asc.error && desc.error) {
    return { byYear, error: asc.error || desc.error };
  }

  const seen = new Set<string>();
  const candidateIds: string[] = [];
  for (const list of [asc.listings, desc.listings]) {
    for (const item of list) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      candidateIds.push(item.id);
    }
  }

  const limit = Math.min(opts.detailLimit ?? 40, candidateIds.length);
  const verified: MarketListing[] = [];
  const batchSize = 8;
  for (let i = 0; i < limit; i += batchSize) {
    const batch = candidateIds.slice(i, i + batchSize);
    const details = await Promise.all(
      batch.map((id) => reefDetail(opts.apiKey, id)),
    );
    for (const d of details) {
      if (d) verified.push(d);
    }
  }

  // Retry failed details once (Chrono24 detail can return TARGET_BLOCKED)
  const got = new Set(verified.map((v) => v.id));
  const missing = candidateIds.slice(0, limit).filter((id) => !got.has(id));
  if (missing.length) {
    const retries = await Promise.all(
      missing.map((id) => reefDetail(opts.apiKey, id)),
    );
    for (const d of retries) {
      if (d) verified.push(d);
    }
  }

  for (const y of years) {
    // Prefer exact year checkbox matches; fall back to approximations only if none.
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
