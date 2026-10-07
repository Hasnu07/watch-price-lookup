"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  BadgeCheck,
  Check,
  Copy,
  ExternalLink,
  Loader2,
  MessageCircle,
  Search,
  Settings2,
  Watch,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { BuyPanel, SellPanel, type DealForm } from "@/components/deal-calculator";
import {
  analyzeBuy,
  analyzeSell,
  dealReportLines,
  convertTyped,
  fromUsd,
  marketLevels,
  parseAmount,
  parsePercent,
  toUsd,
} from "@/lib/deal";
import type { DeepLink } from "@/lib/deep-link";
import { useLocalStorage } from "@/lib/use-local-storage";
import {
  MAX_YEAR_SPAN,
  MONTH_NAMES,
  formatMoney,
  formatReportText,
  releaseMonth,
  sortQuotes,
  yearsLabel,
  type B2BQuote,
  type B2BYear,
  type MarketListing,
  type ResearchReport,
} from "@/lib/watch-research";
import { cn } from "@/lib/utils";

const STORAGE_KEY = "watch-price-research:reef-key";
const HISTORY_KEY = "watch-price-research:history";
const COSTS_KEY = "watch-price-research:costs-pct";
const PROFIT_KEY = "watch-price-research:profit-pct";
const DEFAULT_COSTS_PCT = 2;
const DEFAULT_PROFIT_PCT = 5;


type HistoryEntry = {
  reference: string;
  yearFrom?: number;
  yearTo?: number;
  /** Entries saved before year ranges. */
  year?: number;
  month?: number | null;
  at: string;
};

function historyRange(h: HistoryEntry): { from: number; to: number } {
  return {
    from: h.yearFrom ?? h.year ?? new Date().getFullYear(),
    to: h.yearTo ?? h.year ?? new Date().getFullYear(),
  };
}

function parseHistory(raw: string | null): HistoryEntry[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as HistoryEntry[]) : [];
  } catch {
    return [];
  }
}

function money(listing: MarketListing | null | undefined): string {
  return listing ? formatMoney(listing.price, listing.currency) : "—";
}

function noteTone(note: string): string {
  return /timed out|unavailable|error|failed|HTTP|missing|Stopped/i.test(note)
    ? "border-red-200/80 bg-red-50/70 text-ink"
    : "border-teal-200/80 bg-teal-50/60 text-ink";
}

