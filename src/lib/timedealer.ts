import CryptoJS from "crypto-js";
import { fetchWithTimeout, isAbortError, timeLeft } from "@/lib/http";
import {
  dropPriceOutliers,
  pickDisplayQuotes,
  sortQuotes,
  type B2BQuote,
} from "@/lib/watch-research";

const SECRET = "jgoteam@2024";
const API_BASE = "https://timedealer.io/api";
const DEFAULT_DEVICE_ID = "watch-price-research-device";
/** Reuse one login instead of logging in (with force_login) on every search. */
const SESSION_TTL_MS = 2 * 60 * 60 * 1000;
/** The feed returns at most this many posts per page. */
const FEED_PAGE_SIZE = 100;

export type TimeDealerYearResult = {
  /** Up to MAX_B2B_CARDS: the cheapest plus the highest. */
  quotes: B2BQuote[];
  totalFound: number;
  dealerCount: number;
  /** The feed has posts between the cheapest and priciest pages we read. */
  moreAvailable?: boolean;
  error?: string;
  /** Session looked expired/invalid — caller should re-login and retry. */
  authFailed?: boolean;
};

export type TimeDealerQuotes = {
  byYear: Record<number, TimeDealerYearResult>;
  error?: string;
};

function encryptPayload(payload: unknown): string {
  return CryptoJS.AES.encrypt(
    JSON.stringify({ data: JSON.stringify(payload), stime: Date.now() }),
    SECRET,
  ).toString();
}

function normalizePhone(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith("+")) return trimmed;
  // Pakistani local format 03xxxxxxxxx → +92…
  if (/^03\d{9}$/.test(trimmed)) return `+92${trimmed.slice(1)}`;
  if (/^923\d{9}$/.test(trimmed)) return `+${trimmed}`;
  return trimmed;
}

function cookieJarFromResponse(res: Response): string {
  const getSetCookie = (
    res.headers as Headers & { getSetCookie?: () => string[] }
  ).getSetCookie?.();
  if (getSetCookie?.length) {
    return getSetCookie.map((c) => c.split(";")[0]!).join("; ");
  }
  const single = res.headers.get("set-cookie");
  if (!single) return "";
  // Fallback: take first pair only
  return single.split("," ).map((part) => part.trim().split(";")[0]!).join("; ");
}

export async function loginTimeDealer(opts: {
  deadline: number;
  phone?: string;
  password?: string;
  deviceId?: string;
}): Promise<{ cookie: string; error?: string }> {
  const phone = normalizePhone(
    opts.phone ||
      process.env.TIMEDEALER_PHONE ||
      process.env.TIMEDEALER_USER ||
      "",
  );
  const password =
    opts.password || process.env.TIMEDEALER_PASSWORD || "";
  const deviceId =
    opts.deviceId || process.env.TIMEDEALER_DEVICE_ID || DEFAULT_DEVICE_ID;

  if (!phone || !password) {
    return {
      cookie: "",
      error:
        "TimeDealer credentials missing. Set TIMEDEALER_PHONE and TIMEDEALER_PASSWORD in .env.local.",
    };
  }

  const budget = Math.min(15_000, timeLeft(opts.deadline) - 500);
  if (budget < 2_000) {
    return { cookie: "", error: "TimeDealer login skipped — out of time" };
  }

  const payload = {
    identifier: phone,
    password,
    deviceId,
    country: "PK",
    ip_address: "1.1.1.1",
    force_login: true,
    deviceType: "Desktop",
    deviceName: "WatchPriceResearch",
    os: "Linux",
    osVersion: "unknown",
  };

  try {
    const res = await fetchWithTimeout(
      `${API_BASE}/login`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
          "user-agent": "WatchPriceResearch/1.0",
        },
        body: JSON.stringify(encryptPayload(payload)),
      },
      budget,
    );
    const json = (await res.json()) as {
      code?: string;
      message?: string;
    };
    if (!res.ok || String(json.code) !== "200") {
      return {
        cookie: "",
        error: `TimeDealer login failed: ${json.message || res.status}`,
      };
    }
    const cookie = cookieJarFromResponse(res);
    if (!cookie.includes("access-token=")) {
      return { cookie: "", error: "TimeDealer login ok but no access-token cookie" };
    }
    return { cookie };
  } catch (e) {
    return {
      cookie: "",
      error: isAbortError(e)
        ? "TimeDealer login timed out"
        : e instanceof Error
          ? e.message
          : "TimeDealer login network error",
    };
  }
}

let cachedSession: { cookie: string; expiresAt: number } | null = null;
let loginInFlight: Promise<{ cookie: string; error?: string }> | null = null;

async function getSession(
  deadline: number,
  refresh = false,
): Promise<{ cookie: string; error?: string }> {
  if (refresh) cachedSession = null;
  if (cachedSession && cachedSession.expiresAt > Date.now()) {
    return { cookie: cachedSession.cookie };
  }
  // Concurrent searches share one login.
  loginInFlight ??= loginTimeDealer({ deadline })
    .then((result) => {
      if (result.cookie) {
        cachedSession = {
          cookie: result.cookie,
          expiresAt: Date.now() + SESSION_TTL_MS,
        };
      }
      return result;
    })
    .finally(() => {
      loginInFlight = null;
    });
  return loginInFlight;
}

