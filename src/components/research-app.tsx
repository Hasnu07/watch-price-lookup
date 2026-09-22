"use client";

import { useMemo, useState } from "react";
import {
  AlertCircle,
  Check,
  Copy,
  ExternalLink,
  Loader2,
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  MONTH_NAMES,
  formatReportText,
  type B2BEntry,
  type MarketListing,
  type ResearchReport,
} from "@/lib/watch-research";
import { cn } from "@/lib/utils";

const STORAGE_KEY = "watch-price-research:reef-key";
const HISTORY_KEY = "watch-price-research:history";

function money(listing: MarketListing | null | undefined): string {
  if (!listing) return "—";
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: listing.currency || "USD",
      maximumFractionDigits: 0,
    }).format(listing.price);
  } catch {
    return `${listing.price.toLocaleString()} ${listing.currency}`;
  }
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

export function ResearchApp() {
  const [reference, setReference] = useState("");
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [month, setMonth] = useState<string>("");
  const [dial, setDial] = useState("");
  const [reefKey, setReefKey] = useState(() => {
    if (typeof window === "undefined") return "";
    try {
      return localStorage.getItem(STORAGE_KEY) || "";
    } catch {
      return "";
    }
  });
  const [showSettings, setShowSettings] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<ResearchReport | null>(null);
  const [copied, setCopied] = useState(false);
  const [history, setHistory] = useState<
    { reference: string; year: number; at: string }[]
  >(() => {
    if (typeof window === "undefined") return [];
    try {
      const raw = localStorage.getItem(HISTORY_KEY);
      return raw
        ? (JSON.parse(raw) as { reference: string; year: number; at: string }[])
        : [];
    } catch {
      return [];
    }
  });
  const [pending, setPending] = useState(false);

  const yearNum = Number(year);
  const needsMonth = yearNum === 2026;

  const reportText = useMemo(
    () => (report ? formatReportText(report) : ""),
    [report],
  );

  function persistKey(value: string) {
    setReefKey(value);
    try {
      localStorage.setItem(STORAGE_KEY, value);
    } catch {
      /* ignore */
    }
  }

  function pushHistory(ref: string, y: number) {
    const next = [
      { reference: ref, year: y, at: new Date().toISOString() },
      ...history.filter((h) => !(h.reference === ref && h.year === y)),
    ].slice(0, 12);
    setHistory(next);
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  }

  function updateB2b(index: number, patch: Partial<B2BEntry>) {
    setReport((prev) => {
      if (!prev) return prev;
      const b2b = prev.b2b.map((row, i) =>
        i === index ? { ...row, ...patch } : row,
      );
      return { ...prev, b2b };
    });
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

  async function runResearch() {
    if (needsMonth && !month) {
      setError("Month is required for 2026 watches.");
      return;
    }
    setError(null);
    setCopied(false);
    setPending(true);
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 70_000);
    try {
      const res = await fetch("/api/research", {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          reference,
          year: yearNum,
          month: needsMonth && month ? Number(month) : month ? Number(month) : null,
          dial: dial || undefined,
          reefApiKey: reefKey || undefined,
          autoFetchB2C: true,
        }),
      });
      const data = (await res.json()) as {
        report?: ResearchReport;
        error?: string;
      };
      if (!res.ok || !data.report) {
        setError(data.error || "Research failed");
        return;
      }
      setReport(data.report);
      pushHistory(data.report.reference, data.report.year);
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") {
        setError(
          "Research timed out after 70s. Retry, or use Open Chrono24 links for B2C.",
        );
      } else {
        setError(e instanceof Error ? e.message : "Network error");
      }
    } finally {
      window.clearTimeout(timer);
      setPending(false);
    }
  }

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
                  onChange={(e) => persistKey(e.target.value)}
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
                <Label htmlFor="month">
                  Month {needsMonth ? "(required for 2026)" : "(optional)"}
                </Label>
                <Select
                  value={month || "none"}
                  onValueChange={(v) => {
                    const next = v ?? "none";
                    setMonth(next === "none" ? "" : next);
                  }}
                >
                  <SelectTrigger id="month" className="h-11 w-full">
                    <SelectValue placeholder="—" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">—</SelectItem>
                    {MONTH_NAMES.map((name, i) => (
                      <SelectItem key={name} value={String(i + 1)}>
                        {name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
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
                  disabled={
                    pending ||
                    !reference.trim() ||
                    !yearNum ||
                    (needsMonth && !month)
                  }
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
                    Checking TimeDealer + Chrono24 — usually under 45s. Stops at 70s.
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
                    }}
                    className="rounded-full border border-ink/10 bg-white/60 px-3 py-1 text-xs text-ink/70 transition hover:border-teal-700/30 hover:text-ink"
                  >
                    {h.reference} · {h.year}
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
                  {report.year === 2026 && report.month
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
                  B2B {report.feasibility.b2bAuto ? "auto" : "manual"}
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

            <Tabs defaultValue="b2b" className="gap-4">
              <TabsList className="bg-white/60">
                <TabsTrigger value="b2b">B2B · dealers</TabsTrigger>
                <TabsTrigger value="b2c">B2C · Chrono24</TabsTrigger>
                <TabsTrigger value="report">Report</TabsTrigger>
              </TabsList>

              <TabsContent value="b2b" className="space-y-4">
                <Card className="border-ink/10 bg-white/75 shadow-none">
                  <CardHeader>
                    <CardTitle className="text-base">Dealer market</CardTitle>
                    <CardDescription>
                      {report.feasibility.b2bAuto
                        ? "Auto-filled from TimeDealer forsale quotes for each comparison year. Edit if a group quote looks better. HKD stays HKD."
                        : "Log into TimeDealer, then enter dealer quotes below. If a quote is in HKD, keep it in HKD — do not convert."}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <a
                      href={report.links.timedealer}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex h-9 items-center gap-2 rounded-lg border border-ink/15 bg-background px-3 text-sm font-medium hover:bg-muted"
                    >
                      Open TimeDealer <ExternalLink className="size-4" />
                    </a>
                    <Separator />
                    <div className="space-y-4">
                      {report.b2b.map((row, index) => (
                        <div
                          key={`${row.year}-${index}`}
                          className="grid gap-3 rounded-xl border border-ink/8 p-4 sm:grid-cols-2 lg:grid-cols-6"
                        >
                          <div className="lg:col-span-1">
                            <p className="text-xs uppercase tracking-wide text-muted-foreground">
                              Year
                            </p>
                            <p className="font-medium">
                              {row.year}
                              {row.year === 2026 && row.month
                                ? ` / ${String(row.month).padStart(2, "0")}`
                                : ""}
                            </p>
                          </div>
                          <div className="space-y-1 lg:col-span-1">
                            <Label>Price</Label>
                            <Input
                              value={row.price}
                              onChange={(e) =>
                                updateB2b(index, { price: e.target.value })
                              }
                              placeholder="e.g. 185000"
                            />
                          </div>
                          <div className="space-y-1 lg:col-span-1">
                            <Label>Currency</Label>
                            <Input
                              value={row.currency}
                              onChange={(e) =>
                                updateB2b(index, {
                                  currency: e.target.value.toUpperCase(),
                                })
                              }
                              placeholder="USD / HKD / AED"
                            />
                          </div>
                          <div className="space-y-1 lg:col-span-1">
                            <Label>Source</Label>
                            <Input
                              value={row.source}
                              onChange={(e) =>
                                updateB2b(index, { source: e.target.value })
                              }
                              placeholder="timedealer / group"
                            />
                          </div>
                          <div className="space-y-1 sm:col-span-2 lg:col-span-2">
                            <Label>Notes</Label>
                            <Input
                              value={row.notes || ""}
                              onChange={(e) =>
                                updateB2b(index, { notes: e.target.value })
                              }
                              placeholder="Freshness, papers, group name…"
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="b2c" className="space-y-4">
                {report.feasibility.notes.map((n) => (
                  <Alert
                    key={n.slice(0, 80)}
                    className={
                      /timed out|unavailable|error|failed|HTTP/i.test(n)
                        ? "border-red-200/80 bg-red-50/70 text-ink"
                        : "border-teal-200/80 bg-teal-50/60 text-ink"
                    }
                  >
                    <AlertDescription className="break-words text-sm leading-relaxed">
                      {n.length > 280 ? `${n.slice(0, 280)}…` : n}
                    </AlertDescription>
                  </Alert>
                ))}

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
                        Matches your team template: reference, year, B2B, B2C.
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
