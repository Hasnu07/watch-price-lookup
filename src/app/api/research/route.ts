import { NextResponse } from "next/server";
import { fetchChrono24VerifiedByYears } from "@/lib/chrono24";
import { fetchTimeDealerQuotes } from "@/lib/timedealer";
import {
  buildEmptyReport,
  type ResearchInput,
  type ResearchReport,
} from "@/lib/watch-research";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Providers must finish inside this, leaving headroom under maxDuration. */
const PROVIDER_BUDGET_MS = 50_000;

type Body = ResearchInput & {
  reefApiKey?: string;
  autoFetchB2C?: boolean;
  autoFetchB2B?: boolean;
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
    };
  });
}

async function fillB2C(
  report: ResearchReport,
  apiKey: string,
  deadline: number,
): Promise<void> {
  const verified = await fetchChrono24VerifiedByYears({
    apiKey,
    query: report.reference,
    years: report.yearPlan.yearsToCheck,
    deadline,
    detailLimit: 28,
  });

  if (verified.error) {
    report.feasibility.b2cNote = `B2C: ${verified.error}`;
  }

  for (const y of report.yearPlan.yearsToCheck) {
    const bucket = report.b2c.byYear[y];
    const slice = verified.byYear[y];
    if (!bucket || !slice) continue;

    bucket.lowestWorld.listing = slice.lowestWorld;
    bucket.highestWorld.listing = slice.highestWorld;
    bucket.lowestUae.listing = slice.lowestUae;

    const yearNote =
      slice.note ||
      (slice.verifiedCount
        ? `Verified ${slice.verifiedCount} Chrono24 listing(s) for year ${y}.`
        : undefined);
    if (yearNote) {
      bucket.lowestWorld.note = yearNote;
      bucket.highestWorld.note = yearNote;
    }
    if (!slice.lowestUae) {
      bucket.lowestUae.note =
        slice.verifiedCount > 0
          ? `No UAE seller found among year-${y} verified listings — open the UAE Chrono24 link to confirm.`
          : yearNote ||
            `No year-${y} listings verified — open the Chrono24 year filter link.`;
    } else {
      bucket.lowestUae.note = `UAE seller · year ${slice.lowestUae.year || y}`;
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
  const year = Number(body.year);
  if (!reference) {
    return NextResponse.json({ error: "Reference is required" }, { status: 400 });
  }
  if (!Number.isFinite(year) || year < 1990 || year > 2035) {
    return NextResponse.json(
      { error: "Year must be between 1990 and 2035" },
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
    year,
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
    ? "B2C: Chrono24 listing prices (before shipping), year-verified via details. Compare to the Chrono24 card price — not + shipping."
    : "B2C: Add a ReefAPI key in Settings (or REEF_API_KEY in .env) for auto prices.";

  if (!shouldFetchB2B) {
    const note = hasTimeDealerCreds ? "skipped this run" : "TimeDealer not connected";
    report.b2b = report.b2b.map((entry) => ({ ...entry, note }));
  }

  // Run dealer + Chrono24 in parallel so one slow provider doesn't block the other.
  await Promise.all([
    shouldFetchB2B ? fillB2B(report, deadline) : Promise.resolve(),
    shouldFetchB2C ? fillB2C(report, apiKey, deadline) : Promise.resolve(),
  ]);

  return NextResponse.json({ report });
}