function sentence(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

const relativeTime = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

/** Relative to when the report was generated, so renders stay pure. */
function timeAgo(iso: string | null, nowIso: string): string | null {
  if (!iso) return null;
  const diffMs = Date.parse(iso) - Date.parse(nowIso);
  if (!Number.isFinite(diffMs)) return null;
  const minutes = Math.round(diffMs / 60_000);
  if (Math.abs(minutes) < 60) return relativeTime.format(minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return relativeTime.format(hours, "hour");
  return relativeTime.format(Math.round(hours / 24), "day");
}

/** TimeDealer phones come as bare digits ("85291592153"). */
function displayPhone(phone: string): string {
  return /^\d{8,}$/.test(phone) ? `+${phone}` : phone;
}

/** Take the dealer half of a report from the B2B request. */
function withB2BFrom(report: ResearchReport, from: ResearchReport): ResearchReport {
  return {
    ...report,
    b2b: from.b2b,
    feasibility: {
      ...report.feasibility,
      b2bAuto: from.feasibility.b2bAuto,
      b2bNote: from.feasibility.b2bNote,
    },
  };
}

/**
 * Take Chrono24 slices from a partial report: lowest/highest come from the
 * fast "prices" request, lowest UAE from the slower "uae" request.
 */
function withChrono24From(
  report: ResearchReport,
  from: ResearchReport,
  part: "prices" | "uae",
): ResearchReport {
  const byYear = { ...report.b2c.byYear };
  for (const [y, slices] of Object.entries(from.b2c.byYear)) {
    const current = byYear[Number(y)] ?? slices;
    byYear[Number(y)] =
      part === "prices"
        ? {
            ...current,
            lowestWorld: slices.lowestWorld,
            highestWorld: slices.highestWorld,
            retail: slices.retail,
          }
        : { ...current, lowestUae: slices.lowestUae };
  }
  return {
    ...report,
    b2c: { byYear },
    feasibility:
      part === "prices"
        ? {
            ...report.feasibility,
            b2cAuto: from.feasibility.b2cAuto,
            b2cNote: from.feasibility.b2cNote,
          }
        : report.feasibility,
  };
}

async function postResearch(
  body: Record<string, unknown>,
  signal: AbortSignal,
): Promise<ResearchReport> {
  const res = await fetch("/api/research", {
    method: "POST",
    headers: { "content-type": "application/json" },
    signal,
    body: JSON.stringify(body),
  });
  // A gateway timeout can answer with an HTML page, not JSON.
  const data = (await res.json().catch(() => null)) as {
    report?: ResearchReport;
    error?: string;
  } | null;
  if (!res.ok || !data?.report) {
    throw new Error(
      data?.error || `Research failed (HTTP ${res.status}). Retry in a moment.`,
    );
  }
  return data.report;
}

function whatsappUrl(phone: string | null): string | null {
  const digits = phone?.replace(/\D/g, "") ?? "";
  return digits.length >= 8 ? `https://wa.me/${digits}` : null;
}

function QuoteCard({
  quote,
  rank,
  targetMonth,
  generatedAt,
}: {
  quote: B2BQuote;
  rank: "lowest" | "highest" | null;
  targetMonth: number | null;
  generatedAt: string;
}) {
  const sameMonth =
    targetMonth !== null && releaseMonth(quote.releaseDate) === targetMonth;
  const posted = timeAgo(quote.postedAt, generatedAt);
  const whatsapp = whatsappUrl(quote.sellerPhone);
  const details: [string, string | null][] = [
    ["Dated", quote.releaseDate],
    ["Condition", quote.condition],
    ["Dial", quote.color],
    ["Group", quote.group],
    [
      "Posted",
      [
        posted,
        quote.timesPosted && quote.timesPosted > 1
          ? `${quote.timesPosted}× posted`
          : null,
      ]
        .filter(Boolean)
        .join(" · ") || null,
    ],
  ];

  return (
    <article
      className={cn(
        "flex flex-col gap-3 rounded-xl border bg-white/85 p-4",
        rank === "lowest"
          ? "border-teal-700/35 ring-1 ring-teal-700/15"
          : rank === "highest"
            ? "border-amber-700/30 ring-1 ring-amber-700/10"
            : "border-ink/10",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-2xl font-semibold tabular-nums tracking-tight text-ink">
            {formatMoney(quote.price, quote.currency)}
          </p>
          {quote.usdPrice && quote.currency !== "USD" ? (
            <p className="text-xs tabular-nums text-ink/55">
              ≈ {formatMoney(quote.usdPrice, "USD")} at TimeDealer rate
            </p>
          ) : null}
        </div>
        {quote.image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={quote.image}
            alt=""
            loading="lazy"
            className="size-14 shrink-0 rounded-lg border border-ink/10 object-cover"
          />
        ) : null}
      </div>

      {rank || quote.verified || sameMonth ? (
        <div className="flex flex-wrap gap-1.5">
          {rank === "lowest" ? (
            <Badge className="bg-teal-800 text-white">Lowest</Badge>
          ) : null}
          {rank === "highest" ? (
            <Badge className="bg-amber-800 text-white">Highest</Badge>
          ) : null}
          {quote.verified ? (
            <Badge variant="outline" className="border-teal-700/30 text-teal-900">
              <BadgeCheck /> Verified
            </Badge>
          ) : null}
          {sameMonth ? (
            <Badge variant="outline" className="border-amber-600/40 text-amber-900">
              Same month
            </Badge>
          ) : null}
        </div>
      ) : null}

      <div className="flex items-center gap-2.5">
        {quote.sellerAvatar ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={quote.sellerAvatar}
            alt=""
            loading="lazy"
            className="size-8 shrink-0 rounded-full object-cover"
          />
        ) : (
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-ink/8 text-sm font-medium text-ink/70">
            {(quote.seller || "?").charAt(0).toUpperCase()}
          </span>
        )}
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-ink">
            {quote.seller || "Unknown dealer"}
          </p>
          {quote.sellerPhone ? (
            <p className="truncate text-xs tabular-nums text-ink/55">
              {displayPhone(quote.sellerPhone)}
            </p>
          ) : null}
        </div>
      </div>

      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
        {details
          .filter(([, value]) => value)
          .map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="text-ink/50">{label}</dt>
              <dd className="min-w-0 truncate text-ink/80">{value}</dd>
            </div>
          ))}
      </dl>

      {quote.note ? (
        <p
          className="line-clamp-3 whitespace-pre-line rounded-lg bg-ink/[0.03] px-3 py-2 text-xs leading-relaxed text-ink/70"
          title={quote.note}
        >
          {quote.note}
        </p>
      ) : null}

      {whatsapp ? (
        <a
          href={whatsapp}
          target="_blank"
          rel="noreferrer"
          className="mt-auto inline-flex h-8 w-fit items-center gap-1.5 rounded-lg border border-ink/15 bg-background px-2.5 text-xs font-medium hover:bg-muted"
        >
          <MessageCircle className="size-3.5" /> WhatsApp seller
        </a>
      ) : null}
    </article>
  );
}