type RawItem = {
  item_id?: string | number;
  ref?: string;
  price?: number | string | null;
  r_price?: number | string | null;
  amount?: number | string | null;
  usd_price?: number | string | null;
  currency?: string | null;
  release_date?: string | null;
  posted_time?: string | number | null;
  group_name?: string | null;
  note?: string | null;
  sender_name?: string | null;
  sender_phone?: string | null;
  sender_avt?: string | null;
  condition?: string | null;
  color?: string | null;
  image?: string | null;
  verification?: number | string | null;
  duplicate_count?: number | string | null;
};

function text(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  return s ? s : null;
}

function httpUrl(value: unknown): string | null {
  const s = text(value);
  return s && /^https?:\/\//i.test(s) ? s : null;
}

function toIsoTime(value: string | number | null | undefined): string | null {
  if (value === null || value === undefined || value === "") return null;
  let ms: number;
  if (typeof value === "number" || /^\d+$/.test(String(value))) {
    const n = Number(value);
    ms = n < 1e12 ? n * 1000 : n; // seconds or milliseconds
  } else {
    ms = Date.parse(String(value));
  }
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

function toQuote(raw: RawItem): B2BQuote | null {
  const price = Number(raw.price ?? raw.r_price ?? raw.amount);
  if (!Number.isFinite(price) || price <= 0) return null;
  const usdPrice = Number(raw.usd_price);
  const dup = Number(raw.duplicate_count);
  return {
    id: String(raw.item_id ?? `${raw.ref}-${price}-${raw.sender_phone ?? ""}`),
    reference: String(raw.ref ?? ""),
    price,
    currency: String(raw.currency || "HKD").toUpperCase(),
    usdPrice: Number.isFinite(usdPrice) && usdPrice > 0 ? usdPrice : null,
    releaseDate: text(raw.release_date),
    postedAt: toIsoTime(raw.posted_time),
    seller: text(raw.sender_name),
    sellerPhone: text(raw.sender_phone),
    sellerAvatar: httpUrl(raw.sender_avt),
    group: text(raw.group_name),
    condition: text(raw.condition),
    color: text(raw.color),
    note: text(raw.note),
    image: httpUrl(raw.image),
    verified: Number(raw.verification) === 1,
    timesPosted: raw.duplicate_count != null && Number.isFinite(dup) ? dup + 1 : null,
  };
}

/**
 * TimeDealer sometimes tags an HKD price as USD (e.g. "103000 USD" for a
 * Submariner) while its own usd_price is correct. HKD is pegged at ~7.8/USD,
 * so a USD-tagged price ~7.8× its usd_price is really HKD.
 */
function fixMislabelledHkd(quote: B2BQuote): B2BQuote {
  if (quote.currency !== "USD" || !quote.usdPrice) return quote;
  const ratio = quote.price / quote.usdPrice;
  return ratio > 7.6 && ratio < 8 ? { ...quote, currency: "HKD" } : quote;
}

function moreSpecificDate(a: string | null, b: string | null): string | null {
  return (b?.length ?? 0) > (a?.length ?? 0) ? b : a;
}

/**
 * Dealers re-post the same watch many times; the feed returns each post as
 * its own item. Collapse same dealer + price + currency + condition into one
 * quote, keeping the latest post and counting the reposts.
 */
function mergeReposts(quotes: B2BQuote[]): B2BQuote[] {
  const byKey = new Map<string, B2BQuote>();
  for (const quote of quotes) {
    const dealer = quote.sellerPhone || quote.seller;
    const key = dealer
      ? [dealer, quote.price, quote.currency, quote.condition ?? ""].join("|")
      : quote.id;
    const prev = byKey.get(key);
    if (!prev) {
      byKey.set(key, quote);
      continue;
    }
    const [newer, older] =
      (quote.postedAt ?? "") > (prev.postedAt ?? "") ? [quote, prev] : [prev, quote];
    byKey.set(key, {
      ...newer,
      releaseDate: moreSpecificDate(newer.releaseDate, older.releaseDate),
      seller: newer.seller ?? older.seller,
      sellerAvatar: newer.sellerAvatar ?? older.sellerAvatar,
      group: newer.group ?? older.group,
      color: newer.color ?? older.color,
      note: newer.note ?? older.note,
      image: newer.image ?? older.image,
      verified: newer.verified || older.verified,
      timesPosted: (newer.timesPosted ?? 1) + (older.timesPosted ?? 1),
    });
  }
  return [...byKey.values()];
}

/** Map raw feed items to quotes for one reference + year, sorted for display. */
export function parseTimeDealerItems(
  items: RawItem[],
  opts: { reference: string; year: number },
): B2BQuote[] {
  const ref = opts.reference.toUpperCase();
  return sortQuotes(
    mergeReposts(
      items
        .map(toQuote)
        .filter((q): q is B2BQuote => Boolean(q))
        .map(fixMislabelledHkd)
        .filter((q) => q.reference.toUpperCase().includes(ref))
        .filter((q) => Boolean(q.releaseDate?.startsWith(String(opts.year)))),
    ),
  );
}

type FeedPage = {
  items: RawItem[];
  full: boolean;
  error?: string;
  authFailed?: boolean;
};

/** One page (up to 100 posts) of the forsale feed, sorted by price. */
async function fetchFeedPage(opts: {
  cookie: string;
  reference: string;
  year: number;
  sort: "asc" | "desc";
  deadline: number;
}): Promise<FeedPage> {
  const budget = Math.min(20_000, timeLeft(opts.deadline) - 500);
  if (budget < 2_000) {
    return { items: [], full: false, error: "TimeDealer search skipped — out of time" };
  }

  const body = {
    param: {
      time_range: 7776000, // ~90 days of dealer feed
      country: "",
      brand: "",
      status: "",
      material: "",
      strap: "",
      dial: "",
      whatsappname: "",
      whatsappphone: "",
      color: "",
      keyword: opts.reference,
      message_uuid: [] as string[],
      reference_number: opts.reference,
      year: [opts.year, opts.year],
    },
    sort: opts.sort,
    order: "Price",
    currency: "USD",
    type: 1, // forsale
    remove_duplicate: 1,
  };

  try {
    const res = await fetchWithTimeout(
      `${API_BASE}/search-item`,
      {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          cookie: opts.cookie,
          "user-agent": "WatchPriceResearch/1.0",
        },
        body: JSON.stringify(body),
      },
      budget,
    );
    if (res.status === 401 || res.status === 403) {
      return { items: [], full: false, authFailed: true, error: "TimeDealer session expired" };
    }
    if (!res.ok) {
      return { items: [], full: false, error: `TimeDealer search HTTP ${res.status}` };
    }
    const json = (await res.json()) as {
      items?: RawItem[];
      next_page?: unknown;
      message?: string;
    };
    if (!Array.isArray(json.items)) {
      // A valid search always carries an items array; anything else is
      // usually an expired session answered with HTTP 200.
      return {
        items: [],
        full: false,
        authFailed: true,
        error: json.message ? `TimeDealer: ${json.message}` : "TimeDealer returned no items",
      };
    }
    return {
      items: json.items,
      full: Boolean(json.next_page) || json.items.length >= FEED_PAGE_SIZE,
    };
  } catch (e) {
    return {
      items: [],
      full: false,
      error: isAbortError(e)
        ? "TimeDealer search timed out"
        : e instanceof Error
          ? e.message
          : "TimeDealer search failed",
    };
  }
}

