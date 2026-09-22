export type ResearchInput = {
  reference: string;
  year: number;
  month?: number | null;
  dial?: string;
};

export type YearPlan = {
  ourYear: number;
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

export type B2BEntry = {
  price: string;
  currency: string;
  source: string;
  year: number;
  month?: number | null;
  notes?: string;
};

export type ResearchReport = {
  reference: string;
  dial: string;
  year: number;
  month: number | null;
  yearPlan: YearPlan;
  b2b: B2BEntry[];
  b2c: {
    byYear: Record<
      number,
      {
        lowestWorld: B2CSlice;
        highestWorld: B2CSlice;
        lowestUae: B2CSlice;
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
    notes: string[];
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

export function buildYearPlan(year: number, month?: number | null): YearPlan {
  const rules: string[] = [];
  let yearsToCheck: number[] = [];
  const monthMatters = year === 2026;

  if (year === 2026) {
    yearsToCheck = [2026, 2025];
    rules.push(
      "Our watch is 2026 — search 2026 first, then also check 2025 for the value gap.",
    );
    rules.push(
      "Month matters for fresh pieces (especially Patek, Rolex, AP). Prefer listings closest to our month.",
    );
    if (month) {
      rules.push(
        `Target month: ${MONTH_NAMES[month - 1]} ${year}. Hong Kong pays more for the freshest stock.`,
      );
    } else {
      rules.push("Year is 2026 — enter the production month so we can match freshness.");
    }
  } else if (year === 2025 || year === 2024) {
    yearsToCheck = [2024, 2025];
    rules.push(
      `Our watch is ${year} — report 2024 and 2025 only. Do not use 2026 prices as a reference.`,
    );
  } else {
    yearsToCheck = [year, year - 1].filter((y) => y >= 1990);
    rules.push(
      `Our watch is ${year} — check ${yearsToCheck.join(" and ")}. Avoid newer-year prices as comps.`,
    );
  }

  return {
    ourYear: year,
    ourMonth: monthMatters ? month ?? null : null,
    yearsToCheck,
    rules,
    monthMatters,
  };
}

export function chrono24SearchUrl(opts: {
  reference: string;
  year: number;
  sort: "lowest" | "highest" | "relevance";
  country?: "AE" | "world";
}): string {
  const params = new URLSearchParams();
  params.set("query", opts.reference);
  params.set("dosearch", "true");
  params.set("searchexplain", "1");
  // Chrono24 yearManufactured filter
  params.set("yearManufactured", String(opts.year));
  // sortorder: 1 = price ascending, 11 = price descending (common Chrono24 values)
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

export function buildEmptyReport(input: ResearchInput): ResearchReport {
  const reference = normalizeReference(input.reference);
  const dial = input.dial?.trim() || extractDialHint(reference);
  const yearPlan = buildYearPlan(input.year, input.month);
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
    year: input.year,
    month: yearPlan.ourMonth,
    yearPlan,
    b2b: yearPlan.yearsToCheck.map((y) => ({
      price: "",
      currency: "USD",
      source: "timedealer",
      year: y,
      month: y === 2026 ? yearPlan.ourMonth : null,
      notes: "",
    })),
    b2c: { byYear },
    links: {
      timedealer: timedealerSearchUrl(reference),
      chrono24Base: chrono24SearchUrl({
        reference,
        year: input.year,
        sort: "relevance",
      }),
      otherSources: otherMarketLinks(reference),
    },
    feasibility: {
      b2cAuto: false,
      b2bAuto: false,
      notes: [
        "B2C can auto-fill when a ReefAPI key is configured (Chrono24 blocks direct scraping).",
        "B2B (TimeDealer + dealer groups) requires your team login — enter prices manually; keep HKD as HKD.",
      ],
    },
  };
}

function formatMoney(price: number | string, currency: string): string {
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

export function formatReportText(report: ResearchReport): string {
  const monthLabel =
    report.year === 2026 && report.month
      ? `${report.year} (${MONTH_NAMES[report.month - 1]})`
      : String(report.year);

  const lines: string[] = [];
  lines.push(`Reference + dial: ${report.reference} · dial ${report.dial}`);
  lines.push(`Year: ${monthLabel}`);
  lines.push("");
  lines.push("B2B:");
  for (const entry of report.b2b) {
    const ym =
      entry.year === 2026 && entry.month
        ? `${entry.year}/${String(entry.month).padStart(2, "0")}`
        : String(entry.year);
    const price =
      entry.price.trim() === ""
        ? "PENDING"
        : formatMoney(entry.price, entry.currency);
    lines.push(
      `  · ${ym}: ${price} · source ${entry.source || "timedealer / group"}${entry.notes ? ` · ${entry.notes}` : ""}`,
    );
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

  lines.push("");
  lines.push("Checklist:");
  for (const rule of report.yearPlan.rules) {
    lines.push(`  ✓ ${rule}`);
  }

  return lines.join("\n");
}

export { MONTH_NAMES };
