import { NextResponse } from "next/server";
import {
  pickExtreme,
  searchChrono24ViaReef,
} from "@/lib/chrono24";
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

type Body = ResearchInput & {
  reefApiKey?: string;
  autoFetchB2C?: boolean;
  autoFetchB2B?: boolean;
};

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
    return NextResponse.json({ error: "Year must be between 1990 and 2035" }, { status: 400 });
  }

  const month =
    body.month === null || body.month === undefined || body.month === ("" as unknown)
      ? null
      : Number(body.month);

  if (month !== null && (!Number.isFinite(month) || month < 1 || month > 12)) {
    return NextResponse.json({ error: "Month must be 1–12" }, { status: 400 });
  }

  const report: ResearchReport = buildEmptyReport({
    reference,
    year,
    month,
    dial: body.dial,
  });

  const apiKey =
    (body.reefApiKey || process.env.REEF_API_KEY || process.env.REEF_KEY || "").trim();
  const shouldFetchB2C = Boolean(body.autoFetchB2C !== false && apiKey);
  const hasTimeDealerCreds = Boolean(
    (process.env.TIMEDEALER_PHONE || process.env.TIMEDEALER_USER) &&
      process.env.TIMEDEALER_PASSWORD,
  );
  const shouldFetchB2B = Boolean(body.autoFetchB2B !== false && hasTimeDealerCreds);

  report.feasibility.b2bAuto = shouldFetchB2B;
  report.feasibility.b2cAuto = shouldFetchB2C;
  report.feasibility.notes = [
    shouldFetchB2B
      ? "B2B: Auto-fetched from TimeDealer forsale feed. HKD quotes are kept in HKD — never converted."
      : "B2B: Add TIMEDEALER_PHONE + TIMEDEALER_PASSWORD in .env.local for auto dealer prices.",
    shouldFetchB2C
      ? "B2C: Auto-fetching Chrono24 via ReefAPI for lowest / highest world. Confirm lowest UAE on Chrono24."
      : "B2C: Add a ReefAPI key in Settings (or REEF_API_KEY in .env) for auto prices.",
  ];

  if (shouldFetchB2B) {
    const login = await loginTimeDealer();
    if (login.error || !login.cookie) {
      report.feasibility.b2bAuto = false;
      report.feasibility.notes[0] = `B2B: ${login.error || "TimeDealer login failed"}`;
    } else {
      await Promise.all(
        report.b2b.map(async (entry, index) => {
          const result = await searchTimeDealerForSale({
            cookie: login.cookie,
            reference: report.reference,
            year: entry.year,
            month: entry.month,
          });
          if (result.error) {
            report.b2b[index] = {
              ...entry,
              notes: result.error,
            };
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
            source: hit.groupName
              ? `timedealer / ${hit.groupName}`
              : "timedealer",
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
  }

  if (shouldFetchB2C) {
    for (const y of report.yearPlan.yearsToCheck) {
      const bucket = report.b2c.byYear[y];
      if (!bucket) continue;

      const [asc, desc] = await Promise.all([
        searchChrono24ViaReef({
          apiKey,
          query: report.reference,
          year: y,
          sort: "price_asc",
        }),
        searchChrono24ViaReef({
          apiKey,
          query: report.reference,
          year: y,
          sort: "price_desc",
        }),
      ]);

      if (asc.error) {
        bucket.lowestWorld.note = asc.error;
        bucket.lowestUae.note = asc.error;
      }
      if (desc.error) {
        bucket.highestWorld.note = desc.error;
      }

      const lowest = pickExtreme(asc.listings, "lowest");
      const highest = pickExtreme(
        desc.listings.length ? desc.listings : asc.listings,
        "highest",
      );

      bucket.lowestWorld.listing = lowest;
      bucket.highestWorld.listing = highest;
      bucket.lowestUae.listing = null;
      bucket.lowestUae.note =
        "Open the UAE Chrono24 link and enter the lowest AE listing — country filter is not available via the data API.";
    }
  }

  return NextResponse.json({ report });
}
