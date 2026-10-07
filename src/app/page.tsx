import { ResearchApp } from "@/components/research-app";
import { RESULT_TABS, type DeepLink } from "@/lib/deep-link";
import { legacyYearRange } from "@/lib/watch-research";

function param(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? "";
}

/**
 * Deep link: ?ref=…&from=2024&to=2026&month=…&dial=…&tab=buy|sell|b2b|b2c|report
 * &autorun=1&b2b=0 — an old single ?year=… maps to the original comparison rule.
 */
export default async function Home({ searchParams }: PageProps<"/">) {
  const params = await searchParams;
  const currentYear = new Date().getFullYear();
  const tab = param(params.tab);
  const month = param(params.month);
  const legacy = param(params.year) ? legacyYearRange(Number(param(params.year))) : null;
  const initial: DeepLink = {
    reference: param(params.ref) || param(params.reference),
    yearFrom: param(params.from) || String(legacy?.yearFrom ?? currentYear - 1),
    yearTo: param(params.to) || String(legacy?.yearTo ?? currentYear),
    month: /^(?:[1-9]|1[0-2])$/.test(month) ? month : "",
    dial: param(params.dial),
    tab: (RESULT_TABS as readonly string[]).includes(tab)
      ? (tab as DeepLink["tab"])
      : "buy",
    autorun: param(params.autorun) === "1",
    skipB2B: param(params.b2b) === "0",
  };
  return <ResearchApp initial={initial} />;
}
