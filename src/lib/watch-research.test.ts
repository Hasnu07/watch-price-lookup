import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseChrono24Year, sanitizeApiError } from "./chrono24";
import { parseTimeDealerItems } from "./timedealer";
import {
  buildEmptyReport,
  buildYearPlan,
  chrono24SearchUrl,
  extractDialHint,
  formatReportText,
  groupQuotesByCurrency,
  normalizeReference,
  type B2BQuote,
} from "./watch-research";

function quote(patch: Partial<B2BQuote>): B2BQuote {
  return {
    id: Math.random().toString(36),
    reference: "7118/1200A-010",
    price: 100_000,
    currency: "HKD",
    usdPrice: null,
    releaseDate: "2025-03",
    postedAt: null,
    seller: null,
    sellerPhone: null,
    sellerAvatar: null,
    group: null,
    condition: null,
    color: null,
    note: null,
    image: null,
    verified: false,
    timesPosted: null,
    ...patch,
  };
}

describe("normalizeReference", () => {
  it("trims and uppercases", () => {
    assert.equal(normalizeReference(" 7118/1200a-010 "), "7118/1200A-010");
  });
});

describe("extractDialHint", () => {
  it("reads dial suffix", () => {
    assert.equal(extractDialHint("7118/1200A-010"), "010");
    assert.equal(extractDialHint("7118/1200A-011"), "011");
  });
});

describe("buildYearPlan", () => {
  it("for the current year checks it and the year before, and flags month", () => {
    const plan = buildYearPlan(2026, 3, 2026);
    assert.deepEqual(plan.yearsToCheck, [2026, 2025]);
    assert.equal(plan.monthMatters, true);
    assert.equal(plan.ourMonth, 3);
  });

  it("does not require a month for the current year", () => {
    const plan = buildYearPlan(2026, null, 2026);
    assert.deepEqual(plan.yearsToCheck, [2026, 2025]);
    assert.equal(plan.ourMonth, null);
    assert.ok(plan.rules.every((r) => !/enter the production month/i.test(r)));
  });

  it("for the previous two years checks those two only", () => {
    assert.deepEqual(buildYearPlan(2025, null, 2026).yearsToCheck, [2024, 2025]);
    assert.deepEqual(buildYearPlan(2024, null, 2026).yearsToCheck, [2024, 2025]);
    assert.equal(buildYearPlan(2025, null, 2026).monthMatters, false);
  });

  it("rolls forward with the calendar (2027)", () => {
    assert.deepEqual(buildYearPlan(2027, 1, 2027).yearsToCheck, [2027, 2026]);
    assert.equal(buildYearPlan(2027, 1, 2027).monthMatters, true);
    assert.deepEqual(buildYearPlan(2026, null, 2027).yearsToCheck, [2025, 2026]);
  });

  it("keeps a month given for older years", () => {
    assert.equal(buildYearPlan(2024, 7, 2026).ourMonth, 7);
  });
});

describe("chrono24SearchUrl", () => {
  it("uses Chrono24 year= checkbox param", () => {
    const url = chrono24SearchUrl({
      reference: "7118/1200A-010",
      year: 2024,
      sort: "lowest",
    });
    assert.match(url, /[?&]year=2024(?:&|$)/);
    assert.doesNotMatch(url, /yearManufactured/);
    assert.match(url, /sortorder=1/);
  });

  it("adds UAE countryIds", () => {
    const url = chrono24SearchUrl({
      reference: "7118/1200A-010",
      year: 2024,
      sort: "lowest",
      country: "AE",
    });
    assert.match(url, /countryIds=AE/);
  });
});

describe("parseChrono24Year", () => {
  it("parses exact and approximation years", () => {
    assert.deepEqual(parseChrono24Year("2024"), {
      year: 2024,
      approximate: false,
    });
    assert.deepEqual(parseChrono24Year("2025 (Approximation)"), {
      year: 2025,
      approximate: true,
    });
  });
});

describe("sanitizeApiError", () => {
  it("hides Cloudflare HTML bodies", () => {
    const msg = sanitizeApiError(
      524,
      "<!DOCTYPE html><html><body>Cloudflare</body></html>",
    );
    assert.match(msg, /timed out/i);
    assert.doesNotMatch(msg, /DOCTYPE/);
  });
});

