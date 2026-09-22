import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseChrono24Year, sanitizeApiError } from "./chrono24";
import {
  buildEmptyReport,
  buildYearPlan,
  chrono24SearchUrl,
  extractDialHint,
  formatReportText,
  normalizeReference,
} from "./watch-research";

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
  it("for 2026 checks 2026 and 2025 and flags month", () => {
    const plan = buildYearPlan(2026, 3);
    assert.deepEqual(plan.yearsToCheck, [2026, 2025]);
    assert.equal(plan.monthMatters, true);
    assert.equal(plan.ourMonth, 3);
  });

  it("for 2025 checks 2024 and 2025 only", () => {
    const plan = buildYearPlan(2025);
    assert.deepEqual(plan.yearsToCheck, [2024, 2025]);
    assert.equal(plan.monthMatters, false);
  });

  it("for 2024 checks 2024 and 2025 only", () => {
    const plan = buildYearPlan(2024);
    assert.deepEqual(plan.yearsToCheck, [2024, 2025]);
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
});
