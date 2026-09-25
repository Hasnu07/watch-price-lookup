import { ResearchApp, type DeepLink } from "@/components/research-app";

function param(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? "";
}

/** Deep link: ?ref=…&year=…&month=…&dial=…&tab=b2b|b2c|report&autorun=1&b2b=0 */
export default async function Home({ searchParams }: PageProps<"/">) {
  const params = await searchParams;
  const tab = param(params.tab);
  const month = param(params.month);
  const initial: DeepLink = {
    reference: param(params.ref) || param(params.reference),
    year: param(params.year) || String(new Date().getFullYear()),
    month: /^(?:[1-9]|1[0-2])$/.test(month) ? month : "",
    dial: param(params.dial),
    tab: tab === "b2b" || tab === "report" ? tab : "b2c",
    autorun: param(params.autorun) === "1",
    skipB2B: param(params.b2b) === "0",
  };
  return <ResearchApp initial={initial} />;
}
