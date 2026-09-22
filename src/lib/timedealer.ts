import CryptoJS from "crypto-js";

const SECRET = "jgoteam@2024";
const API_BASE = "https://timedealer.io/api";
const DEFAULT_DEVICE_ID = "watch-price-research-device";

export type TimeDealerListing = {
  itemId: string;
  reference: string;
  price: number;
  currency: string;
  releaseDate: string | null;
  groupName: string | null;
  transactionType: string | null;
  note: string | null;
  senderName: string | null;
};

export type TimeDealerSearchResult = {
  year: number;
  listings: TimeDealerListing[];
  lowest: TimeDealerListing | null;
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

export async function loginTimeDealer(opts?: {
  phone?: string;
  password?: string;
  deviceId?: string;
}): Promise<{ cookie: string; error?: string }> {
  const phone = normalizePhone(
    opts?.phone ||
      process.env.TIMEDEALER_PHONE ||
      process.env.TIMEDEALER_USER ||
      "",
  );
  const password =
    opts?.password || process.env.TIMEDEALER_PASSWORD || "";
  const deviceId =
    opts?.deviceId || process.env.TIMEDEALER_DEVICE_ID || DEFAULT_DEVICE_ID;

  if (!phone || !password) {
    return {
      cookie: "",
      error:
        "TimeDealer credentials missing. Set TIMEDEALER_PHONE and TIMEDEALER_PASSWORD in .env.local.",
    };
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
    const res = await fetch(`${API_BASE}/login`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        "user-agent": "WatchPriceResearch/1.0",
      },
      body: JSON.stringify(encryptPayload(payload)),
      cache: "no-store",
    });
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
      error: e instanceof Error ? e.message : "TimeDealer login network error",
    };
  }
}

type RawItem = {
  item_id?: string | number;
  ref?: string;
  price?: number | string | null;
  currency?: string | null;
  release_date?: string | null;
  group_name?: string | null;
  transaction_type?: string | null;
  note?: string | null;
  sender_name?: string | null;
  r_price?: number | string | null;
  amount?: number | string | null;
};

function toListing(raw: RawItem): TimeDealerListing | null {
  const priceRaw = raw.price ?? raw.r_price ?? raw.amount;
  const price = Number(priceRaw);
  if (!Number.isFinite(price) || price <= 0) return null;
  return {
    itemId: String(raw.item_id ?? `${raw.ref}-${price}`),
    reference: String(raw.ref ?? ""),
    price,
    currency: String(raw.currency || "HKD").toUpperCase(),
    releaseDate: raw.release_date ?? null,
    groupName: raw.group_name ?? null,
    transactionType: raw.transaction_type ?? null,
    note: raw.note ?? null,
    senderName: raw.sender_name ?? null,
  };
}

function matchesYear(releaseDate: string | null, year: number): boolean {
  if (!releaseDate) return false;
  return releaseDate.startsWith(String(year));
}

function monthDistance(releaseDate: string | null, month: number | null): number {
  if (!month || !releaseDate) return 99;
  const m = releaseDate.match(/^\d{4}-(\d{1,2})/);
  if (!m) return 50;
  return Math.abs(Number(m[1]) - month);
}

export async function searchTimeDealerForSale(opts: {
  cookie: string;
  reference: string;
  year: number;
  month?: number | null;
  limit?: number;
}): Promise<TimeDealerSearchResult> {
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
    sort: "asc",
    order: "Price",
    currency: "USD",
    type: 1, // forsale
    remove_duplicate: 1,
  };

  try {
    const res = await fetch(`${API_BASE}/search-item`, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        cookie: opts.cookie,
        "user-agent": "WatchPriceResearch/1.0",
      },
      body: JSON.stringify(body),
      cache: "no-store",
    });
    if (!res.ok) {
      return {
        year: opts.year,
        listings: [],
        lowest: null,
        error: `TimeDealer search HTTP ${res.status}`,
      };
    }
    const json = (await res.json()) as { items?: RawItem[]; total?: number };
    const listings = (json.items ?? [])
      .map(toListing)
      .filter((x): x is TimeDealerListing => Boolean(x))
      .filter((x) =>
        x.reference.toUpperCase().includes(opts.reference.toUpperCase()),
      )
      .filter((x) => matchesYear(x.releaseDate, opts.year))
      .sort((a, b) => {
        // Prefer HKD dealer quotes (HK market), then closer month, then lower price
        const currRank = (c: string) => (c === "HKD" ? 0 : c === "USD" ? 1 : 2);
        const ca = currRank(a.currency);
        const cb = currRank(b.currency);
        if (ca !== cb) return ca - cb;
        const ma = monthDistance(a.releaseDate, opts.month ?? null);
        const mb = monthDistance(b.releaseDate, opts.month ?? null);
        if (ma !== mb) return ma - mb;
        return a.price - b.price;
      });

    return {
      year: opts.year,
      listings: listings.slice(0, opts.limit ?? 12),
      lowest: listings[0] ?? null,
    };
  } catch (e) {
    return {
      year: opts.year,
      listings: [],
      lowest: null,
      error: e instanceof Error ? e.message : "TimeDealer search failed",
    };
  }
}
