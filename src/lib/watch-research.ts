export type ResearchInput = {
  reference: string;
  yearFrom: number;
  yearTo: number;
  month?: number | null;
  dial?: string;
};

export type YearPlan = {
  yearFrom: number;
  yearTo: number;
  /** Production month of our watch; applies to the newest year in the range. */
  ourMonth: number | null;
  yearsToCheck: number[];
  rules: string[];
  monthMatters: boolean;
};

export type MarketListing = {
  id: string;
  title: string;
  price: number;
  currency: string;
  url: string;
  location?: string;
  year?: string;
  image?: string;
};

export type B2CSlice = {
  year: number;
  scope: "world" | "uae";
  sort: "lowest" | "highest";
  searchUrl: string;
  listing: MarketListing | null;
  note?: string;
};

/** One dealer "for sale" quote from the TimeDealer feed. */
export type B2BQuote = {
  id: string;
  reference: string;
  price: number;
  currency: string;
  /** TimeDealer's own USD conversion — display only, never used in the report. */
  usdPrice: number | null;
  releaseDate: string | null;
  /** ISO timestamp of when the dealer posted it. */
  postedAt: string | null;
  seller: string | null;
  sellerPhone: string | null;
  sellerAvatar: string | null;
  group: string | null;
  condition: string | null;
  color: string | null;
  note: string | null;
  image: string | null;
  verified: boolean;
  timesPosted: number | null;
};

export type B2BYear = {
  year: number;
  /** Our target month — only set on the row for our own year. */
  month: number | null;
  quotes: B2BQuote[];
  /** Listings seen (reposts merged, typos dropped) before the display cap. */
  totalFound: number;
  dealerCount?: number;
  /** TimeDealer has posts between the cheapest and priciest pages we read. */
  moreAvailable?: boolean;
  status: "ok" | "empty" | "error" | "skipped";
  note?: string;
  /** USD value of every listing seen (not just the cards), for market stats. */
  sampleUsd?: number[];
};

export type ResearchReport = {
  reference: string;
  dial: string;
  yearFrom: number;
  yearTo: number;
  month: number | null;
  generatedAt: string;
  /** Provider diagnostics, only when the request asks for `debug`. */
  debug?: Record<string, unknown>;
  yearPlan: YearPlan;
  b2b: B2BYear[];
  b2c: {
    byYear: Record<
      number,
      {
        lowestWorld: B2CSlice;
        highestWorld: B2CSlice;
        lowestUae: B2CSlice;
        /** Chrono24's year search: result count and listing prices (USD). */
        retail?: { total: number | null; sampleUsd: number[] };
      }
    >;
  };
  links: {
    timedealer: string;
    chrono24Base: string;
    otherSources: { name: string; url: string }[];
  };
  feasibility: {
    b2cAuto: boolean;
    b2bAuto: boolean;
    b2bNote: string;
    b2cNote: string;
  };
};

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** Dealer quote cards per year: the cheapest ones plus the single highest. */
export const MAX_B2B_CARDS = 10;
/** Years in one check; each year costs TimeDealer + ReefAPI calls. */
export const MAX_YEAR_SPAN = 6;
/** Cheapest dealer quotes listed in the copy-paste report (plus the highest). */
const REPORT_CHEAPEST_QUOTES = 3;

export function normalizeReference(raw: string): string {
  return raw.trim().replace(/\s+/g, "").toUpperCase();
}

/** Dial often lives in the suffix after the last hyphen, e.g. 7118/1200A-010 */
export function extractDialHint(reference: string): string {
  const ref = normalizeReference(reference);
  const parts = ref.split("-");
  if (parts.length < 2) return "Confirm dial colour from the watch";
  return parts[parts.length - 1] ?? "Confirm dial colour from the watch";
}

/**
 * Old single-year links (?year=2026) map to the team's original comparison
 * rule: current year → it + the year before; the two years before that →
 * those two; older → that year and the one before.
 */
export function legacyYearRange(
  year: number,
  currentYear: number = new Date().getFullYear(),
): { yearFrom: number; yearTo: number } {
  if (year === currentYear) return { yearFrom: year - 1, yearTo: year };
  if (year === currentYear - 1 || year === currentYear - 2) {
    return { yearFrom: currentYear - 2, yearTo: currentYear - 1 };
  }
  return { yearFrom: year - 1, yearTo: year };
}

export function yearsLabel(yearFrom: number, yearTo: number): string {
  return yearFrom === yearTo ? String(yearTo) : `${yearFrom}–${yearTo}`;
}

