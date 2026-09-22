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

export type Chrono24FetchResult = {
  listings: MarketListing[];
  currency: string;
  source: "reefapi" | "manual";
  error?: string;
};

export async function searchChrono24ViaReef(opts: {
  apiKey: string;
  query: string;
  year: number;
  sort: "price_asc" | "price_desc" | "relevance";
  page?: number;
}): Promise<Chrono24FetchResult> {
  const res = await fetch("https://api.reefapi.com/chrono24/v1/search", {
    method: "POST",
    headers: {
      "x-api-key": opts.apiKey,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      query: opts.query,
      year: opts.year,
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
      url: l.url ?? `https://www.chrono24.com/search/index.htm?query=${encodeURIComponent(opts.query)}`,
      image: l.image,
      year: String(opts.year),
    }));

  return { listings, currency, source: "reefapi" };
}

/** Pick extreme listing from a page; ReefAPI aggregate low/high is unreliable. */
export function pickExtreme(
  listings: MarketListing[],
  which: "lowest" | "highest",
): MarketListing | null {
  if (!listings.length) return null;
  const sorted = [...listings].sort((a, b) => a.price - b.price);
  return which === "lowest" ? sorted[0]! : sorted[sorted.length - 1]!;
}
