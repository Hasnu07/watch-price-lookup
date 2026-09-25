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
import { useLocalStorage } from "@/lib/use-local-storage";
import {
  MONTH_NAMES,
  formatMoney,
  formatReportText,
  releaseMonth,
  sortQuotes,
  type B2BQuote,
  type B2BYear,
  type MarketListing,
  type ResearchReport,
} from "@/lib/watch-research";
import { cn } from "@/lib/utils";

const STORAGE_KEY = "watch-price-research:reef-key";
const HISTORY_KEY = "watch-price-research:history";

export type DeepLink = {
  reference: string;
  year: string;
  month: string;
  dial: string;
  tab: "b2b" | "b2c" | "report";
  autorun: boolean;
  skipB2B: boolean;
};

type HistoryEntry = {
  reference: string;
  year: number;
  month?: number | null;
  at: string;
};

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

/** Take the Chrono24 half of a report from the B2C request. */
function withB2CFrom(report: ResearchReport, from: ResearchReport): ResearchReport {
  return {
    ...report,
    b2c: from.b2c,
    feasibility: {
      ...report.feasibility,
      b2cAuto: from.feasibility.b2cAuto,
      b2cNote: from.feasibility.b2cNote,
    },
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

function ListingCell({
  label,
  slice,
  onManual,
}: {
  label: string;
  slice: {
    searchUrl: string;
    listing: MarketListing | null;
    note?: string;
  };
  onManual: (listing: MarketListing | null) => void;
}) {
  return (
    <ListingCellInner
      key={`${label}-${slice.listing?.id ?? "empty"}-${slice.listing?.price ?? ""}`}
      label={label}
      slice={slice}
      onManual={onManual}
    />
  );
}

function ListingCellInner({
  label,
  slice,
  onManual,
}: {
  label: string;
  slice: {
    searchUrl: string;
    listing: MarketListing | null;
    note?: string;
  };
  onManual: (listing: MarketListing | null) => void;
}) {
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
        {money(slice.listing)}
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
      {slice.note ? (
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
  const [year, setYear] = useState(initial.year);
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
  const pending = b2bPending || b2cPending;
  const [tab, setTab] = useState<string>(initial.tab);
  const autoRan = useRef(false);
  const runId = useRef(0);

  const yearNum = Number(year);

  const reportText = useMemo(
    () => (report ? formatReportText(report) : ""),
    [report],
  );

  function pushHistory(ref: string, y: number, m: number | null) {
    const next: HistoryEntry[] = [
      { reference: ref, year: y, month: m, at: new Date().toISOString() },
      ...history.filter(
        (h) => !(h.reference === ref && h.year === y && (h.month ?? null) === m),
      ),
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
    const id = ++runId.current;
    const isCurrent = () => runId.current === id;
    const withDealers = !opts?.skipB2B;
    setError(null);
    setCopied(false);
    setReport(null);
    setB2bPending(withDealers);
    setB2cPending(true);

    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 65_000);
    const base = {
      reference: ref,
      year: yearNum,
      month: month ? Number(month) : null,
      dial: dial || undefined,
    };
    const errors: string[] = [];
    let recorded = false;

    // Dealer quotes (~5s) and Chrono24 (slower) load as separate requests;
    // results show as soon as either half lands.
    async function load(
      part: "b2b" | "b2c",
      body: Record<string, unknown>,
      done: (value: boolean) => void,
    ) {
      try {
        const partReport = await postResearch(body, controller.signal);
        if (!isCurrent()) return;
        setReport((prev) =>
          part === "b2b"
            ? withB2BFrom(prev ?? partReport, partReport)
            : withB2CFrom(prev ?? partReport, partReport),
        );
        if (!recorded) {
          recorded = true;
          pushHistory(partReport.reference, partReport.year, partReport.month);
        }
      } catch (e) {
        const label = part === "b2b" ? "Dealer quotes" : "Chrono24";
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
        "b2c",
        { ...base, reefApiKey: reefKey || undefined, autoFetchB2B: false },
        setB2cPending,
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
              Enter the full reference and year. The app applies your B2B / B2C
              checklist, opens the right market searches, and builds the report
              format — one watch at a time.
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
              <div className="space-y-2 lg:col-span-5">
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
                <Label htmlFor="year">Year</Label>
                <Input
                  id="year"
                  type="number"
                  min={1990}
                  max={2035}
                  value={year}
                  onChange={(e) => setYear(e.target.value)}
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
              <div className="space-y-2 lg:col-span-3">
                <Label htmlFor="dial">Dial (optional override)</Label>
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
                  disabled={pending || !reference.trim() || !yearNum}
                  className="h-11 bg-ink text-white hover:bg-ink/90"
                >
                  {pending ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Search className="size-4" />
                  )}
                  {pending ? "Researching…" : "Run price check"}
                </Button>
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
                {history.map((h) => (
                  <button
                    key={`${h.reference}-${h.year}-${h.at}`}
                    type="button"
                    onClick={() => {
                      setReference(h.reference);
                      setYear(String(h.year));
                      setMonth(h.month ? String(h.month) : "");
                    }}
                    className="rounded-full border border-ink/10 bg-white/60 px-3 py-1 text-xs text-ink/70 transition hover:border-teal-700/30 hover:text-ink"
                  >
                    {h.reference} · {h.year}
                    {h.month ? ` ${MONTH_NAMES[h.month - 1]?.slice(0, 3)}` : ""}
                  </button>
                ))}
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
                  Dial {report.dial} ·{" "}
                  {report.month
                    ? `${MONTH_NAMES[report.month - 1]} ${report.year}`
                    : report.year}
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
              <TabsList className="bg-white/60">
                <TabsTrigger value="b2b">
                  B2B · dealers
                  {b2bPending ? <Loader2 className="size-3 animate-spin" /> : null}
                </TabsTrigger>
                <TabsTrigger value="b2c">
                  B2C · Chrono24
                  {b2cPending ? <Loader2 className="size-3 animate-spin" /> : null}
                </TabsTrigger>
                <TabsTrigger value="report">Report</TabsTrigger>
              </TabsList>

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
                        Matches your team template: reference, year, B2B quotes, B2C.
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
