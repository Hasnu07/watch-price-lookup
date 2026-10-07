"use client";

import { Loader2 } from "lucide-react";
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
  DEAL_CURRENCIES,
  fromUsd,
  gapPct,
  type BuyAnalysis,
  type DealCurrency,
  type MarketLevels,
  type SellAnalysis,
  type Verdict,
} from "@/lib/deal";
import { formatMoney } from "@/lib/watch-research";
import { cn } from "@/lib/utils";

export type DealForm = {
  currency: DealCurrency;
  /** Buy: what the seller asks. */
  asking: string;
  /** Buy: what our client will pay us (optional). */
  client: string;
  /** Sell: what the client offers. */
  offer: string;
  /** Sell: what we paid (optional). */
  cost: string;
};

type Common = {
  form: DealForm;
  onForm: (patch: Partial<DealForm>) => void;
  costsPct: string;
  profitPct: string;
  onCostsPct: (value: string) => void;
  onProfitPct: (value: string) => void;
  market: MarketLevels;
  years: string;
  /** Provider requests still running — numbers will move. */
  loading: boolean;
};

const fieldClass =
  "border-input bg-background h-10 w-full rounded-md border px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50";

function useFmt(currency: DealCurrency) {
  return (usd: number | null) =>
    usd === null ? "—" : formatMoney(fromUsd(usd, currency), currency);
}

function MoneyField(props: {
  id: string;
  label: string;
  value: string;
  currency: DealCurrency;
  placeholder?: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={props.id}>{props.label}</Label>
      <div className="relative">
        <Input
          id={props.id}
          inputMode="decimal"
          placeholder={props.placeholder ?? "e.g. 105,000"}
          value={props.value}
          onChange={(e) => props.onChange(e.target.value)}
          className="h-10 pr-12 tabular-nums"
        />
        <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-ink/50">
          {props.currency}
        </span>
      </div>
    </div>
  );
}

