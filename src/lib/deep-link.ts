/**
 * Shared by the server page (parses the URL) and the client app. Kept out of
 * the "use client" module: a server component only gets client references,
 * not values, from those.
 */
export const RESULT_TABS = ["buy", "sell", "b2b", "b2c", "report"] as const;

export type DeepLink = {
  reference: string;
  yearFrom: string;
  yearTo: string;
  month: string;
  dial: string;
  tab: (typeof RESULT_TABS)[number];
  autorun: boolean;
  skipB2B: boolean;
};
