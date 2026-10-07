import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  analyzeBuy,
  analyzeSell,
  dealReportLines,
  fromUsd,
  marketLevels,
  maxBuyPrice,
  minSellPrice,
  parseAmount,
  parsePercent,
  toUsd,
  type MarketLevels,
} from "./deal";
import { buildEmptyReport } from "./watch-research";

const settings = { costsPct: 2, profitPct: 5 };
const fmt = (usd: number) => `$${Math.round(usd).toLocaleString("en-US")}`;
const market: MarketLevels = {
  dealerLow: 100_000,
  dealerMedian: 104_000,
  dealerHigh: 112_000,
  dealerCount: 30,
  retailLow: 108_000,
  retailMedian: 115_000,
  retailHigh: 127_400,
  retailUae: 110_000,
  retailCount: 12,
};

describe("currency + parsing", () => {
  it("converts pegged currencies", () => {
    assert.equal(toUsd(780_000, "HKD"), 100_000);
    assert.equal(Math.round(toUsd(367_250, "aed")!), 100_000);
    assert.equal(toUsd(1_000, "EUR"), null);
    assert.equal(fromUsd(100_000, "HKD"), 780_000);
  });

  it("parses typed amounts and percents", () => {
    assert.equal(parseAmount("1,450,000"), 1_450_000);
    assert.equal(parseAmount(" "), null);
    assert.equal(parseAmount("abc"), null);
    assert.equal(parsePercent("2.5", 0), 2.5);
    assert.equal(parsePercent("", 5), 5);
    assert.equal(parsePercent("500", 5), 90);
  });
});

describe("buy / sell limits", () => {
  it("max buy keeps costs + profit off the resale price, min sell is its inverse", () => {
    assert.equal(maxBuyPrice(100_000, settings), 93_000);
    assert.equal(Math.round(minSellPrice(93_000, settings)!), 100_000);
    assert.equal(minSellPrice(1, { costsPct: 60, profitPct: 40 }), null);
  });
});

describe("marketLevels", () => {
  it("combines every year: dealer samples, Chrono24 lows/highs/UAE and retail samples", () => {
    const report = buildEmptyReport({ reference: "7010/1G", yearFrom: 2025, yearTo: 2026 }, 2026);
    report.b2b[0]!.sampleUsd = [101_000, 104_000, 109_000];
    report.b2b[1]!.sampleUsd = [98_000, 100_000];
    const listing = (price: number, currency = "USD") => ({
      id: String(price),
      title: "",
      price,
      currency,
      url: "",
    });
    report.b2c.byYear[2026]!.lowestWorld.listing = listing(101_000);
    report.b2c.byYear[2026]!.highestWorld.listing = listing(127_400);
    report.b2c.byYear[2026]!.lowestUae.listing = listing(101_000);
    report.b2c.byYear[2025]!.lowestWorld.listing = listing(98_584);
    report.b2c.byYear[2025]!.lowestUae.listing = listing(367_250, "AED");
    report.b2c.byYear[2026]!.retail = { total: 12, sampleUsd: [101_000, 102_087, 127_400] };
    report.b2c.byYear[2025]!.retail = { total: 21, sampleUsd: [98_584, 100_000] };

    const m = marketLevels(report);
    assert.equal(m.dealerLow, 98_000);
    assert.equal(m.dealerMedian, 101_000);
    assert.equal(m.dealerHigh, 109_000);
    assert.equal(m.dealerCount, 5);
    assert.equal(m.retailLow, 98_584);
    assert.equal(m.retailHigh, 127_400);
    assert.equal(Math.round(m.retailUae!), 100_000); // AED manual entry converted
    assert.equal(m.retailMedian, 101_000);
    assert.equal(m.retailCount, 33);
  });
});

describe("analyzeBuy", () => {
  const buy = (askingUsd: number | null, clientUsd: number | null = null) =>
    analyzeBuy({ askingUsd, clientUsd, market, settings, fmt });

  it("without an asking price, says what is worth paying", () => {
    const r = buy(null);
    assert.equal(r.verdict.tone, "info");
    assert.equal(r.targetUsd, 102_300); // retail UAE 110k − 7%
    assert.match(r.verdict.headline, /up to \$102,300/);
  });

  it("is a good buy when even a dealer flip clears the target", () => {
    const r = buy(90_000);
    assert.equal(r.verdict.tone, "good");
    assert.match(r.verdict.headline, /dealer flip/);
    assert.equal(r.exits.find((e) => e.key === "dealer")!.profitUsd, 8_000);
  });

  it("is a retail-only buy between the dealer and retail limits", () => {
    assert.equal(buy(98_000).verdict.tone, "caution");
    assert.equal(buy(98_000, 120_000).verdict.tone, "good"); // pre-sold to a client
  });

  it("says how much to offer when too expensive", () => {
    const r = buy(105_000);
    assert.equal(r.verdict.tone, "bad");
    assert.match(r.verdict.headline, /offer at most \$102,300, 2\.6% below/);
  });
});

describe("analyzeSell", () => {
  const sell = (offerUsd: number | null, costUsd: number | null = null) =>
    analyzeSell({ offerUsd, costUsd, market, settings, fmt });

  it("rates the client's offer against retail and dealer prices", () => {
    assert.match(sell(115_000).verdict.headline, /Strong offer/);
    assert.match(sell(104_000).verdict.headline, /Good offer — 4\.0% above/);
    const low = sell(95_000).verdict;
    assert.equal(low.tone, "caution");
    assert.match(low.headline, /5\.0% below the dealer market — counter at \$100,000/);
  });

  it("uses our cost for a floor and the profit", () => {
    const r = sell(104_000, 100_000);
    assert.equal(Math.round(r.floorUsd!), 107_527);
    assert.equal(r.verdict.tone, "bad");
    assert.match(r.verdict.headline, /counter at \$107,527/);
    assert.equal(sell(115_000, 100_000).profitUsd, 12_700);
  });
});

describe("dealReportLines", () => {
  it("adds market levels always and deal checks only when prices are entered", () => {
    const buyAnalysis = analyzeBuy({ askingUsd: 90_000, clientUsd: null, market, settings, fmt });
    const sellAnalysis = analyzeSell({ offerUsd: null, costUsd: null, market, settings, fmt });
    const lines = dealReportLines({
      market,
      currency: "HKD",
      settings,
      buy: { askingUsd: 90_000, analysis: buyAnalysis },
      sell: { offerUsd: null, analysis: sellAnalysis },
    }).join("\n");
    assert.match(lines, /Market \(HKD\):/);
    assert.match(lines, /dealers: low HK\$780,000/);
    assert.match(lines, /buy: asking HK\$702,000/);
    assert.doesNotMatch(lines, /sell:/);
  });
});