function B2BYearCard({
  entry,
  generatedAt,
}: {
  entry: B2BYear;
  generatedAt: string;
}) {
  const quotes = sortQuotes(entry.quotes);
  const count = entry.totalFound || quotes.length;
  const dealers =
    entry.dealerCount ?? new Set(quotes.map((q) => q.sellerPhone || q.seller)).size;

  return (
    <Card className="border-ink/10 bg-white/75 shadow-none">
      <CardHeader>
        <CardTitle className="text-base">
          Dealer quotes · {entry.year}
          {entry.month ? ` · ${MONTH_NAMES[entry.month - 1]}` : ""}
        </CardTitle>
        <CardDescription>
          {quotes.length
            ? `${count}${entry.moreAvailable ? "+" : ""} listing${count === 1 ? "" : "s"} from ${dealers} dealer${dealers === 1 ? "" : "s"} on TimeDealer (last 90 days, reposts merged).${
                count > quotes.length
                  ? ` Showing the ${quotes.length - 1} cheapest and the highest.`
                  : ""
              }`
            : sentence(entry.note || "No dealer quotes yet.")}
        </CardDescription>
      </CardHeader>
      {quotes.length ? (
        <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {quotes.map((quote, i) => (
            <QuoteCard
              key={`${quote.id}-${i}`}
              quote={quote}
              rank={
                i === 0
                  ? "lowest"
                  : i === quotes.length - 1
                    ? "highest"
                    : null
              }
              targetMonth={entry.month}
              generatedAt={generatedAt}
            />
          ))}
        </CardContent>
      ) : null}
    </Card>
  );
}

type ListingCellProps = {
  label: string;
  slice: {
    searchUrl: string;
    listing: MarketListing | null;
    note?: string;
  };
  /** Shown while this cell's request is still running. */
  loadingNote?: string | null;
  onManual: (listing: MarketListing | null) => void;
};

function ListingCell(props: ListingCellProps) {
  return (
    <ListingCellInner
      key={`${props.label}-${props.slice.listing?.id ?? "empty"}-${props.slice.listing?.price ?? ""}`}
      {...props}
    />
  );
}