describe("groupQuotesByCurrency", () => {
  it("puts HKD first, never mixes currencies, cheapest first", () => {
    const groups = groupQuotesByCurrency([
      quote({ currency: "USD", price: 190_000 }),
      quote({ currency: "HKD", price: 1_500_000 }),
      quote({ currency: "AED", price: 700_000 }),
      quote({ currency: "HKD", price: 1_450_000 }),
      quote({ currency: "USD", price: 185_000 }),
    ]);
    assert.deepEqual(
      groups.map((g) => [g.currency, g.low, g.high, g.quotes.length]),
      [
        ["HKD", 1_450_000, 1_500_000, 2],
        ["USD", 185_000, 190_000, 2],
        ["AED", 700_000, 700_000, 1],
      ],
    );
  });
});

describe("parseTimeDealerItems", () => {
  it("keeps seller details and filters by reference + year", () => {
    const quotes = parseTimeDealerItems(
      [
        {
          item_id: 1,
          ref: "7118/1200A-010",
          price: 1_480_000,
          currency: "hkd",
          usd_price: 189_500,
          release_date: "2025-04",
          posted_time: "2026-09-20T08:00:00Z",
          sender_name: "HK Time Ltd",
          sender_phone: "+852 9123 4567",
          condition: "New",
          color: "Blue",
          verification: 1,
          duplicate_count: 2,
          image: "https://img.example/1.jpg",
        },
        { item_id: 2, ref: "7118/1200A-010", price: 1_400_000, release_date: "2024-11" },
        { item_id: 3, ref: "7118/1200A-011", price: 1_300_000, release_date: "2025-01" },
        { item_id: 4, ref: "7118/1200A-010", price: 0, release_date: "2025-01" },
      ],
      { reference: "7118/1200A-010", year: 2025 },
    );
    assert.equal(quotes.length, 1);
    const [q] = quotes;
    assert.equal(q!.currency, "HKD");
    assert.equal(q!.seller, "HK Time Ltd");
    assert.equal(q!.sellerPhone, "+852 9123 4567");
    assert.equal(q!.verified, true);
    assert.equal(q!.timesPosted, 3);
    assert.equal(q!.usdPrice, 189_500);
    assert.equal(q!.postedAt, "2026-09-20T08:00:00.000Z");
  });
});

describe("formatReportText", () => {
  it("includes reference, years, and pending markers", () => {
    const report = buildEmptyReport({
      reference: "7118/1200A-010",
      year: 2025,
    });
    const text = formatReportText(report);
    assert.match(text, /7118\/1200A-010/);
    assert.match(text, /B2B:/);
    assert.match(text, /B2C:/);
    assert.match(text, /PENDING/);
  });

  it("lists several dealer quotes per currency with seller names, HKD kept in HKD", () => {
    const report = buildEmptyReport(
      { reference: "7118/1200A-010", year: 2026, month: 3 },
      2026,
    );
    report.b2b[0] = {
      ...report.b2b[0]!,
      status: "ok",
      totalFound: 5,
      quotes: [
        quote({ price: 1_450_000, seller: "Dealer A", group: "HK Group", releaseDate: "2026-03" }),
        quote({ price: 1_480_000, seller: "Dealer B", releaseDate: "2026-02" }),
        quote({ price: 1_500_000, seller: "Dealer C" }),
        quote({ price: 1_520_000, seller: "Dealer D" }),
        quote({ price: 185_000, currency: "USD", seller: "Dealer E" }),
      ],
    };
    const text = formatReportText(report);
    assert.match(text, /Year: 2026 \(March\)/);
    assert.match(text, /2026\/03: 5 dealer quotes/);
    assert.match(text, /HKD ×4: HK\$1,450,000 – HK\$1,520,000/);
    assert.match(text, /HK\$1,450,000 · Dealer A · HK Group · dated 2026-03/);
    assert.match(text, /Dealer C/);
    assert.doesNotMatch(text, /Dealer D/); // beyond the 3 listed per currency
    assert.match(text, /\+ 1 more/);
    assert.match(text, /USD ×1: \$185,000/);
  });
});