function SettingsFields(props: Common) {
  return (
    <>
      <div className="space-y-1.5">
        <Label htmlFor="deal-currency">Currency</Label>
        <select
          id="deal-currency"
          value={props.form.currency}
          onChange={(e) => props.onForm({ currency: e.target.value as DealCurrency })}
          className={fieldClass}
        >
          {DEAL_CURRENCIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="deal-costs">Costs / commission %</Label>
        <Input
          id="deal-costs"
          inputMode="decimal"
          value={props.costsPct}
          onChange={(e) => props.onCostsPct(e.target.value)}
          className="h-10 tabular-nums"
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="deal-profit">Target profit %</Label>
        <Input
          id="deal-profit"
          inputMode="decimal"
          value={props.profitPct}
          onChange={(e) => props.onProfitPct(e.target.value)}
          className="h-10 tabular-nums"
        />
      </div>
    </>
  );
}

function GapCell({ price, level, side }: { price: number | null; level: number | null; side: "buy" | "sell" }) {
  if (price === null || level === null) return <span className="text-ink/40">—</span>;
  const gap = gapPct(price, level);
  const favorable = side === "buy" ? gap <= 0 : gap >= 0;
  return (
    <span className={cn("font-medium tabular-nums", favorable ? "text-teal-800" : "text-red-700")}>
      {Math.abs(gap) < 0.05 ? "at" : `${Math.abs(gap).toFixed(1)}% ${gap < 0 ? "below" : "above"}`}
    </span>
  );
}

/** Market levels with where the user's price sits against each. */
function MarketGap({
  market,
  priceUsd,
  priceLabel,
  side,
  currency,
}: {
  market: MarketLevels;
  priceUsd: number | null;
  priceLabel: string;
  side: "buy" | "sell";
  currency: DealCurrency;
}) {
  const fmt = useFmt(currency);
  const levels = [
    { label: "Dealers · lowest", usd: market.dealerLow },
    { label: "Dealers · median", usd: market.dealerMedian },
    { label: "Dealers · highest", usd: market.dealerHigh },
    { label: "Retail · lowest (Chrono24)", usd: market.retailLow },
    { label: "Retail · lowest UAE", usd: market.retailUae },
    { label: "Retail · median", usd: market.retailMedian },
  ];
  const known = levels.filter((l): l is { label: string; usd: number } => l.usd !== null);
  const points = [...known.map((l) => l.usd), ...(priceUsd ? [priceUsd] : [])];
  const min = Math.min(...points);
  const max = Math.max(...points);
  const at = (usd: number) => (max > min ? ((usd - min) / (max - min)) * 100 : 50);

  return (
    <div className="space-y-3">
      {known.length ? (
        <div className="relative mx-2 h-9" aria-hidden>
          <div className="absolute inset-x-0 top-4 h-1 rounded-full bg-gradient-to-r from-teal-200 via-slate-200 to-amber-200" />
          {known.map((l) => (
            <div
              key={l.label}
              title={`${l.label}: ${fmt(l.usd)}`}
              className={cn(
                "absolute top-2.5 size-4 -translate-x-1/2 rounded-full border-2 border-white",
                l.label.startsWith("Dealers") ? "bg-teal-700" : "bg-amber-600",
              )}
              style={{ left: `${at(l.usd)}%` }}
            />
          ))}
          {priceUsd ? (
            <div
              title={`${priceLabel}: ${fmt(priceUsd)}`}
              className="absolute top-0 h-9 w-1 -translate-x-1/2 rounded-full bg-ink"
              style={{ left: `${at(priceUsd)}%` }}
            />
          ) : null}
        </div>
      ) : null}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[420px] text-sm">
          <thead>
            <tr className="text-left text-xs text-ink/50">
              <th className="py-1.5 pr-3 font-medium">Market level</th>
              <th className="py-1.5 pr-3 font-medium">Price</th>
              <th className="py-1.5 font-medium">{priceLabel} vs it</th>
            </tr>
          </thead>
          <tbody>
            {levels.map((l) => (
              <tr key={l.label} className="border-t border-ink/8">
                <td className="py-1.5 pr-3 text-ink/75">
                  <span
                    className={cn(
                      "mr-2 inline-block size-2 rounded-full",
                      l.label.startsWith("Dealers") ? "bg-teal-700" : "bg-amber-600",
                    )}
                  />
                  {l.label}
                </td>
                <td className="py-1.5 pr-3 tabular-nums text-ink">{fmt(l.usd)}</td>
                <td className="py-1.5">
                  <GapCell price={priceUsd} level={l.usd} side={side} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-ink/50">
        {market.dealerCount} dealer listings (TimeDealer, its USD rate) ·{" "}
        {market.retailCount} Chrono24 listings (before shipping). Shown in {currency}
        {currency === "USD" ? "" : ` at the USD peg (1 USD = ${fromUsd(1, currency)} ${currency})`}.
      </p>
    </div>
  );
}

const TONES: Record<Verdict["tone"], string> = {
  good: "border-teal-700/30 bg-teal-50 text-teal-950",
  caution: "border-amber-600/35 bg-amber-50 text-amber-950",
  bad: "border-red-600/30 bg-red-50 text-red-950",
  info: "border-ink/15 bg-white/80 text-ink",
};

/** The information bar at the end of each tab: the call, then the numbers behind it. */
function VerdictBar({
  verdict,
  figureLabel,
  figure,
}: {
  verdict: Verdict;
  figureLabel: string;
  figure: string | null;
}) {
  return (
    <div className={cn("rounded-xl border p-4 sm:p-5", TONES[verdict.tone])}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <p className="text-base font-semibold leading-snug">{verdict.headline}</p>
        {figure ? (
          <div className="shrink-0 sm:text-right">
            <p className="text-xs uppercase tracking-wide opacity-70">{figureLabel}</p>
            <p className="font-display text-2xl tabular-nums tracking-tight">{figure}</p>
          </div>
        ) : null}
      </div>
      {verdict.details.length ? (
        <ul className="mt-3 space-y-1 text-sm opacity-85">
          {verdict.details.map((d) => (
            <li key={d}>· {d}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function LoadingNote({ loading }: { loading: boolean }) {
  return loading ? (
    <p className="flex items-center gap-2 text-xs text-ink/60">
      <Loader2 className="size-3.5 animate-spin" /> Still loading market data — the numbers
      update as it lands.
    </p>
  ) : null;
}

export function BuyPanel(props: Common & { analysis: BuyAnalysis; askingUsd: number | null }) {
  const { form, onForm, market, analysis, askingUsd } = props;
  const fmt = useFmt(form.currency);
  return (
    <Card className="border-ink/10 bg-white/80 shadow-none">
      <CardHeader>
        <CardTitle className="text-base">Buy check · {props.years}</CardTitle>
        <CardDescription>
          Is the seller&apos;s price worth it? The most you can pay is the resale price minus
          your costs and profit.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <MoneyField
            id="buy-asking"
            label="Seller's asking price"
            value={form.asking}
            currency={form.currency}
            onChange={(asking) => onForm({ asking })}
          />
          <MoneyField
            id="buy-client"
            label="Your client's price (optional)"
            placeholder="If pre-sold"
            value={form.client}
            currency={form.currency}
            onChange={(client) => onForm({ client })}
          />
          <SettingsFields {...props} />
        </div>
        <LoadingNote loading={props.loading} />

        {analysis.exits.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-sm">
              <thead>
                <tr className="text-left text-xs text-ink/50">
                  <th className="py-1.5 pr-3 font-medium">If you resell by</th>
                  <th className="py-1.5 pr-3 font-medium">Sell at</th>
                  <th className="py-1.5 pr-3 font-medium">Pay at most</th>
                  <th className="py-1.5 font-medium">Profit at asking</th>
                </tr>
              </thead>
              <tbody>
                {analysis.exits.map((r) => (
                  <tr key={r.key} className="border-t border-ink/8">
                    <td className="py-2 pr-3 text-ink/75">{r.label}</td>
                    <td className="py-2 pr-3 tabular-nums">{fmt(r.exitUsd)}</td>
                    <td className="py-2 pr-3 font-semibold tabular-nums">{fmt(r.maxBuyUsd)}</td>
                    <td
                      className={cn(
                        "py-2 tabular-nums",
                        r.profitUsd === null
                          ? "text-ink/40"
                          : r.fits
                            ? "text-teal-800"
                            : "text-red-700",
                      )}
                    >
                      {r.profitUsd === null ? "—" : fmt(r.profitUsd)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}

        <MarketGap
          market={market}
          priceUsd={askingUsd}
          priceLabel="Asking"
          side="buy"
          currency={form.currency}
        />

        <VerdictBar
          verdict={analysis.verdict}
          figureLabel="Worth buying up to"
          figure={analysis.targetUsd ? fmt(analysis.targetUsd) : null}
        />
      </CardContent>
    </Card>
  );
}

export function SellPanel(props: Common & { analysis: SellAnalysis; offerUsd: number | null }) {
  const { form, onForm, market, analysis, offerUsd } = props;
  const fmt = useFmt(form.currency);
  const suggestions = [
    { label: "Quick sale to dealers", usd: analysis.dealerUsd, hint: "beat the cheapest dealer ask" },
    {
      label: market.retailUae ? "Retail price (UAE)" : "Retail price",
      usd: analysis.retailUsd,
      hint: `the cheapest ${market.retailUae ? "UAE " : ""}Chrono24 listing`,
    },
    { label: "Your floor", usd: analysis.floorUsd, hint: "cost + costs + profit" },
  ];
  const ask = Math.max(analysis.retailUsd ?? analysis.dealerUsd ?? 0, analysis.floorUsd ?? 0);
  return (
    <Card className="border-ink/10 bg-white/80 shadow-none">
      <CardHeader>
        <CardTitle className="text-base">Sell check · {props.years}</CardTitle>
        <CardDescription>
          What to ask, and whether the client&apos;s offer is good enough. Add your cost to see
          your floor and profit.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <MoneyField
            id="sell-offer"
            label="Client's offer"
            value={form.offer}
            currency={form.currency}
            onChange={(offer) => onForm({ offer })}
          />
          <MoneyField
            id="sell-cost"
            label="Your cost (optional)"
            placeholder="What you paid"
            value={form.cost}
            currency={form.currency}
            onChange={(cost) => onForm({ cost })}
          />
          <SettingsFields {...props} />
        </div>
        <LoadingNote loading={props.loading} />

        <div className="grid gap-3 sm:grid-cols-3">
          {suggestions.map((s) => (
            <div key={s.label} className="rounded-xl border border-ink/10 bg-white/70 p-3">
              <p className="text-xs text-ink/55">{s.label}</p>
              <p className="text-lg font-semibold tabular-nums text-ink">{fmt(s.usd)}</p>
              <p className="text-xs text-ink/50">{s.usd === null && s.label === "Your floor" ? "add your cost" : s.hint}</p>
            </div>
          ))}
        </div>

        <MarketGap
          market={market}
          priceUsd={offerUsd}
          priceLabel="Offer"
          side="sell"
          currency={form.currency}
        />

        <VerdictBar
          verdict={analysis.verdict}
          figureLabel="Ask around"
          figure={ask ? fmt(ask) : null}
        />
      </CardContent>
    </Card>
  );
}
