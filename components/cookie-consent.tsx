"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

const KEY = "aeoeye-cookie-consent";

export function CookieConsent() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    try {
      if (!localStorage.getItem(KEY)) setShow(true);
    } catch {
      /* ignore */
    }
  }, []);

  function decide(value: "accepted" | "rejected") {
    try {
      localStorage.setItem(KEY, value);
    } catch {
      /* ignore */
    }
    setShow(false);
  }

  if (!show) return null;

  return (
    <div className="fixed inset-x-3 bottom-3 z-[90] mx-auto max-w-xl rounded-2xl border border-paper-dim bg-white/95 p-4 shadow-card backdrop-blur sm:inset-x-auto sm:right-4">
      <p className="text-sm text-ink/70">
        We use privacy-friendly analytics to improve AEOeye. See our{" "}
        <Link href="/cookies" className="font-medium text-iris link-underline">
          cookie policy
        </Link>
        .
      </p>
      <div className="mt-3 flex gap-2">
        <button onClick={() => decide("accepted")} className="btn-primary px-4 py-2 text-xs">
          Accept
        </button>
        <button onClick={() => decide("rejected")} className="btn-ghost px-4 py-2 text-xs">
          Decline
        </button>
      </div>
    </div>
  );
}
