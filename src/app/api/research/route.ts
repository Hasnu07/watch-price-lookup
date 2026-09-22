import { NextResponse } from "next/server";
import { fetchChrono24VerifiedByYears } from "@/lib/chrono24";
import {
  loginTimeDealer,
  searchTimeDealerForSale,
} from "@/lib/timedealer";
import {
  buildEmptyReport,
  type ResearchInput,
  type ResearchReport,
} from "@/lib/watch-research";

export const runtime = "nodejs";
export const maxDuration = 60;

type Body = ResearchInput & {
  reefApiKey?: string;
  autoFetchB2C?: boolean;
  autoFetchB2B?: boolean;
};

async function fillB2B(report: ResearchReport): Promise<void> {
  const login = await loginTimeDealer();
  if (login.error || !login.cookie) {
    report.feasibility.b2bAuto = false;
    report.feasibility.notes[0] =
      `B2B: ${login.error || "TimeDealer login failed"}`;
    return;
  }

  await Promise.all(
    report.b2b.map(async (entry, index) => {
      const result = await searchTimeDealerForSale({
        cookie: login.cookie,
        reference: report.reference,
        year: entry.year,
        month: entry.month,
      });
      if (result.error) {
        report.b2b[index] = { ...entry, notes: result.error };
        return;
      }
      const hit = result.lowest;
      if (!hit) {
        report.b2b[index] = {
          ...entry,
          notes: `No forsale hits for ${entry.year} on TimeDealer`,
        };
        return;
      }
      report.b2b[index] = {
        ...entry,
        price: String(hit.price),
        currency: hit.currency,
        source: hit.groupName ? `timedealer / ${hit.groupName}` : "timedealer",
        notes: [
          hit.releaseDate ? `release ${hit.releaseDate}` : null,
          hit.senderName ? `dealer ${hit.senderName}` : null,
          result.listings.length > 1
            ? `${result.listings.length} forsale comps`
            : null,
        ]
          .filter(Boolean)
          .join(" · "),
      };
    }),
  );
}

async function fillB2C(report: ResearchReport, apiKey: string): Promise<void> {
  const verified = await fetchChrono24VerifiedByYears({
    apiKey,
    query: report.reference,
    years: report.yearPlan.yearsToCheck,
    detailLimit: 28,
  });

  if (verified.error) {
    report.feasibility.notes[1] = `B2C: ${verified.error}`;
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

  if (year === 2026 && month === null) {
    return NextResponse.json(
      { error: "Month is required for 2026 watches" },
      { status: 400 },
    );
  }

  if (month !== null && (!Number.isFinite(month) || month < 1 || month > 12)) {
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
  report.feasibility.notes = [
    shouldFetchB2B
      ? "B2B: Auto-fetched from TimeDealer forsale feed. HKD quotes are kept in HKD — never converted."
      : "B2B: Add TIMEDEALER_PHONE + TIMEDEALER_PASSWORD in .env.local for auto dealer prices.",
    shouldFetchB2C
      ? "B2C: Chrono24 prices are year-verified via listing details. Open links use Chrono24’s year= checkbox."
      : "B2C: Add a ReefAPI key in Settings (or REEF_API_KEY in .env) for auto prices.",
  ];

  // Run dealer + Chrono24 in parallel so one slow provider doesn't block the other.
  await Promise.all([
    shouldFetchB2B ? fillB2B(report) : Promise.resolve(),
    shouldFetchB2C ? fillB2C(report, apiKey) : Promise.resolve(),
  ]);

  return NextResponse.json({ report });
}
