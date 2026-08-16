"use client";

import { useMemo, useState } from "react";
import { TrendingUp, DollarSign, AlertTriangle } from "lucide-react";

function num(v: string): number {
  const n = parseFloat(v.replace(/[,$%\s]/g, ""));
  return Number.isFinite(n) && n >= 0 ? n : 0;
}
function fmt(n: number, dec = 0): string {
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("en-US", { maximumFractionDigits: dec, minimumFractionDigits: 0 });
}

export function SeoRoiCalculator() {
  const [visits, setVisits] = useState("5000");
  const [growth, setGrowth] = useState("30");
  const [convRate, setConvRate] = useState("2");
  const [avgValue, setAvgValue] = useState("200");
  const [monthlyCost, setMonthlyCost] = useState("1500");
  const [zeroClick, setZeroClick] = useState("20");

  const r = useMemo(() => {
    const v = num(visits);
    const g = num(growth) / 100;
    const cr = num(convRate) / 100;
    const av = num(avgValue);
    const cost = num(monthlyCost);
    const zc = Math.min(num(zeroClick), 95) / 100;

    const extraVisitsRaw = v * g;
    const extraVisits = extraVisitsRaw * (1 - zc);
    const extraConversions = extraVisits * cr;
    const extraRevenue = extraConversions * av;
    const roiPct = cost > 0 ? ((extraRevenue - cost) / cost) * 100 : NaN;
    const breakevenVisits = cr > 0 && av > 0 ? cost / (cr * av) : NaN;
    const annualNet = (extraRevenue - cost) * 12;
    return { extraVisits, extraConversions, extraRevenue, roiPct, breakevenVisits, annualNet, cost };
  }, [visits, growth, convRate, avgValue, monthlyCost, zeroClick]);

  const field = (label: string, v: string, set: (s: string) => void, suffix: string, hint?: string) => (
    <div>
      <label className="mb-1.5 block text-sm font-medium text-ink/70">{label}</label>
      <div className="flex items-center gap-2">
        <input
          value={v}
          onChange={(e) => set(e.target.value)}
          inputMode="decimal"
          className="w-full rounded-xl border border-paper-dim bg-white px-4 py-2.5 text-sm outline-none transition focus:border-iris"
        />
        <span className="w-14 shrink-0 text-sm text-ink/45">{suffix}</span>
      </div>
      {hint && <p className="mt-1 text-xs text-ink/40">{hint}</p>}
    </div>
  );

  const positive = Number.isFinite(r.roiPct) && r.roiPct >= 0;

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="space-y-4">
        {field("Current monthly organic visits", visits, setVisits, "visits")}
        {field("Expected traffic growth from SEO", growth, setGrowth, "%", "A realistic 6–12 month target. Be conservative.")}
        {field("Visitor → customer conversion rate", convRate, setConvRate, "%")}
        {field("Average value per conversion", avgValue, setAvgValue, "$", "Order value, deal size, or lifetime value per customer.")}
        {field("Monthly SEO investment", monthlyCost, setMonthlyCost, "$/mo", "Agency retainer, tools, or the cost of in-house hours.")}
        {field("Zero-click discount (AI Overviews)", zeroClick, setZeroClick, "%", "Share of new impressions answered on the results page without a click. 15–30% is a cautious 2026 assumption for informational topics.")}
      </div>

      <div className="space-y-4">
        <div className="rounded-xl border border-paper-dim bg-white p-5">
          <div className="flex items-center gap-2 text-sm font-semibold text-ink/60">
            <TrendingUp className="h-4 w-4 text-iris" /> Monthly outcome
          </div>
          <dl className="mt-4 space-y-3 text-sm">
            <div className="flex justify-between"><dt className="text-ink/55">Extra visits (after zero-click discount)</dt><dd className="font-semibold">{fmt(r.extraVisits)}</dd></div>
            <div className="flex justify-between"><dt className="text-ink/55">Extra conversions</dt><dd className="font-semibold">{fmt(r.extraConversions, 1)}</dd></div>
            <div className="flex justify-between"><dt className="text-ink/55">Extra revenue</dt><dd className="font-semibold">${fmt(r.extraRevenue)}</dd></div>
            <div className="flex justify-between"><dt className="text-ink/55">SEO cost</dt><dd className="font-semibold">−${fmt(r.cost)}</dd></div>
          </dl>
        </div>

        <div className={`rounded-xl border p-5 ${positive ? "border-iris/30 bg-iris/5" : "border-coral/30 bg-coral/5"}`}>
          <div className="flex items-center gap-2 text-sm font-semibold text-ink/60">
            <DollarSign className="h-4 w-4 text-iris" /> ROI
          </div>
          <p className="mt-2 font-display text-3xl font-semibold">
            {Number.isFinite(r.roiPct) ? `${r.roiPct >= 0 ? "+" : ""}${fmt(r.roiPct)}%` : "—"}
            <span className="ml-2 text-sm font-normal text-ink/45">per month</span>
          </p>
          <p className="mt-2 text-sm text-ink/60">
            12-month net: <strong>{Number.isFinite(r.annualNet) ? `${r.annualNet < 0 ? "−" : ""}$${fmt(Math.abs(r.annualNet))}` : "—"}</strong>
          </p>
          <p className="mt-2 text-xs text-ink/45">
            Break-even: ~{fmt(r.breakevenVisits)} extra converting visits/month at your current conversion rate and value.
          </p>
        </div>

        <div className="flex items-start gap-2 rounded-xl border border-paper-dim bg-white p-4 text-xs text-ink/50">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink/35" />
          <p>
            Estimates only — real ROI depends on which keywords you win, their intent, and how AI answers reshape clicks in
            your niche. This model applies your inputs; it doesn&rsquo;t predict rankings.
          </p>
        </div>
      </div>
    </div>
  );
}
