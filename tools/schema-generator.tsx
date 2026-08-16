"use client";

import { useMemo, useState } from "react";
import { Copy, Check, Plus, Trash2 } from "lucide-react";

type Kind = "Organization" | "FAQPage" | "Product";

export function SchemaGenerator() {
  const [kind, setKind] = useState<Kind>("Organization");
  const [copied, setCopied] = useState(false);

  // Organization
  const [org, setOrg] = useState({ name: "", url: "", logo: "", description: "", sameAs: "" });
  // Product
  const [product, setProduct] = useState({ name: "", description: "", brand: "", price: "", currency: "USD", url: "" });
  // FAQ
  const [faqs, setFaqs] = useState([{ q: "", a: "" }]);

  const json = useMemo(() => {
    let obj: Record<string, unknown> = {};
    if (kind === "Organization") {
      obj = {
        "@context": "https://schema.org",
        "@type": "Organization",
        name: org.name || "Your Company",
        url: org.url || undefined,
        logo: org.logo || undefined,
        description: org.description || undefined,
        sameAs: org.sameAs ? org.sameAs.split(",").map((s) => s.trim()).filter(Boolean) : undefined,
      };
    } else if (kind === "Product") {
      obj = {
        "@context": "https://schema.org",
        "@type": "Product",
        name: product.name || "Your Product",
        description: product.description || undefined,
        brand: product.brand ? { "@type": "Brand", name: product.brand } : undefined,
        url: product.url || undefined,
        offers: product.price
          ? { "@type": "Offer", price: product.price, priceCurrency: product.currency, availability: "https://schema.org/InStock" }
          : undefined,
      };
    } else {
      obj = {
        "@context": "https://schema.org",
        "@type": "FAQPage",
        mainEntity: faqs
          .filter((f) => f.q.trim() && f.a.trim())
          .map((f) => ({ "@type": "Question", name: f.q.trim(), acceptedAnswer: { "@type": "Answer", text: f.a.trim() } })),
      };
    }
    const clean = JSON.parse(JSON.stringify(obj));
    return `<script type="application/ld+json">\n${JSON.stringify(clean, null, 2)}\n</script>`;
  }, [kind, org, product, faqs]);

  async function copy() {
    await navigator.clipboard.writeText(json);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="space-y-5">
        <div className="flex gap-2">
          {(["Organization", "Product", "FAQPage"] as Kind[]).map((k) => (
            <button
              key={k}
              onClick={() => setKind(k)}
              className={`rounded-lg px-3 py-1.5 text-sm font-semibold transition ${
                kind === k ? "bg-iris text-white" : "border border-paper-dim bg-white text-ink/70 hover:border-iris/40"
              }`}
            >
              {k}
            </button>
          ))}
        </div>

        {kind === "Organization" && (
          <>
            <In label="Name" v={org.name} set={(x) => setOrg({ ...org, name: x })} ph="Acme Inc." />
            <In label="URL" v={org.url} set={(x) => setOrg({ ...org, url: x })} ph="https://acme.com" />
            <In label="Logo URL" v={org.logo} set={(x) => setOrg({ ...org, logo: x })} ph="https://acme.com/logo.png" />
            <Ta label="Description" v={org.description} set={(x) => setOrg({ ...org, description: x })} ph="What you do, for whom." />
            <In label="Social profiles (comma-separated)" v={org.sameAs} set={(x) => setOrg({ ...org, sameAs: x })} ph="https://x.com/acme, https://linkedin.com/company/acme" />
          </>
        )}

        {kind === "Product" && (
          <>
            <In label="Product name" v={product.name} set={(x) => setProduct({ ...product, name: x })} ph="Acme Pro" />
            <Ta label="Description" v={product.description} set={(x) => setProduct({ ...product, description: x })} ph="What it is and who it's for." />
            <In label="Brand" v={product.brand} set={(x) => setProduct({ ...product, brand: x })} ph="Acme" />
            <div className="grid grid-cols-2 gap-3">
              <In label="Price" v={product.price} set={(x) => setProduct({ ...product, price: x })} ph="29.00" />
              <In label="Currency" v={product.currency} set={(x) => setProduct({ ...product, currency: x })} ph="USD" />
            </div>
            <In label="URL" v={product.url} set={(x) => setProduct({ ...product, url: x })} ph="https://acme.com/pro" />
          </>
        )}

        {kind === "FAQPage" && (
          <div className="space-y-3">
            {faqs.map((f, i) => (
              <div key={i} className="rounded-xl border border-paper-dim p-3">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-xs font-semibold text-ink/50">Q{i + 1}</span>
                  <button onClick={() => setFaqs(faqs.filter((_, j) => j !== i))} className="text-ink/30 hover:text-coral">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
                <input value={f.q} onChange={(e) => setFaqs(faqs.map((x, j) => (j === i ? { ...x, q: e.target.value } : x)))} placeholder="Question" className="mb-2 w-full rounded-lg border border-paper-dim bg-white px-3 py-2 text-sm outline-none focus:border-iris" />
                <textarea value={f.a} onChange={(e) => setFaqs(faqs.map((x, j) => (j === i ? { ...x, a: e.target.value } : x)))} placeholder="Answer" rows={2} className="w-full rounded-lg border border-paper-dim bg-white px-3 py-2 text-sm outline-none focus:border-iris" />
              </div>
            ))}
            <button onClick={() => setFaqs([...faqs, { q: "", a: "" }])} className="inline-flex items-center gap-1 text-xs font-semibold text-iris">
              <Plus className="h-3.5 w-3.5" /> Add question
            </button>
          </div>
        )}
      </div>

      <div className="lg:sticky lg:top-24 lg:self-start">
        <div className="flex items-center justify-between">
          <span className="font-mono text-xs font-semibold uppercase tracking-wide text-ink/45">JSON-LD</span>
          <button onClick={copy} className="btn-primary px-3 py-1.5 text-xs">
            {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
        <pre className="mt-2 max-h-[560px] overflow-auto rounded-xl bg-ink p-4 font-mono text-xs leading-relaxed text-paper">{json}</pre>
        <p className="mt-2 text-xs text-ink/50">Paste into your page&apos;s <code className="rounded bg-paper-soft px-1">&lt;head&gt;</code>.</p>
      </div>
    </div>
  );
}

function In({ label, v, set, ph }: { label: string; v: string; set: (x: string) => void; ph?: string }) {
  return (
    <div>
      <label className="mb-1.5 block text-sm font-medium text-ink/70">{label}</label>
      <input value={v} onChange={(e) => set(e.target.value)} placeholder={ph} className="w-full rounded-xl border border-paper-dim bg-white px-4 py-2.5 text-sm outline-none transition focus:border-iris" />
    </div>
  );
}
function Ta({ label, v, set, ph }: { label: string; v: string; set: (x: string) => void; ph?: string }) {
  return (
    <div>
      <label className="mb-1.5 block text-sm font-medium text-ink/70">{label}</label>
      <textarea value={v} onChange={(e) => set(e.target.value)} placeholder={ph} rows={3} className="w-full rounded-xl border border-paper-dim bg-white px-4 py-2.5 text-sm outline-none transition focus:border-iris" />
    </div>
  );
}