function ListingCellInner({ label, slice, loadingNote, onManual }: ListingCellProps) {
  const [price, setPrice] = useState(
    slice.listing ? String(slice.listing.price) : "",
  );
  const [currency, setCurrency] = useState(slice.listing?.currency || "USD");

  return (
    <div className="rounded-lg border border-border/80 bg-card/60 p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium">{label}</p>
        <a
          href={slice.searchUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-xs text-teal-800 hover:underline"
        >
          Open Chrono24 <ExternalLink className="size-3" />
        </a>
      </div>
      <p className="text-lg font-semibold tabular-nums tracking-tight text-ink">
        {loadingNote && !slice.listing ? (
          <Loader2 className="size-4 animate-spin text-ink/50" />
        ) : (
          money(slice.listing)
        )}
      </p>
      {slice.listing?.year ? (
        <p className="text-xs font-medium text-teal-900">
          Year of production: {slice.listing.year}
          {slice.listing.location ? ` · ${slice.listing.location}` : ""}
        </p>
      ) : null}
      {slice.listing?.title ? (
        <p className="text-xs text-muted-foreground line-clamp-2">
          {slice.listing.title}
        </p>
      ) : null}
      {loadingNote && !slice.listing ? (
        <p className="text-xs text-teal-900/80">{loadingNote}</p>
      ) : slice.note ? (
        <p className="text-xs text-teal-900/80">{slice.note}</p>
      ) : null}
      <div className="flex flex-wrap gap-2 pt-1">
        <Input
          className="h-8 w-28"
          placeholder="Price"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
        />
        <Input
          className="h-8 w-20"
          placeholder="CCY"
          value={currency}
          onChange={(e) => setCurrency(e.target.value.toUpperCase())}
        />
        <Button
          type="button"
          size="sm"
          variant="secondary"
          className="h-8"
          onClick={() => {
            const n = Number(String(price).replace(/,/g, ""));
            if (!Number.isFinite(n) || n <= 0) {
              onManual(null);
              return;
            }
            onManual({
              id: `manual-${label}`,
              title: `Manual ${label}`,
              price: n,
              currency: currency || "USD",
              url: slice.searchUrl,
            });
          }}
        >
          Save
        </Button>
      </div>
    </div>
  );
}

export function ResearchApp({ initial }: { initial: DeepLink }) {
  const [reference, setReference] = useState(initial.reference);
  const [yearFrom, setYearFrom] = useState(initial.yearFrom);
  const [yearTo, setYearTo] = useState(initial.yearTo);
  const [month, setMonth] = useState(initial.month);
  const [dial, setDial] = useState(initial.dial);
  const [storedReefKey, setStoredReefKey] = useLocalStorage(STORAGE_KEY);
  const reefKey = storedReefKey ?? "";
  const [showSettings, setShowSettings] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<ResearchReport | null>(null);
  const [copied, setCopied] = useState(false);
  const [historyRaw, setHistoryRaw] = useLocalStorage(HISTORY_KEY);
  const history = useMemo(() => parseHistory(historyRaw), [historyRaw]);
  const [b2bPending, setB2bPending] = useState(false);
  const [b2cPending, setB2cPending] = useState(false);
  const [uaePending, setUaePending] = useState(false);
  const pending = b2bPending || b2cPending || uaePending;
  const [tab, setTab] = useState<string>(initial.tab);
  const autoRan = useRef(false);
  const runId = useRef(0);

  const fromNum = Number(yearFrom);
  const toNum = Number(yearTo);
  const rangeError =
    !fromNum || !toNum
      ? "Enter both years."
      : fromNum > toNum
        ? "\"Year from\" must not be after \"Year to\"."
        : toNum - fromNum + 1 > MAX_YEAR_SPAN
          ? `Pick at most ${MAX_YEAR_SPAN} years at once.`
          : null;

  // Buy / Sell calculator: inputs live here so the report can include them.
  const [deal, setDeal] = useState<DealForm>({
    currency: "USD",
    asking: "",
    client: "",
    offer: "",
    cost: "",
  });
  const [costsRaw, setCostsRaw] = useLocalStorage(COSTS_KEY);
  const [profitRaw, setProfitRaw] = useLocalStorage(PROFIT_KEY);
  const costsInput = costsRaw ?? String(DEFAULT_COSTS_PCT);
  const profitInput = profitRaw ?? String(DEFAULT_PROFIT_PCT);
  const settings = useMemo(
    () => ({
      costsPct: parsePercent(costsInput, DEFAULT_COSTS_PCT),
      profitPct: parsePercent(profitInput, DEFAULT_PROFIT_PCT),
    }),
    [costsInput, profitInput],
  );
  function updateDeal(patch: Partial<DealForm>) {
    setDeal((d) => {
      const to = patch.currency;
      if (!to || to === d.currency) return { ...d, ...patch };
      // Typed amounts keep their meaning when the currency changes.
      return {
        ...d,
        currency: to,
        asking: convertTyped(d.asking, d.currency, to),
        client: convertTyped(d.client, d.currency, to),
        offer: convertTyped(d.offer, d.currency, to),
        cost: convertTyped(d.cost, d.currency, to),
      };
    });
  }
  const dealUsd = (raw: string) => {
    const amount = parseAmount(raw);
    return amount === null ? null : toUsd(amount, deal.currency);
  };
  const askingUsd = dealUsd(deal.asking);
  const clientUsd = dealUsd(deal.client);
  const offerUsd = dealUsd(deal.offer);
  const costUsd = dealUsd(deal.cost);
  const fmtDeal = (usd: number) => formatMoney(fromUsd(usd, deal.currency), deal.currency);

  const market = useMemo(() => (report ? marketLevels(report) : null), [report]);
  const buy = market
    ? analyzeBuy({ askingUsd, clientUsd, market, settings, fmt: fmtDeal })
    : null;
  const sell = market
    ? analyzeSell({ offerUsd, costUsd, market, settings, fmt: fmtDeal })
    : null;

  const reportText =
    report && market && buy && sell
      ? formatReportText(
          report,
          dealReportLines({
            market,
            currency: deal.currency,
            settings,
            buy: { askingUsd, analysis: buy },
            sell: { offerUsd, analysis: sell },
          }),
        )
      : "";

  function pushHistory(ref: string, from: number, to: number, m: number | null) {
    const next: HistoryEntry[] = [
      { reference: ref, yearFrom: from, yearTo: to, month: m, at: new Date().toISOString() },
      ...history.filter((h) => {
        const r = historyRange(h);
        return !(h.reference === ref && r.from === from && r.to === to && (h.month ?? null) === m);
      }),
    ].slice(0, 12);
    setHistoryRaw(JSON.stringify(next));
  }

  function updateB2c(
    y: number,
    key: "lowestWorld" | "highestWorld" | "lowestUae",
    listing: MarketListing | null,
  ) {
    setReport((prev) => {
      if (!prev) return prev;
      const bucket = prev.b2c.byYear[y];
      if (!bucket) return prev;
      return {
        ...prev,
        b2c: {
          byYear: {
            ...prev.b2c.byYear,
            [y]: {
              ...bucket,
              [key]: { ...bucket[key], listing },
            },
          },
        },
      };
    });
  }

  async function runResearch(opts?: { skipB2B?: boolean }) {
    const ref = reference.trim();

    if (!ref) {
      setError("Reference is required.");
      return;
    }
    if (rangeError) {
      setError(rangeError);
      return;
    }
    const id = ++runId.current;
    const isCurrent = () => runId.current === id;
    const withDealers = !opts?.skipB2B;
    setError(null);
    setCopied(false);
    setReport(null);
    setB2bPending(withDealers);
    setB2cPending(true);
    setUaePending(true);

    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 65_000);
    const base = {
      reference: ref,
      yearFrom: fromNum,
      yearTo: toNum,
      month: month ? Number(month) : null,
      dial: dial || undefined,
    };
    const errors: string[] = [];
    let recorded = false;

    // Dealer quotes, Chrono24 prices and the UAE lookup (it opens listings,
    // so it's the slowest) load as separate requests; each shows as it lands.
    async function load(
      part: "b2b" | "prices" | "uae",
      body: Record<string, unknown>,
      done: (value: boolean) => void,
    ) {
      try {
        const partReport = await postResearch(body, controller.signal);
        if (!isCurrent()) return;
        setReport((prev) =>
          part === "b2b"
            ? withB2BFrom(prev ?? partReport, partReport)
            : withChrono24From(prev ?? partReport, partReport, part),
        );
        if (!recorded) {
          recorded = true;
          pushHistory(
            partReport.reference,
            partReport.yearFrom,
            partReport.yearTo,
            partReport.month,
          );
        }
      } catch (e) {
        const label =
          part === "b2b" ? "Dealer quotes" : part === "prices" ? "Chrono24" : "Chrono24 UAE";
        errors.push(
          e instanceof DOMException && e.name === "AbortError"
            ? `${label} timed out after 65s.`
            : `${label}: ${e instanceof Error ? e.message : "network error"}`,
        );
      } finally {
        if (isCurrent()) done(false);
      }
    }

    await Promise.all([
      withDealers
        ? load("b2b", { ...base, autoFetchB2C: false }, setB2bPending)
        : null,
      load(
        "prices",
        { ...base, reefApiKey: reefKey || undefined, autoFetchB2B: false, chrono24: "prices" },
        setB2cPending,
      ),
      load(
        "uae",
        { ...base, reefApiKey: reefKey || undefined, autoFetchB2B: false, chrono24: "uae" },
        setUaePending,
      ),
    ]);
    window.clearTimeout(timer);
    if (isCurrent() && errors.length) setError(errors.join(" "));
  }

  useEffect(() => {
    // Deep-link autorun once on mount; the form already holds the link values.
    if (autoRan.current || !initial.autorun) return;
    autoRan.current = true;
    void runResearch({ skipB2B: initial.skipB2B });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function copyReport() {
    if (!reportText) return;
    await navigator.clipboard.writeText(reportText);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  }

  return (
    <div className="relative min-h-full">
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute inset-0 bg-[linear-gradient(165deg,#eef2f5_0%,#e3ebf1_40%,#d9e6e3_100%)]" />
        <div className="absolute -top-32 right-[-10%] h-[26rem] w-[26rem] rounded-full bg-[radial-gradient(closest-side,rgba(47,111,104,0.16),transparent)]" />
        <div className="absolute bottom-[-20%] left-[-8%] h-[22rem] w-[22rem] rounded-full bg-[radial-gradient(closest-side,rgba(61,79,95,0.12),transparent)]" />
        <div
          className="absolute inset-0 opacity-40"
          style={{
            backgroundImage:
              "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='80' height='80' viewBox='0 0 80 80'%3E%3Cpath fill='none' stroke='%23152029' stroke-opacity='0.04' d='M0 40h80M40 0v80'/%3E%3C/svg%3E\")",
          }}
        />
      </div>

      <div className="relative mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 py-8 sm:px-6 sm:py-12">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 text-teal-900/80">
              <Watch className="size-4" />
              <span className="text-xs font-medium uppercase tracking-[0.22em]">
                Desk research
              </span>
            </div>
            <h1 className="font-display text-4xl leading-none tracking-tight text-ink sm:text-5xl">
              Watch Price Check
            </h1>
            <p className="max-w-xl text-sm leading-relaxed text-ink/70 sm:text-base">
              Enter the full reference and a year range. The app pulls dealer
              (TimeDealer) and retail (Chrono24) prices, then tells you what a
              watch is worth buying or selling at after your costs and profit.
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            className="self-start border-ink/15 bg-white/50"
            onClick={() => setShowSettings((v) => !v)}
          >
            <Settings2 className="size-4" />
            Settings
          </Button>
        </header>

        {showSettings ? (
          <Card className="border-ink/10 bg-white/70 shadow-none backdrop-blur">
            <CardHeader>
              <CardTitle className="text-base">Data connections</CardTitle>
              <CardDescription>
                Chrono24 auto B2C uses a ReefAPI key. TimeDealer auto B2B uses
                phone + password from{" "}
                <code className="rounded bg-ink/5 px-1">.env.local</code>{" "}
                (<code className="rounded bg-ink/5 px-1">TIMEDEALER_PHONE</code>,{" "}
                <code className="rounded bg-ink/5 px-1">TIMEDEALER_PASSWORD</code>
                ). HKD quotes stay in HKD.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-2">
                <Label htmlFor="reef">ReefAPI key (optional)</Label>
                <Input
                  id="reef"
                  type="password"
                  placeholder="Stored only in this browser"
                  value={reefKey}
                  onChange={(e) => setStoredReefKey(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Free tier at reefapi.com · or set{" "}
                  <code className="rounded bg-ink/5 px-1">REEF_API_KEY</code> in
                  `.env.local`.
                </p>
              </div>
            </CardContent>
          </Card>
        ) : null}

        <Card className="border-ink/10 bg-white/80 shadow-none backdrop-blur">
          <CardHeader>
            <CardTitle className="font-display text-2xl tracking-tight">
              New check
            </CardTitle>
            <CardDescription>
              Always use the full reference including the dial suffix (e.g.
              7118/1200A-010 ≠ 7118/1200A-011).
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form
              className="grid gap-4 sm:grid-cols-2 lg:grid-cols-12"
              onSubmit={(e) => {
                e.preventDefault();
                void runResearch();
              }}
            >
              <div className="space-y-2 lg:col-span-4">
                <Label htmlFor="ref">Reference</Label>
                <Input
                  id="ref"
                  placeholder="7118/1200A-010"
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                  required
                  className="h-11 font-mono"
                />
              </div>
              <div className="space-y-2 lg:col-span-2">
                <Label htmlFor="year-from">Year from</Label>
                <Input
                  id="year-from"
                  type="number"
                  min={1990}
                  max={2035}
                  value={yearFrom}
                  onChange={(e) => setYearFrom(e.target.value)}
                  required
                  className="h-11"
                />
              </div>
              <div className="space-y-2 lg:col-span-2">
                <Label htmlFor="year-to">Year to</Label>
                <Input
                  id="year-to"
                  type="number"
                  min={1990}
                  max={2035}
                  value={yearTo}
                  onChange={(e) => setYearTo(e.target.value)}
                  required
                  className="h-11"
                />
              </div>
              <div className="space-y-2 lg:col-span-2">
                <Label htmlFor="month">Month (optional)</Label>
                <select
                  id="month"
                  value={month}
                  onChange={(e) => setMonth(e.target.value)}
                  className="border-input bg-background h-11 w-full rounded-md border px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                >
                  <option value="">—</option>
                  {MONTH_NAMES.map((name, i) => (
                    <option key={name} value={String(i + 1)}>
                      {name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2 lg:col-span-2">
                <Label htmlFor="dial">Dial (optional)</Label>
                <Input
                  id="dial"
                  placeholder="Auto from suffix"
                  value={dial}
                  onChange={(e) => setDial(e.target.value)}
                  className="h-11"
                />
              </div>
              <div className="flex flex-col gap-2 lg:col-span-12 sm:flex-row sm:items-center">
                <Button
                  type="submit"
                  disabled={pending || !reference.trim() || Boolean(rangeError)}
                  className="h-11 bg-ink text-white hover:bg-ink/90"
                >
                  {pending ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Search className="size-4" />
                  )}
                  {pending ? "Researching…" : "Run price check"}
                </Button>
                {rangeError && !pending ? (
                  <p className="text-xs text-red-700">{rangeError}</p>
                ) : null}
                {pending ? (
                  <p className="text-xs text-ink/60">
                    {report && !b2bPending
                      ? "Dealer quotes ready — Chrono24 still loading."
                      : "Checking TimeDealer + Chrono24 — dealer quotes first."}
                  </p>
                ) : null}
              </div>
            </form>

            {history.length > 0 ? (
              <div className="mt-5 flex flex-wrap gap-2">
                {history.map((h) => {
                  const r = historyRange(h);
                  return (
                    <button
                      key={`${h.reference}-${r.from}-${r.to}-${h.at}`}
                      type="button"
                      onClick={() => {
                        setReference(h.reference);
                        setYearFrom(String(r.from));
                        setYearTo(String(r.to));
                        setMonth(h.month ? String(h.month) : "");
                      }}
                      className="rounded-full border border-ink/10 bg-white/60 px-3 py-1 text-xs text-ink/70 transition hover:border-teal-700/30 hover:text-ink"
                    >
                      {h.reference} · {yearsLabel(r.from, r.to)}
                      {h.month ? ` ${MONTH_NAMES[h.month - 1]?.slice(0, 3)}` : ""}
                    </button>
                  );
                })}
              </div>
            ) : null}
          </CardContent>
        </Card>

        {error ? (
          <Alert variant="destructive" className="border-red-200 bg-red-50">
            <AlertCircle className="size-4" />
            <AlertTitle>Could not run research</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        {report ? (
          <div className="space-y-6 animate-in fade-in duration-500">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="font-display text-3xl tracking-tight text-ink">
                  {report.reference}
                </p>
                <p className="text-sm text-ink/65">
                  Dial {report.dial} · {yearsLabel(report.yearFrom, report.yearTo)}
                  {report.month
                    ? ` · ${MONTH_NAMES[report.month - 1]} ${report.yearTo}`
                    : ""}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Badge variant="secondary" className="bg-white/70">
                  Years: {report.yearPlan.yearsToCheck.join(", ")}
                </Badge>
                <Badge
                  variant="outline"
                    className={cn(
                    report.feasibility.b2cAuto
                      ? "border-teal-700/30 text-teal-900"
                      : "border-slate-400/40 text-slate-700",
                  )}
                >
                  B2C {report.feasibility.b2cAuto ? "auto" : "manual links"}
                </Badge>
                <Badge
                  variant="outline"
                  className={cn(
                    report.feasibility.b2bAuto
                      ? "border-teal-700/30 text-teal-900"
                      : "border-ink/15 text-ink/70",
                  )}
                >
                  B2B {report.feasibility.b2bAuto ? "auto" : "off"}
                </Badge>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {report.yearPlan.rules.map((rule) => (
                <div
                  key={rule}
                  className="rounded-xl border border-ink/8 bg-white/55 px-4 py-3 text-sm text-ink/75"
                >
                  {rule}
                </div>
              ))}
            </div>

            <Tabs value={tab} onValueChange={setTab} className="gap-4">
              <TabsList className="h-auto flex-wrap bg-white/60">
                <TabsTrigger value="buy">Buy</TabsTrigger>
                <TabsTrigger value="sell">Sell</TabsTrigger>
                <TabsTrigger value="b2b">
                  B2B · dealers
                  {b2bPending ? <Loader2 className="size-3 animate-spin" /> : null}
                </TabsTrigger>
                <TabsTrigger value="b2c">
                  B2C · Chrono24
                  {b2cPending || uaePending ? (
                    <Loader2 className="size-3 animate-spin" />
                  ) : null}
                </TabsTrigger>
                <TabsTrigger value="report">Report</TabsTrigger>
              </TabsList>

              <TabsContent value="buy">
                {market && buy ? (
                  <BuyPanel
                    form={deal}
                    onForm={updateDeal}
                    costsPct={costsInput}
                    profitPct={profitInput}
                    onCostsPct={setCostsRaw}
                    onProfitPct={setProfitRaw}
                    market={market}
                    years={yearsLabel(report.yearFrom, report.yearTo)}
                    loading={pending}
                    analysis={buy}
                    askingUsd={askingUsd}
                  />
                ) : null}
              </TabsContent>

              <TabsContent value="sell">
                {market && sell ? (
                  <SellPanel
                    form={deal}
                    onForm={updateDeal}
                    costsPct={costsInput}
                    profitPct={profitInput}
                    onCostsPct={setCostsRaw}
                    onProfitPct={setProfitRaw}
                    market={market}
                    years={yearsLabel(report.yearFrom, report.yearTo)}
                    loading={pending}
                    analysis={sell}
                    offerUsd={offerUsd}
                  />
                ) : null}
              </TabsContent>

              <TabsContent value="b2b" className="space-y-4">
                {b2bPending ? null : (
                  <Alert className={noteTone(report.feasibility.b2bNote)}>
                    <AlertDescription className="break-words text-sm leading-relaxed">
                      {report.feasibility.b2bNote}
                    </AlertDescription>
                  </Alert>
                )}
                <a
                  href={report.links.timedealer}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex h-9 items-center gap-2 rounded-lg border border-ink/15 bg-white/70 px-3 text-sm font-medium hover:bg-muted"
                >
                  Open TimeDealer <ExternalLink className="size-4" />
                </a>
                {b2bPending ? (
                  <Card className="border-ink/10 bg-white/75 shadow-none">
                    <CardContent className="flex items-center gap-2 py-6 text-sm text-ink/70">
                      <Loader2 className="size-4 animate-spin" />
                      Loading TimeDealer quotes…
                    </CardContent>
                  </Card>
                ) : (
                  report.b2b.map((entry) => (
                    <B2BYearCard
                      key={entry.year}
                      entry={entry}
                      generatedAt={report.generatedAt}
                    />
                  ))
                )}
              </TabsContent>

              <TabsContent value="b2c" className="space-y-4">
                {b2cPending ? (
                  <Alert className="border-teal-200/80 bg-teal-50/60 text-ink">
                    <AlertDescription className="flex items-center gap-2 text-sm leading-relaxed">
                      <Loader2 className="size-4 shrink-0 animate-spin" />
                      Checking Chrono24… The Open Chrono24 links below already work.
                    </AlertDescription>
                  </Alert>
                ) : (
                  <Alert className={noteTone(report.feasibility.b2cNote)}>
                    <AlertDescription className="break-words text-sm leading-relaxed">
                      {report.feasibility.b2cNote.length > 280
                        ? `${report.feasibility.b2cNote.slice(0, 280)}…`
                        : report.feasibility.b2cNote}
                    </AlertDescription>
                  </Alert>
                )}

                {report.yearPlan.yearsToCheck.map((y) => {
                  const bucket = report.b2c.byYear[y];
                  if (!bucket) return null;
                  return (
                    <Card
                      key={y}
                      className="border-ink/10 bg-white/75 shadow-none"
                    >
                      <CardHeader>
                        <CardTitle className="text-base">
                          Chrono24 · {y}
                        </CardTitle>
                        <CardDescription>
                          Lowest world · highest world · lowest UAE (our market)
                        </CardDescription>
                      </CardHeader>
                      <CardContent className="grid gap-3 md:grid-cols-3">
                        <ListingCell
                          label="Lowest world"
                          slice={bucket.lowestWorld}
                          onManual={(listing) =>
                            updateB2c(y, "lowestWorld", listing)
                          }
                        />
                        <ListingCell
                          label="Highest world"
                          slice={bucket.highestWorld}
                          onManual={(listing) =>
                            updateB2c(y, "highestWorld", listing)
                          }
                        />
                        <ListingCell
                          label="Lowest UAE"
                          slice={bucket.lowestUae}
                          loadingNote={
                            uaePending && report.feasibility.b2cAuto
                              ? "Checking UAE sellers…"
                              : null
                          }
                          onManual={(listing) =>
                            updateB2c(y, "lowestUae", listing)
                          }
                        />
                      </CardContent>
                    </Card>
                  );
                })}

                <Card className="border-ink/10 bg-white/75 shadow-none">
                  <CardHeader>
                    <CardTitle className="text-base">Other sources</CardTitle>
                    <CardDescription>
                      Cross-check what end customers are really paying.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="flex flex-wrap gap-2">
                    {report.links.otherSources.map((s) => (
                      <a
                        key={s.name}
                        href={s.url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-ink/15 bg-background px-2.5 text-sm font-medium hover:bg-muted"
                      >
                        {s.name} <ExternalLink className="size-3.5" />
                      </a>
                    ))}
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="report">
                <Card className="border-ink/10 bg-white/80 shadow-none">
                  <CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
                    <div>
                      <CardTitle className="text-base">
                        Send-ready result
                      </CardTitle>
                      <CardDescription>
                        Matches your team template: reference, years, B2B quotes, B2C, plus market levels and any buy / sell check.
                      </CardDescription>
                    </div>
                    <Button
                      type="button"
                      onClick={() => void copyReport()}
                      className="bg-ink text-white hover:bg-ink/90"
                    >
                      {copied ? (
                        <Check className="size-4" />
                      ) : (
                        <Copy className="size-4" />
                      )}
                      {copied ? "Copied" : "Copy"}
                    </Button>
                  </CardHeader>
                  <CardContent>
                    <Textarea
                      readOnly
                      value={reportText}
                      className="min-h-[280px] font-mono text-xs leading-relaxed"
                    />
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
          </div>
        ) : null}

        <footer className="border-t border-ink/10 pt-6 text-xs text-ink/50">
          High-value watches — take your time, one reference at a time. Wrong
          dial or wrong year = wrong price.
        </footer>
      </div>
    </div>
  );
}
