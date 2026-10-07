import {
  formatMoney,
  type MarketListing,
  type ResearchReport,
} from "@/lib/watch-research";

/**
 * HKD and AED are pegged to the US dollar, so fixed rates are exact enough
 * for deal maths. Dealer quotes keep their own currency everywhere else.
 */
export const USD_RATES = { USD: 1, HKD: 7.8, AED: 3.6725 } as const;
export type DealCurrency = keyof typeof USD_RATES;
export const DEAL_CURRENCIES = Object.keys(USD_RATES) as DealCurrency[];

export function toUsd(amount: number, currency: string): number | null {
  const rate = USD_RATES[currency.toUpperCase() as DealCurrency];
  return rate ? amount / rate : null;
}

export function fromUsd(usd: number, currency: DealCurrency): number {
  return usd * USD_RATES[currency];
}

/** Re-express a typed amount in another currency ("85,000" USD → "663,000" HKD). */
export function convertTyped(raw: string, from: DealCurrency, to: DealCurrency): string {
  const amount = parseAmount(raw);
  if (amount === null || from === to) return raw;
  return Math.round(fromUsd(amount / USD_RATES[from], to)).toLocaleString("en-US");
}

/** "1,450,000" → 1450000; empty or invalid → null. */
export function parseAmount(raw: string): number | null {
  if (!raw.trim()) return null;
  const n = Number(raw.replace(/[,\s]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Percent input; blank or invalid falls back, clamped to a sane range. */
export function parsePercent(raw: string, fallback: number): number {
  const n = Number(raw.replace(",", "."));
  if (!raw.trim() || !Number.isFinite(n)) return fallback;
  return Math.min(90, Math.max(-50, n));
}

function median(sorted: number[]): number | null {
  if (!sorted.length) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** Market levels in USD across every year in the range. */
export type MarketLevels = {
  dealerLow: number | null;
  dealerMedian: number | null;
  dealerHigh: number | null;
  dealerCount: number;
  retailLow: number | null;
  retailMedian: number | null;
  retailHigh: number | null;
  retailUae: number | null;
  retailCount: number;
};

export function marketLevels(report: ResearchReport): MarketLevels {
  const dealer = report.b2b
    .flatMap(
      (entry) =>
        entry.sampleUsd ??
        entry.quotes.map((q) => q.usdPrice ?? toUsd(q.price, q.currency)),
    )
    .filter((n): n is number => typeof n === "number" && n > 0)
    .sort((a, b) => a - b);

  const years = Object.values(report.b2c.byYear);
  const usd = (l: MarketListing | null) => (l ? toUsd(l.price, l.currency) : null);
  const values = (pick: (y: (typeof years)[number]) => MarketListing | null) =>
    years.map((y) => usd(pick(y))).filter((n): n is number => n !== null);
  const retailSample = years.flatMap((y) => y.retail?.sampleUsd ?? []).sort((a, b) => a - b);
  const lows = values((y) => y.lowestWorld.listing);
  const highs = values((y) => y.highestWorld.listing);
  const uaes = values((y) => y.lowestUae.listing);

  return {
    dealerLow: dealer[0] ?? null,
    dealerMedian: median(dealer),
    dealerHigh: dealer[dealer.length - 1] ?? null,
    dealerCount: dealer.length,
    retailLow: lows.length ? Math.min(...lows) : (retailSample[0] ?? null),
    retailMedian: median(retailSample),
    retailHigh: highs.length ? Math.max(...highs) : (retailSample[retailSample.length - 1] ?? null),
    retailUae: uaes.length ? Math.min(...uaes) : null,
    retailCount: years.reduce(
      (n, y) => n + (y.retail?.total ?? y.retail?.sampleUsd.length ?? 0),
      0,
    ),
  };
}

export type DealSettings = {
  /** Commission, shipping, fees — as % of the sale price. */
  costsPct: number;
  /** Profit we want — as % of the sale price. */
  profitPct: number;
};

/** The most we can pay and still clear costs + profit when we sell at `exitUsd`. */
export function maxBuyPrice(exitUsd: number, s: DealSettings): number {
  return exitUsd * (1 - (s.costsPct + s.profitPct) / 100);
}

/** The least we can sell for and still clear costs + profit on `costUsd`. */
export function minSellPrice(costUsd: number, s: DealSettings): number | null {
  const keep = 1 - (s.costsPct + s.profitPct) / 100;
  return keep > 0 ? costUsd / keep : null;
}

/** What a sale leaves after costs. */
export function netAfterCosts(saleUsd: number, s: DealSettings): number {
  return saleUsd * (1 - s.costsPct / 100);
}

/** How far `price` sits above (+) or below (−) `reference`, in %. */
export function gapPct(price: number, reference: number): number {
  return ((price - reference) / reference) * 100;
}

export type Verdict = {
  tone: "good" | "caution" | "bad" | "info";
  headline: string;
  details: string[];
};

export type ExitRoute = {
  key: "dealer" | "retail" | "client";
  label: string;
  /** For sentences: "a dealer flip", "a UAE retail sale", "your client". */
  short: string;
  exitUsd: number;
  maxBuyUsd: number;
  /** Profit if we buy at the asking price and sell on this route. */
  profitUsd: number | null;
  fits: boolean | null;
};

export type BuyAnalysis = {
  exits: ExitRoute[];
  /** The price worth buying at: the best route's maximum. */
  targetUsd: number | null;
  verdict: Verdict;
};

type Fmt = (usd: number) => string;

function pct(n: number): string {
  return `${Math.abs(n).toFixed(1)}%`;
}

export function analyzeBuy(opts: {
  askingUsd: number | null;
  clientUsd: number | null;
  market: MarketLevels;
  settings: DealSettings;
  fmt: Fmt;
}): BuyAnalysis {
  const { askingUsd, clientUsd, market, settings, fmt } = opts;
  const route = (
    key: ExitRoute["key"],
    label: string,
    short: string,
    exitUsd: number | null,
  ): ExitRoute | null => {
    if (!exitUsd) return null;
    const maxBuyUsd = maxBuyPrice(exitUsd, settings);
    return {
      key,
      label,
      short,
      exitUsd,
      maxBuyUsd,
      profitUsd: askingUsd ? netAfterCosts(exitUsd, settings) - askingUsd : null,
      fits: askingUsd ? askingUsd <= maxBuyUsd : null,
    };
  };
  const exits = [
    route("dealer", "Quick flip to dealers (lowest dealer price)", "a dealer flip", market.dealerLow),
    route(
      "retail",
      market.retailUae ? "Retail in the UAE (lowest UAE on Chrono24)" : "Retail (lowest on Chrono24)",
      market.retailUae ? "a UAE retail sale" : "a retail sale",
      market.retailUae ?? market.retailLow,
    ),
    route("client", "Your client's price", "your client", clientUsd),
  ].filter((r): r is ExitRoute => r !== null);

  const primary =
    exits.find((r) => r.key === "client") ??
    exits.find((r) => r.key === "retail") ??
    exits.find((r) => r.key === "dealer");
  const dealer = exits.find((r) => r.key === "dealer");
  const targetUsd = primary ? Math.max(...exits.map((r) => r.maxBuyUsd)) : null;
  const target = `costs ${settings.costsPct}% + profit ${settings.profitPct}%`;

  if (!primary) {
    return {
      exits,
      targetUsd,
      verdict: {
        tone: "info",
        headline: "No market prices yet — run a check or wait for TimeDealer / Chrono24.",
        details: [],
      },
    };
  }
  const routeLines = exits.map(
    (r) =>
      `${r.label}: sell at ${fmt(r.exitUsd)} → pay at most ${fmt(r.maxBuyUsd)}` +
      (r.profitUsd !== null ? ` · profit at asking ${fmt(r.profitUsd)}` : ""),
  );
  if (!askingUsd) {
    return {
      exits,
      targetUsd,
      verdict: {
        tone: "info",
        headline: `Worth buying up to ${fmt(primary.maxBuyUsd)} for ${primary.short}, after ${target}.`,
        details: ["Enter the seller's asking price to check it.", ...routeLines],
      },
    };
  }

  const headroom = (r: ExitRoute) => pct(gapPct(r.maxBuyUsd, askingUsd));
  let verdict: Verdict;
  if (dealer?.fits) {
    verdict = {
      tone: "good",
      headline: `Worth buying — even a quick dealer flip clears ${target} (${headroom(dealer)} headroom).`,
      details: routeLines,
    };
  } else if (primary.fits) {
    verdict = {
      tone: primary.key === "client" ? "good" : "caution",
      headline: `Worth buying for ${primary.short} (${headroom(primary)} headroom) — a dealer flip would miss your target.`,
      details: routeLines,
    };
  } else {
    verdict = {
      tone: "bad",
      headline: `Too expensive — offer at most ${fmt(targetUsd!)}, ${pct(gapPct(targetUsd!, askingUsd))} below the asking price.`,
      details: routeLines,
    };
  }
  return { exits, targetUsd, verdict };
}

export type SellAnalysis = {
  dealerUsd: number | null;
  retailUsd: number | null;
  floorUsd: number | null;
  /** Profit if the client's offer is accepted (needs our cost). */
  profitUsd: number | null;
  verdict: Verdict;
};

export function analyzeSell(opts: {
  offerUsd: number | null;
  costUsd: number | null;
  market: MarketLevels;
  settings: DealSettings;
  fmt: Fmt;
}): SellAnalysis {
  const { offerUsd, costUsd, market, settings, fmt } = opts;
  const dealerUsd = market.dealerLow;
  const retailUsd = market.retailUae ?? market.retailLow;
  const floorUsd = costUsd ? minSellPrice(costUsd, settings) : null;
  const profitUsd =
    offerUsd && costUsd ? netAfterCosts(offerUsd, settings) - costUsd : null;
  const base = { dealerUsd, retailUsd, floorUsd, profitUsd };

  const lines = [
    dealerUsd ? `Quick sale to dealers: about ${fmt(dealerUsd)} (beat the cheapest dealer ask)` : null,
    retailUsd
      ? `Retail${market.retailUae ? " in the UAE" : ""}: up to ${fmt(retailUsd)} (the cheapest ${market.retailUae ? "UAE " : ""}Chrono24 listing)`
      : null,
    floorUsd
      ? `Your floor: ${fmt(floorUsd)} (cost + costs ${settings.costsPct}% + profit ${settings.profitPct}%)`
      : null,
    profitUsd !== null && costUsd
      ? `Profit at this offer after ${settings.costsPct}% costs: ${fmt(profitUsd)} (${(profitUsd / costUsd * 100).toFixed(1)}% on cost)`
      : null,
  ].filter((l): l is string => Boolean(l));

  if (!dealerUsd && !retailUsd && !floorUsd) {
    return {
      ...base,
      verdict: {
        tone: "info",
        headline: "No market prices yet — run a check or wait for TimeDealer / Chrono24.",
        details: lines,
      },
    };
  }
  if (!offerUsd) {
    const ask = Math.max(retailUsd ?? dealerUsd ?? 0, floorUsd ?? 0);
    return {
      ...base,
      verdict: {
        tone: "info",
        headline: `Ask around ${fmt(ask)}${floorUsd && floorUsd > (retailUsd ?? dealerUsd ?? 0) ? " — your floor is above the market, expect a slow sale" : ""}.`,
        details: ["Enter the client's offer to check it.", ...lines],
      },
    };
  }

  let verdict: Verdict;
  if (floorUsd && offerUsd < floorUsd) {
    const counter = Math.max(floorUsd, dealerUsd ?? 0);
    verdict = {
      tone: "bad",
      headline: `Below your floor by ${pct(gapPct(offerUsd, floorUsd))} — counter at ${fmt(counter)}.`,
      details: lines,
    };
  } else if (retailUsd && offerUsd >= retailUsd) {
    const gap = gapPct(offerUsd, retailUsd);
    verdict = {
      tone: "good",
      headline: `Strong offer — ${gap < 0.05 ? "matches" : `${pct(gap)} above`} the cheapest ${market.retailUae ? "UAE " : ""}retail listing.`,
      details: lines,
    };
  } else if (dealerUsd && offerUsd >= dealerUsd) {
    verdict = {
      tone: "good",
      headline: `Good offer — ${pct(gapPct(offerUsd, dealerUsd))} above the cheapest dealer price.`,
      details: lines,
    };
  } else if (dealerUsd) {
    verdict = {
      tone: "caution",
      headline: `${pct(gapPct(offerUsd, dealerUsd))} below the dealer market — counter at ${fmt(dealerUsd)}${floorUsd ? " (it does clear your floor)" : ""}.`,
      details: lines,
    };
  } else {
    verdict = {
      tone: "caution",
      headline: `${pct(gapPct(offerUsd, retailUsd!))} below the cheapest retail listing.`,
      details: lines,
    };
  }
  return { ...base, verdict };
}

/** Copy-paste lines for the report: market levels plus any deal checks. */
export function dealReportLines(opts: {
  market: MarketLevels;
  currency: DealCurrency;
  settings: DealSettings;
  buy?: { askingUsd: number | null; analysis: BuyAnalysis };
  sell?: { offerUsd: number | null; analysis: SellAnalysis };
}): string[] {
  const { market, currency, settings } = opts;
  const fmt = (usd: number | null) =>
    usd === null ? "—" : formatMoney(fromUsd(usd, currency), currency);
  const lines = [
    `Market (${currency}):`,
    `  dealers: low ${fmt(market.dealerLow)} · median ${fmt(market.dealerMedian)} · high ${fmt(market.dealerHigh)} (${market.dealerCount} listings, TimeDealer USD rate)`,
    `  retail: low ${fmt(market.retailLow)} · median ${fmt(market.retailMedian)} · lowest UAE ${fmt(market.retailUae)} (Chrono24, before shipping)`,
  ];
  const checks: string[] = [];
  if (opts.buy?.askingUsd) {
    checks.push(
      `  buy: asking ${fmt(opts.buy.askingUsd)} · worth buying up to ${fmt(opts.buy.analysis.targetUsd)} → ${opts.buy.analysis.verdict.headline}`,
    );
  }
  if (opts.sell?.offerUsd) {
    checks.push(
      `  sell: client offer ${fmt(opts.sell.offerUsd)} → ${opts.sell.analysis.verdict.headline}`,
    );
  }
  if (checks.length) {
    lines.push(
      `Deal check (costs ${settings.costsPct}% · profit ${settings.profitPct}%):`,
      ...checks,
    );
  }
  return lines;
}