/** Every year from `yearFrom` to `yearTo` is checked separately, newest first. */
export function buildYearPlan(
  yearFrom: number,
  yearTo: number,
  month?: number | null,
  currentYear: number = new Date().getFullYear(),
): YearPlan {
  const from = Math.min(yearFrom, yearTo);
  const to = Math.max(yearFrom, yearTo);
  const yearsToCheck: number[] = [];
  for (let y = to; y >= from; y--) yearsToCheck.push(y);
  const monthMatters = to === currentYear;
  const ourMonth = month ?? null;

  const rules: string[] = [
    from === to
      ? `Comparing ${to} pieces only.`
      : `Comparing ${from}–${to}: each year is priced separately, newest first.`,
  ];
  if (monthMatters) {
    rules.push(
      ourMonth
        ? `Month matters for fresh pieces (especially Patek, Rolex, AP). Target month: ${MONTH_NAMES[ourMonth - 1]} ${to} — Hong Kong pays more for the freshest stock.`
        : "Month matters for fresh pieces (especially Patek, Rolex, AP) — add it when known so same-month quotes stand out.",
    );
  } else if (to < currentYear) {
    rules.push(`Range ends at ${to} — leave newer-year prices out as comps.`);
  }

  return { yearFrom: from, yearTo: to, ourMonth, yearsToCheck, rules, monthMatters };
}

export function chrono24SearchUrl(opts: {
  reference: string;
  year: number;
  sort: "lowest" | "highest" | "relevance";
  country?: "AE" | "world";
}): string {
  const params = new URLSearchParams();
  params.set("dosearch", "true");
  params.set("query", opts.reference);
  // Chrono24 Year-of-production checkbox uses repeated `year=` params
  params.append("year", String(opts.year));
  // sortorder: 1 = price ascending, 11 = price descending
  if (opts.sort === "lowest") params.set("sortorder", "1");
  if (opts.sort === "highest") params.set("sortorder", "11");
  if (opts.country === "AE") params.set("countryIds", "AE");
  return `https://www.chrono24.com/search/index.htm?${params.toString()}`;
}

export function timedealerSearchUrl(reference: string): string {
  const q = encodeURIComponent(reference);
  return `https://timedealer.io/?q=${q}`;
}

export function otherMarketLinks(reference: string): { name: string; url: string }[] {
  const q = encodeURIComponent(reference);
  return [
    {
      name: "WatchCharts",
      url: `https://watchcharts.com/search?q=${q}`,
    },
    {
      name: "eBay (sold)",
      url: `https://www.ebay.com/sch/i.html?_nkw=${q}&LH_Sold=1&LH_Complete=1`,
    },
    {
      name: "Bezel",
      url: `https://www.shopbezel.com/search?q=${q}`,
    },
  ];
}

export function emptyB2CSlice(
  year: number,
  scope: "world" | "uae",
  sort: "lowest" | "highest",
  reference: string,
): B2CSlice {
  return {
    year,
    scope,
    sort,
    searchUrl: chrono24SearchUrl({
      reference,
      year,
      sort,
      country: scope === "uae" ? "AE" : "world",
    }),
    listing: null,
  };
}

export function buildEmptyReport(
  input: ResearchInput,
  currentYear?: number,
): ResearchReport {
  const reference = normalizeReference(input.reference);
  const dial = input.dial?.trim() || extractDialHint(reference);
  const yearPlan = buildYearPlan(input.yearFrom, input.yearTo, input.month, currentYear);
  const byYear: ResearchReport["b2c"]["byYear"] = {};

  for (const y of yearPlan.yearsToCheck) {
    byYear[y] = {
      lowestWorld: emptyB2CSlice(y, "world", "lowest", reference),
      highestWorld: emptyB2CSlice(y, "world", "highest", reference),
      lowestUae: emptyB2CSlice(y, "uae", "lowest", reference),
    };
  }

  return {
    reference,
    dial,
    yearFrom: yearPlan.yearFrom,
    yearTo: yearPlan.yearTo,
    month: yearPlan.ourMonth,
    generatedAt: new Date().toISOString(),
    yearPlan,
    b2b: yearPlan.yearsToCheck.map((y) => ({
      year: y,
      month: y === yearPlan.yearTo ? yearPlan.ourMonth : null,
      quotes: [],
      totalFound: 0,
      status: "skipped",
    })),
    b2c: { byYear },
    links: {
      timedealer: timedealerSearchUrl(reference),
      chrono24Base: chrono24SearchUrl({
        reference,
        year: yearPlan.yearTo,
        sort: "relevance",
      }),
      otherSources: otherMarketLinks(reference),
    },
    feasibility: {
      b2cAuto: false,
      b2bAuto: false,
      b2bNote:
        "B2B (TimeDealer + dealer groups) requires your team login. HKD stays HKD.",
      b2cNote:
        "B2C can auto-fill when a ReefAPI key is configured (Chrono24 blocks direct scraping).",
    },
  };
}

/**
 * Comparable value across currencies: TimeDealer's own USD estimate. Only
 * used for ordering — cards and the report keep the original currency.
 */
function comparableValue(quote: B2BQuote): number {
  return quote.usdPrice ?? quote.price;
}

/** Cheapest first, so HKD and USD quotes rank together. */
export function sortQuotes(quotes: B2BQuote[]): B2BQuote[] {
  return [...quotes].sort((a, b) => comparableValue(a) - comparableValue(b));
}

