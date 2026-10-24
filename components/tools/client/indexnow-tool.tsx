"use client";

import { useEffect, useState } from "react";
import { Copy, RefreshCw } from "lucide-react";
import { ToolRunner } from "../runner/tool-runner";

function newKey() {
  const a = new Uint8Array(16);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** IndexNow 提交向导:①生成密钥 ②把密钥文件放到站点根目录 ③提交 URL(服务端先验证密钥文件再转发给 api.indexnow.org) */
export function IndexNowTool() {
  const [key, setKey] = useState("");
  const [copied, setCopied] = useState(false);
  useEffect(() => { setKey(newKey()); }, []);
  return (
    <div className="space-y-4">
      <div className="rounded-3xl bg-white p-5 shadow-float">
        <p className="text-sm font-semibold text-ink">Step 1 — Your IndexNow key</p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <code className="break-all rounded-xl bg-paper-soft px-3 py-2 text-sm">{key || "…"}</code>
          <button type="button" onClick={() => navigator.clipboard.writeText(key).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1200); })} className="inline-flex items-center gap-1 rounded-lg border border-paper-dim px-2.5 py-1.5 text-xs"><Copy className="h-3.5 w-3.5" /> {copied ? "Copied" : "Copy"}</button>
          <button type="button" onClick={() => setKey(newKey())} className="inline-flex items-center gap-1 rounded-lg border border-paper-dim px-2.5 py-1.5 text-xs"><RefreshCw className="h-3.5 w-3.5" /> New key</button>
        </div>
        <p className="mt-3 text-sm font-semibold text-ink">Step 2 — Host the key</p>
        <p className="mt-1 text-sm text-ink/65">Create a plain-text file named <code className="break-all rounded bg-paper-soft px-1">{key || "your-key"}.txt</code> at the root of your site (so it opens at <code className="break-all rounded bg-paper-soft px-1">https://yoursite.com/{key || "your-key"}.txt</code>) containing only the key. Keep the same key for future submissions.</p>
      </div>
      <ToolRunner
        tool="indexnow"
        submitLabel="Submit URLs to IndexNow"
        busyText="Verifying key and submitting…"
        fields={[
          { name: "url", label: "Your site (host)", placeholder: "https://yoursite.com", type: "url" },
          { name: "urls", label: "URLs to submit (one per line, up to 100, same host)", placeholder: "https://yoursite.com/new-page\nhttps://yoursite.com/updated-page", type: "textarea" },
        ]}
        extra={{ key }}
        footnote="We check that your key file is live and matches before forwarding the list to api.indexnow.org, which shares it with Bing, Yandex, Seznam, Naver and other participating engines."
      />
    </div>
  );
}
