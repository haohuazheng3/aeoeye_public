"use client";

import { useState } from "react";
import { Loader2, CreditCard } from "lucide-react";

export function ManageBillingButton() {
  const [loading, setLoading] = useState(false);
  async function go() {
    setLoading(true);
    try {
      const res = await fetch("/api/billing/portal", { method: "POST" });
      const data = await res.json();
      if (res.ok && data.url) window.location.href = data.url;
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }
  return (
    <button onClick={go} disabled={loading} className="btn-ghost px-4 py-2 text-sm">
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <CreditCard className="h-4 w-4" />}
      Manage billing
    </button>
  );
}
