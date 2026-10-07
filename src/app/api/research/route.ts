import { NextResponse } from "next/server";
import {
  fetchChrono24ByYears,
  type Chrono24Debug,
  type Chrono24Mode,
} from "@/lib/chrono24";
import { fetchTimeDealerQuotes } from "@/lib/timedealer";
import {
  MAX_YEAR_SPAN,
  buildEmptyReport,
  legacyYearRange,
  type ResearchReport,
} from "@/lib/watch-research";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Providers must finish inside this, leaving headroom under maxDuration. */
const PROVIDER_BUDGET_MS = 50_000;

type Body = {
  reference?: string;
  yearFrom?: number | string;
  yearTo?: number | string;
  /** Legacy single year: mapped to the team's original comparison rule. */
  year?: number | string;
  month?: number | string | null;
  dial?: string;
  reefApiKey?: string;
  autoFetchB2C?: boolean;
  autoFetchB2B?: boolean;
  /** Which Chrono24 half to fetch: the page asks for "prices" and "uae" separately. */
  chrono24?: Chrono24Mode;
  /** Include what ReefAPI returned (searches, listing years/countries). */
  debug?: boolean;
};

async function fillB2B(report: ResearchReport, deadline: number): Promise<void> {
  const result = await fetchTimeDealerQuotes({
    reference: report.reference,
    years: report.b2b.map((entry) => entry.year),
    deadline,
  });

  if (result.error) {
    report.feasibility.b2bNote = `B2B: ${result.error}`;
    report.b2b = report.b2b.map((entry) => ({
      ...entry,
      status: "error",
      note: "TimeDealer login failed",
    }));
    return;
  }

  report.b2b = report.b2b.map((entry) => {
    const found = result.byYear[entry.year];
    if (!found) return entry;
    if (found.error) return { ...entry, status: "error", note: found.error };
    if (!found.quotes.length) {
      return {
        ...entry,
        status: "empty",
        note: `no forsale quotes for ${entry.year} on TimeDealer (last 90 days)`,
      };
    }
    return {
      ...entry,
      status: "ok",
      quotes: found.quotes,
      totalFound: found.totalFound,
      dealerCount: found.dealerCount,
      sampleUsd: found.sampleUsd,
      moreAvailable: found.moreAvailable,
    };
  });
}

async function fillB2C(
  report: ResearchReport,
  apiKey: string,
  deadline: number,
  mode: Chrono24Mode,
  debug: boolean,
): Promise<void> {
  const trace: Chrono24Debug | undefined = debug ? {} : undefined;
  const market = await fetchChrono24ByYears({
    apiKey,
    query: report.reference,
    years: report.yearPlan.yearsToCheck,
    mode,
    deadline,
    debug: trace,
  });
  if (trace) report.debug = { chrono24: trace };

  for (const y of report.yearPlan.yearsToCheck) {
    const bucket = report.b2c.byYear[y];
    const slice = market.byYear[y];
    if (!bucket || !slice) continue;
    if (mode !== "uae") {
      bucket.lowestWorld.listing = slice.lowestWorld;
      bucket.highestWorld.listing = slice.highestWorld;
      bucket.lowestWorld.note = slice.note;
      bucket.highestWorld.note = slice.note;
      bucket.retail = { total: slice.total, sampleUsd: slice.sampleUsd };
    }
    if (mode !== "prices") {
      bucket.lowestUae.listing = slice.lowestUae;
      bucket.lowestUae.note = slice.uaeNote;
    }
  }
}

export async function POST(req: Request) {
  const deadline = Date.now() + PROVIDER_BUDGET_MS;

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const reference = (body.reference ?? "").trim();
  if (!reference) {
    return NextResponse.json({ error: "Reference is required" }, { status: 400 });
  }
  const range =
    body.yearFrom !== undefined || body.yearTo !== undefined
      ? {
          yearFrom: Number(body.yearFrom ?? body.yearTo),
          yearTo: Number(body.yearTo ?? body.yearFrom),
        }
      : legacyYearRange(Number(body.year));
  const { yearFrom, yearTo } = range;
  const validYear = (y: number) => Number.isInteger(y) && y >= 1990 && y <= 2035;
  if (!validYear(yearFrom) || !validYear(yearTo)) {
    return NextResponse.json(
      { error: "Years must be between 1990 and 2035" },
      { status: 400 },
    );
  }
  if (yearFrom > yearTo) {
    return NextResponse.json(
      { error: "\"Year from\" must not be after \"Year to\"" },
      { status: 400 },
    );
  }
  if (yearTo - yearFrom + 1 > MAX_YEAR_SPAN) {
    return NextResponse.json(
      { error: `Pick at most ${MAX_YEAR_SPAN} years at once` },
      { status: 400 },
    );
  }

  const month =
    body.month === null ||
    body.month === undefined ||
    body.month === ("" as unknown)
      ? null
      : Number(body.month);

  if (month !== null && (!Number.isInteger(month) || month < 1 || month > 12)) {
    return NextResponse.json({ error: "Month must be 1–12" }, { status: 400 });
  }

  const report: ResearchReport = buildEmptyReport({
    reference,
    yearFrom,
    yearTo,
    month,
    dial: body.dial,
  });

  const apiKey = (
    body.reefApiKey ||
    process.env.REEF_API_KEY ||
    process.env.REEF_KEY ||
    ""
  ).trim();
  const shouldFetchB2C = Boolean(body.autoFetchB2C !== false && apiKey);
  const hasTimeDealerCreds = Boolean(
    (process.env.TIMEDEALER_PHONE || process.env.TIMEDEALER_USER) &&
      process.env.TIMEDEALER_PASSWORD,
  );
  const shouldFetchB2B = Boolean(
    body.autoFetchB2B !== false && hasTimeDealerCreds,
  );

  report.feasibility.b2bAuto = shouldFetchB2B;
  report.feasibility.b2cAuto = shouldFetchB2C;
  report.feasibility.b2bNote = shouldFetchB2B
    ? "B2B: Dealer quotes from the TimeDealer forsale feed (last 90 days), cheapest first per currency. HKD quotes stay in HKD — never converted."
    : hasTimeDealerCreds
      ? "B2B: Skipped for this run (dealer feed available)."
      : "B2B: Add TIMEDEALER_PHONE + TIMEDEALER_PASSWORD in .env.local for dealer quotes.";
  report.feasibility.b2cNote = shouldFetchB2C
    ? "B2C: Chrono24 listing prices (before shipping) from Chrono24's year search — the same list as the Open Chrono24 links. Lowest UAE is found by opening the cheapest listings."
    : "B2C: Add a ReefAPI key in Settings (or REEF_API_KEY in .env) for auto prices.";

  if (!shouldFetchB2B) {
    const note = hasTimeDealerCreds ? "skipped this run" : "TimeDealer not connected";
    report.b2b = report.b2b.map((entry) => ({ ...entry, note }));
  }

  // Run dealer + Chrono24 in parallel so one slow provider doesn't block the other.
  await Promise.all([
    shouldFetchB2B ? fillB2B(report, deadline) : Promise.resolve(),
    shouldFetchB2C
      ? fillB2C(
          report,
          apiKey,
          deadline,
          body.chrono24 === "prices" || body.chrono24 === "uae" ? body.chrono24 : "all",
          body.debug === true,
        )
      : Promise.resolve(),
  ]);

  return NextResponse.json({ report });
}
