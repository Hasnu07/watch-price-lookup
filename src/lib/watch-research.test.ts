import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseChrono24Year, sanitizeApiError, yearPricesFromSearch } from "./chrono24";
import { parseTimeDealerItems } from "./timedealer";
import {
  buildEmptyReport,
  buildYearPlan,
  chrono24SearchUrl,
  dropPriceOutliers,
  extractDialHint,
  formatReportText,
  legacyYearRange,
  normalizeReference,
  pickDisplayQuotes,
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
  it("checks every year in the range, newest first", () => {
    const plan = buildYearPlan(2022, 2026, null, 2026);
    assert.deepEqual(plan.yearsToCheck, [2026, 2025, 2024, 2023, 2022]);
    assert.equal(plan.yearFrom, 2022);
    assert.equal(plan.yearTo, 2026);
  });

  it("swaps a reversed range and handles a single year", () => {
    assert.deepEqual(buildYearPlan(2026, 2025, null, 2026).yearsToCheck, [2026, 2025]);
    assert.deepEqual(buildYearPlan(2024, 2024, null, 2026).yearsToCheck, [2024]);
  });

  it("flags month freshness only when the range reaches the current year", () => {
    const plan = buildYearPlan(2025, 2026, 3, 2026);
    assert.equal(plan.monthMatters, true);
    assert.equal(plan.ourMonth, 3);
    assert.ok(plan.rules.some((r) => /Target month: March 2026/.test(r)));
    assert.equal(buildYearPlan(2023, 2024, null, 2026).monthMatters, false);
  });
});

