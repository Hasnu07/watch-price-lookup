import { USD_RATES } from "@/lib/deal";
import { fetchWithTimeout, timeLeft } from "@/lib/http";

/** Units of each currency per 1 USD. */
export type UsdRates = Record<string, number>;

const ECB_RATES_URL = "https://api.frankfurter.dev/v1/latest?from=USD";
const TTL_MS = 12 * 60 * 60 * 1000;

let cached: { at: number; rates: UsdRates } | null = null;

/**
 * Daily ECB reference rates (via Frankfurter, free, no key) for dealer quotes
 * TimeDealer gives no USD value for (e.g. EUR). The dollar pegs (HKD, AED)
 * are always present, so a failed fetch only loses the floating currencies.
 */
export async function getUsdRates(deadline: number): Promise<UsdRates> {
  if (cached && Date.now() - cached.at < TTL_MS) return cached.rates;
  const pegs: UsdRates = { ...USD_RATES };
  const budget = Math.min(5_000, timeLeft(deadline) - 500);
  if (budget < 1_000) return pegs;
  try {
    const res = await fetchWithTimeout(ECB_RATES_URL, { headers: { accept: "application/json" } }, budget);
    if (!res.ok) return pegs;
    const json = (await res.json()) as { rates?: Record<string, number> };
    if (!json.rates) return pegs;
    // Pegs win for HKD / AED so they match the calculator.
    const rates = { ...json.rates, ...pegs };
    cached = { at: Date.now(), rates };
    return rates;
  } catch {
    return pegs;
  }
}