/**
 * Cheapest and priciest pages in parallel, so the "highest" card is the real
 * top of the market, not just the top of the cheapest 100 posts.
 */
export async function searchTimeDealerForSale(opts: {
  cookie: string;
  reference: string;
  year: number;
  deadline: number;
}): Promise<TimeDealerYearResult> {
  const [cheapest, priciest] = await Promise.all([
    fetchFeedPage({ ...opts, sort: "asc" }),
    fetchFeedPage({ ...opts, sort: "desc" }),
  ]);
  if (cheapest.error && priciest.error) {
    return {
      quotes: [],
      totalFound: 0,
      dealerCount: 0,
      authFailed: cheapest.authFailed || priciest.authFailed,
      error: cheapest.error,
    };
  }

  // Both pages hold the same posts when there are fewer than a page's worth.
  const items = new Map<string, RawItem>();
  for (const item of [...cheapest.items, ...priciest.items]) {
    items.set(String(item.item_id ?? JSON.stringify(item)), item);
  }
  const listings = dropPriceOutliers(parseTimeDealerItems([...items.values()], opts));

  return {
    quotes: pickDisplayQuotes(listings),
    totalFound: listings.length,
    dealerCount: new Set(listings.map((q) => q.sellerPhone || q.seller || q.id)).size,
    // Two full pages may not meet in the middle.
    moreAvailable: cheapest.full && priciest.full && items.size >= FEED_PAGE_SIZE * 2,
  };
}

/** Dealer quotes for each comparison year, re-logging in once if the session expired. */
export async function fetchTimeDealerQuotes(opts: {
  reference: string;
  years: number[];
  deadline: number;
}): Promise<TimeDealerQuotes> {
  async function searchAll(cookie: string) {
    const results = await Promise.all(
      opts.years.map((year) =>
        searchTimeDealerForSale({
          cookie,
          reference: opts.reference,
          year,
          deadline: opts.deadline,
        }),
      ),
    );
    return Object.fromEntries(opts.years.map((y, i) => [y, results[i]!]));
  }

  let session = await getSession(opts.deadline);
  if (!session.cookie) {
    return { byYear: {}, error: session.error || "TimeDealer login failed" };
  }
  let byYear = await searchAll(session.cookie);

  if (Object.values(byYear).some((r) => r.authFailed)) {
    session = await getSession(opts.deadline, true);
    if (!session.cookie) {
      return { byYear: {}, error: session.error || "TimeDealer login failed" };
    }
    byYear = await searchAll(session.cookie);
  }

  return { byYear };
}