describe("legacyYearRange", () => {
  it("maps old ?year= links to the original comparison rule", () => {
    assert.deepEqual(legacyYearRange(2026, 2026), { yearFrom: 2025, yearTo: 2026 });
    assert.deepEqual(legacyYearRange(2025, 2026), { yearFrom: 2024, yearTo: 2025 });
    assert.deepEqual(legacyYearRange(2024, 2026), { yearFrom: 2024, yearTo: 2025 });
    assert.deepEqual(legacyYearRange(2019, 2026), { yearFrom: 2018, yearTo: 2019 });
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

describe("yearPricesFromSearch", () => {
  // Live "7010/1G 2026" search, 2026-09-28: same 12 listings as Chrono24's year filter.
  const listing = (price: number) => ({
    id: String(price),
    title: "Patek Philippe Nautilus 7010/1G",
    price,
    currency: "USD",
    url: "https://www.chrono24.com/",
  });
  const prices = [101_000, 102_087, 102_646, 103_263, 106_922, 107_794, 109_394, 127_400];
  const ok = (ps: number[], total: number | null = 12) => ({
    listings: ps.map(listing),
    total,
  });
  const blocked = {
    listings: [],
    total: null,
    error: "Chrono24 did not serve the page (status 403)",
  };

  it("takes the lowest from the cheapest-first search and the highest from the priciest-first", () => {
    const r = yearPricesFromSearch(ok(prices), ok([...prices].reverse()));
    assert.equal(r.lowest?.price, 101_000);
    assert.equal(r.highest?.price, 127_400);
    assert.equal(r.total, 12);
    assert.equal(r.error, undefined);
  });

  it("still gets the lowest when the cheapest-first search is blocked but the other holds every result", () => {
    const r = yearPricesFromSearch(blocked, ok([...prices].reverse(), prices.length));
    assert.equal(r.lowest?.price, 101_000);
    assert.equal(r.error, undefined);
  });

  it("says so when the cheapest-first search is blocked and the other page is partial", () => {
    const r = yearPricesFromSearch(blocked, ok([127_400, 110_000], 80));
    assert.equal(r.lowest, null);
    assert.equal(r.highest?.price, 127_400);
    assert.match(r.error ?? "", /cheapest-first search/);
  });
});

describe("pickDisplayQuotes", () => {
  it("shows at most 10: the 9 cheapest plus the highest, ranked across currencies", () => {
    const quotes = Array.from({ length: 14 }, (_, i) =>
      quote({ id: `q${i}`, price: 100_000 + i * 1_000, usdPrice: 12_800 + i * 128 }),
    );
    quotes.push(quote({ id: "usd", currency: "USD", price: 12_000, usdPrice: 12_000 }));
    const shown = pickDisplayQuotes(quotes);
    assert.equal(shown.length, 10);
    assert.equal(shown[0]!.id, "usd"); // cheapest by USD value, still shown in USD
    assert.equal(shown[8]!.id, "q7");
    assert.equal(shown[9]!.id, "q13"); // the highest is always there
  });

  it("returns everything when there are 10 or fewer", () => {
    assert.equal(pickDisplayQuotes([quote({}), quote({})]).length, 2);
  });
});

describe("dropPriceOutliers", () => {
  it("drops extra-zero typos so they cannot become the highest", () => {
    const normal = [103_000, 105_000, 108_000, 112_000, 117_000].map((p) =>
      quote({ price: p, usdPrice: p / 7.8 }),
    );
    const typo = quote({ id: "typo", price: 1_030_000, usdPrice: 1_030_000 / 7.8 });
    const kept = dropPriceOutliers([...normal, typo]);
    assert.equal(kept.length, 5);
    assert.ok(kept.every((q) => q.id !== "typo"));
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

describe("parseTimeDealerItems reposts + currency", () => {
  // Pattern seen live for 126610LN: one dealer posting the same HKD 103,000
  // watch many times, some posts mis-tagged USD (usd_price shows it is HKD).
  const post = (id: number, extra: Record<string, unknown>) => ({
    item_id: id,
    ref: "126610LN-0001",
    price: 103_000,
    currency: "HKD",
    usd_price: 13_143,
    release_date: "2024-08",
    sender_name: "lucky",
    sender_phone: "85291592153",
    condition: "used",
    posted_time: `2026-07-0${id}T10:00:00Z`,
    ...extra,
  });

  it("relabels USD-tagged HKD prices and merges reposts into one quote", () => {
    const quotes = parseTimeDealerItems(
      [
        post(1, {}),
        post(2, { currency: "USD", usd_price: 13_205 }),
        post(3, { release_date: "2024", duplicate_count: 2 }),
        post(4, { price: 112_000, usd_price: 14_330 }),
        post(5, { sender_phone: "85290000000", sender_name: "Ryan" }),
        post(6, { currency: "USD", price: 13_500, usd_price: 13_500, sender_phone: "1555" }),
      ],
      { reference: "126610LN", year: 2024 },
    );
    const summary = quotes.map(
      (q) => `${q.seller} ${q.currency} ${q.price} ×${q.timesPosted ?? 1}`,
    );
    assert.deepEqual(summary, [
      "lucky HKD 103000 ×5", // posts 1, 2 (was USD), 3 (counted 3×)
      "Ryan HKD 103000 ×1",
      "lucky USD 13500 ×1", // genuine USD quote stays USD, ranked by USD value
      "lucky HKD 112000 ×1",
    ]);
    const merged = quotes[0]!;
    assert.equal(merged.releaseDate, "2024-08"); // keeps the more specific date
    assert.equal(merged.postedAt, "2026-07-03T10:00:00.000Z"); // latest post
  });
});

describe("formatReportText", () => {
  it("includes reference, years, and pending markers", () => {
    const report = buildEmptyReport({
      reference: "7118/1200A-010",
      yearFrom: 2024,
      yearTo: 2025,
    });
    const text = formatReportText(report);
    assert.match(text, /7118\/1200A-010/);
    assert.match(text, /B2B:/);
    assert.match(text, /B2C:/);
    assert.match(text, /PENDING/);
  });

  it("lists the 3 lowest and the highest dealer quotes with sellers, HKD kept in HKD", () => {
    const report = buildEmptyReport(
      { reference: "7118/1200A-010", yearFrom: 2025, yearTo: 2026, month: 3 },
      2026,
    );
    report.b2b[0] = {
      ...report.b2b[0]!,
      status: "ok",
      totalFound: 24,
      dealerCount: 17,
      quotes: [
        quote({ price: 1_500_000, usdPrice: 192_300, seller: "Dealer C" }),
        quote({
          price: 1_450_000,
          usdPrice: 185_900,
          seller: "Dealer A",
          group: "HK Group",
          releaseDate: "2026-03",
        }),
        quote({ price: 1_520_000, usdPrice: 194_900, seller: "Dealer D" }),
        quote({ price: 1_480_000, usdPrice: 189_700, seller: "Dealer B", releaseDate: "2026-02" }),
        quote({ price: 1_690_000, usdPrice: 216_700, seller: "Dealer Z" }),
      ],
    };
    const text = formatReportText(report);
    assert.match(text, /Years: 2025–2026 \(March 2026\)/);
    assert.match(text, /2026\/03: 24 listings from 17 dealers/);
    assert.match(text, /lowest: +HK\$1,450,000 · Dealer A · HK Group · dated 2026-03/);
    assert.match(text, /#2: +HK\$1,480,000 · Dealer B/);
    assert.match(text, /#3: +HK\$1,500,000 · Dealer C/);
    assert.doesNotMatch(text, /Dealer D/);
    assert.match(text, /highest: +HK\$1,690,000 · Dealer Z/);
  });
});
