import { NextResponse } from "next/server";
import {
  pickExtreme,
  searchChrono24ViaReef,
} from "@/lib/chrono24";
import {
  buildEmptyReport,
  type ResearchInput,
  type ResearchReport,
} from "@/lib/watch-research";

export const runtime = "nodejs";

type Body = ResearchInput & {
  reefApiKey?: string;
  autoFetchB2C?: boolean;
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
  const shouldFetch = Boolean(body.autoFetchB2C !== false && apiKey);

  report.feasibility.b2bAuto = false;
  report.feasibility.b2cAuto = shouldFetch;
  report.feasibility.notes = [
    "B2B: TimeDealer and dealer groups need your login. Enter prices yourself; quote HKD exactly — never convert.",
    shouldFetch
      ? "B2C: Auto-fetching Chrono24 via ReefAPI for lowest / highest world. UAE filter is approximate — verify seller country on Chrono24."
      : "B2C: Add a ReefAPI key in Settings (or REEF_API_KEY in .env) for auto prices. Until then, use the Chrono24 links and fill in manually.",
  ];

  if (shouldFetch) {
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
      const highest = pickExtreme(desc.listings.length ? desc.listings : asc.listings, "highest");

      bucket.lowestWorld.listing = lowest;
      bucket.highestWorld.listing = highest;

      // ReefAPI search has no reliable country filter in the public schema.
      // We keep UAE as a dedicated Chrono24 deep-link for the team to verify.
      bucket.lowestUae.listing = null;
      bucket.lowestUae.note =
        "Open the UAE Chrono24 link and enter the lowest AE listing — country filter is not available via the data API.";
    }
  }

  return NextResponse.json({ report });
}