/**
 * Drop obvious price typos (an extra or missing zero) so they can't become
 * the "lowest" or "highest": anything above 3× or below ⅓ of the median.
 */
export function dropPriceOutliers(quotes: B2BQuote[]): B2BQuote[] {
  if (quotes.length < 4) return quotes;
  const values = quotes.map(comparableValue).sort((a, b) => a - b);
  const median = values[Math.floor(values.length / 2)]!;
  return quotes.filter((q) => {
    const value = comparableValue(q);
    return value <= median * 3 && value >= median / 3;
  });
}

/** The cheapest (max − 1) quotes plus the single highest, in price order. */
export function pickDisplayQuotes(
  quotes: B2BQuote[],
  max: number = MAX_B2B_CARDS,
): B2BQuote[] {
  const sorted = sortQuotes(quotes);
  if (sorted.length <= max) return sorted;
  return [...sorted.slice(0, max - 1), sorted[sorted.length - 1]!];
}

/** Month number from a TimeDealer release date like "2026-03" or "2026-03-14". */
export function releaseMonth(releaseDate: string | null): number | null {
  const m = releaseDate?.match(/^\d{4}-(\d{1,2})/);
  return m ? Number(m[1]) : null;
}

export function formatMoney(price: number | string, currency: string): string {
  if (price === "" || price === null || price === undefined) return "—";
  const n = typeof price === "number" ? price : Number(String(price).replace(/,/g, ""));
  if (!Number.isFinite(n)) return `${price} ${currency}`.trim();
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency || "USD",
      maximumFractionDigits: 0,
    }).format(n);
  } catch {
    return `${n.toLocaleString("en-US")} ${currency}`;
  }
}

function describeQuote(quote: B2BQuote): string {
  return [
    quote.seller || "dealer",
    quote.group,
    quote.releaseDate ? `dated ${quote.releaseDate}` : null,
    quote.condition,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** Send-ready text; `extra` (market levels, deal checks) goes before the checklist. */
export function formatReportText(report: ResearchReport, extra: string[] = []): string {
  const years = yearsLabel(report.yearFrom, report.yearTo);
  const monthLabel = report.month
    ? ` (${MONTH_NAMES[report.month - 1]} ${report.yearTo})`
    : "";

  const lines: string[] = [];
  lines.push(`Reference + dial: ${report.reference} · dial ${report.dial}`);
  lines.push(`${report.yearFrom === report.yearTo ? "Year" : "Years"}: ${years}${monthLabel}`);
  lines.push("");
  lines.push("B2B:");
  for (const entry of report.b2b) {
    const ym = entry.month
      ? `${entry.year}/${String(entry.month).padStart(2, "0")}`
      : String(entry.year);
    if (!entry.quotes.length) {
      lines.push(`  · ${ym}: PENDING${entry.note ? ` — ${entry.note}` : ""}`);
      continue;
    }
    const count = entry.totalFound || entry.quotes.length;
    const dealers = entry.dealerCount
      ? ` from ${entry.dealerCount} dealer${entry.dealerCount === 1 ? "" : "s"}`
      : "";
    lines.push(
      `  · ${ym}: ${count}${entry.moreAvailable ? "+" : ""} listing${count === 1 ? "" : "s"}${dealers}`,
    );
    const quotes = sortQuotes(entry.quotes);
    const listed = quotes.slice(0, REPORT_CHEAPEST_QUOTES).map((quote, i) => ({
      label: i === 0 ? "lowest" : `#${i + 1}`,
      quote,
    }));
    if (quotes.length > REPORT_CHEAPEST_QUOTES) {
      listed.push({ label: "highest", quote: quotes[quotes.length - 1]! });
    }
    for (const { label, quote } of listed) {
      lines.push(
        `      ${`${label}:`.padEnd(9)}${formatMoney(quote.price, quote.currency)} · ${describeQuote(quote)}`,
      );
    }
  }

  lines.push("");
  lines.push("B2C:");
  for (const y of report.yearPlan.yearsToCheck) {
    const slice = report.b2c.byYear[y];
    if (!slice) continue;
    const low = slice.lowestWorld.listing;
    const high = slice.highestWorld.listing;
    const uae = slice.lowestUae.listing;
    lines.push(`  · ${y}`);
    lines.push(
      `      lowest world: ${low ? formatMoney(low.price, low.currency) : "PENDING"}`,
    );
    lines.push(
      `      highest world: ${high ? formatMoney(high.price, high.currency) : "PENDING"}`,
    );
    lines.push(
      `      lowest UAE: ${uae ? formatMoney(uae.price, uae.currency) : "PENDING"}`,
    );
  }

  if (extra.length) {
    lines.push("");
    lines.push(...extra);
  }

  lines.push("");
  lines.push("Checklist:");
  for (const rule of report.yearPlan.rules) {
    lines.push(`  ✓ ${rule}`);
  }

  return lines.join("\n");
}

export { MONTH_NAMES };
