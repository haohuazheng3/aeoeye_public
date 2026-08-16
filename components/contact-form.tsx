"use client";

import { useState } from "react";
import { Loader2, Send, CheckCircle2 } from "lucide-react";

export function ContactForm() {
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = Object.fromEntries(new FormData(form));
    setState("sending");
    setError("");
    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || "Could not send your message.");
      }
      setState("sent");
      form.reset();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send your message.");
      setState("error");
    }
  }

  if (state === "sent") {
    return (
      <div className="card flex flex-col items-center gap-3 p-8 text-center">
        <CheckCircle2 className="h-10 w-10 text-mint" />
        <h3 className="font-display text-xl font-semibold">Message sent</h3>
        <p className="text-sm text-ink/60">Thanks — we’ll get back to you at the email you provided.</p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="card space-y-4 p-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" name="name" required />
        <Field label="Email" name="email" type="email" required />
      </div>
      <Field label="Subject" name="subject" />
      <div>
        <label htmlFor="message" className="mb-1.5 block text-sm font-medium text-ink/70">
          Message
        </label>
        <textarea
          id="message"
          name="message"
          required
          rows={5}
          className="w-full rounded-xl border border-paper-dim bg-white px-4 py-3 text-sm outline-none transition focus:border-iris"
        />
      </div>
      {state === "error" && <p className="text-sm font-medium text-coral-deep">{error}</p>}
      <button type="submit" disabled={state === "sending"} className="btn-primary w-full">
        {state === "sending" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        Send message
      </button>
    </form>
  );
}

function Field({
  label,
  name,
  type = "text",
  required,
}: {
  label: string;
  name: string;
  type?: string;
  required?: boolean;
}) {
  return (
    <div>
      <label htmlFor={name} className="mb-1.5 block text-sm font-medium text-ink/70">
        {label} {required && <span className="text-coral">*</span>}
      </label>
      <input
        id={name}
        name={name}
        type={type}
        required={required}
        className="w-full rounded-xl border border-paper-dim bg-white px-4 py-3 text-sm outline-none transition focus:border-iris"
      />
    </div>
  );
}
