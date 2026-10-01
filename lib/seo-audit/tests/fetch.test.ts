/* ============================================================
   safeFetch —— node 传输层(真实 socket,本地 127.0.0.1 服务器)
   hostCheck 只在这些测试里被覆盖成"放行环回";生产默认会拒绝 127/8。
   ============================================================ */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse, type Server } from "node:http";
import { brotliCompressSync, deflateRawSync, deflateSync, gzipSync } from "node:zlib";
import { safeFetch } from "../fetch";
import { SEO_BOT_UA } from "../types";

let server: Server;
let base = "";
const hits: Record<string, number> = {};
const seenUa: string[] = [];
/** 跳转正文的服务端连接:什么时候被关掉、关之前一共写出去多少字节(复审 C10) */
type DrainWatch = { closedAt: number | null; written: number };
const drainWatch: Record<string, DrainWatch> = {};

const allowLoopback = async () => undefined;
const T = { hostCheck: allowLoopback, allowNonDefaultPort: true } as const;

function route(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? "/", "http://x");
  const p = url.pathname;
  hits[p] = (hits[p] ?? 0) + 1;
  seenUa.push(String(req.headers["user-agent"]));
  const html = (body: string | Buffer, extra: Record<string, string> = {}) => {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", ...extra });
    res.end(body);
  };
  switch (p) {
    case "/ok":
      return html("<html><body>ok</body></html>", { "x-test": "1" });
    case "/redir1":
      res.writeHead(302, { location: "/redir2" });
      return res.end();
    case "/redir2":
      res.writeHead(301, { location: `${base}/ok` });
      return res.end();
    case "/relative":
      res.writeHead(307, { location: "sub/page?x=1#frag" });
      return res.end();
    case "/sub/page":
      return html(`<html>sub ${url.search}</html>`);
    case "/loop":
      res.writeHead(301, { location: "/loop" });
      return res.end();
    case "/gzip":
      res.writeHead(200, { "content-type": "text/html", "content-encoding": "gzip" });
      return res.end(gzipSync(Buffer.from("<html>gz</html>")));
    case "/gzip-big":
      res.writeHead(200, { "content-type": "text/html", "content-encoding": "gzip" });
      return res.end(gzipSync(Buffer.alloc(200_000, 0x61)));
    case "/bomb":
      // 5 MB 的零压成几 KB:按解压后字节封顶才能挡住
      res.writeHead(200, { "content-type": "text/html", "content-encoding": "gzip" });
      return res.end(gzipSync(Buffer.alloc(5 * 1024 * 1024, 0)));
    case "/br":
      res.writeHead(200, { "content-type": "text/html", "content-encoding": "br" });
      return res.end(brotliCompressSync(Buffer.from("<html>br</html>")));
    case "/deflate":
      res.writeHead(200, { "content-type": "text/html", "content-encoding": "deflate" });
      return res.end(deflateSync(Buffer.from("<html>zlib</html>")));
    case "/deflate-raw":
      res.writeHead(200, { "content-type": "text/html", "content-encoding": "deflate" });
      return res.end(deflateRawSync(Buffer.from("<html>raw</html>")));
    case "/slow":
      return void setTimeout(() => html("<html>slow</html>"), 150);
    case "/hang":
      return; // never answers
    case "/latin":
      res.writeHead(200, { "content-type": "text/html; charset=iso-8859-1" });
      return res.end(Buffer.from([0xe9]));
    case "/head":
      res.writeHead(200, { "content-type": "image/png", "content-length": "12345" });
      return res.end(req.method === "HEAD" ? undefined : Buffer.alloc(12345));
    case "/nocontent":
      res.writeHead(204);
      return res.end();
    case "/endless-redirect": {
      // 302 + 永不结束的 chunked 正文:旧实现会在 safeFetch 返回之后继续全速收数据
      res.writeHead(302, { location: "/ok", "content-type": "text/plain" });
      const w: DrainWatch = { closedAt: null, written: 0 };
      drainWatch[p] = w;
      const chunk = Buffer.alloc(16 * 1024, 0x61);
      let closed = false;
      res.on("close", () => {
        closed = true;
        w.closedAt = Date.now();
      });
      const pump = () => {
        while (!closed && res.write(chunk)) w.written += chunk.byteLength;
        if (!closed) res.once("drain", pump);
      };
      pump();
      return;
    }
    case "/stalled-redirect": {
      // 302 + 只写 1 字节就停住:socket 空闲超时在收到响应头时就关了,旧实现会永远挂着
      res.writeHead(302, { location: "/ok", "content-type": "text/plain" });
      const w: DrainWatch = { closedAt: null, written: 1 };
      drainWatch[p] = w;
      res.on("close", () => {
        w.closedAt = Date.now();
      });
      res.write("x");
      return;
    }
    case "/small-redirect":
      res.writeHead(302, { location: "/ok", "content-type": "text/html" });
      return res.end("<html><body>Moved <a href=/ok>here</a></body></html>");
    default:
      res.writeHead(404, { "content-type": "text/plain" });
      return res.end("nope");
  }
}

before(async () => {
  server = createServer(route);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
});

after(() => {
  server.closeAllConnections?.();
  server.close();
});

test("node transport: plain response, headers, ttfbMs, UA", async () => {
  const r = await safeFetch(`${base}/ok`, T);
  assert.equal(r.status, 200);
  assert.equal(r.body, "<html><body>ok</body></html>");
  assert.equal(r.contentType, "text/html; charset=utf-8");
  assert.equal(r.headers.get("x-test"), "1");
  assert.equal(r.error, undefined);
  assert.equal(typeof r.ttfbMs, "number");
  assert.deepEqual(r.hops?.map((h) => h.status), [200]);
  assert.equal(seenUa.at(-1), SEO_BOT_UA, "our UA carries the /bot explainer link");
});

test("node transport: manual redirect loop with hops, relative Location per RFC, fragment dropped", async () => {
  const r = await safeFetch(`${base}/redir1`, T);
  assert.equal(r.status, 200);
  assert.equal(r.finalUrl, `${base}/ok`);
  assert.deepEqual(r.chain, [`${base}/redir2`, `${base}/ok`]);
  assert.deepEqual(r.hops?.map((h) => [h.status, h.location]), [
    [302, `${base}/redir2`],
    [301, `${base}/ok`],
    [200, null],
  ]);

  const rel = await safeFetch(`${base}/relative`, T);
  assert.equal(rel.status, 200);
  assert.equal(rel.finalUrl, `${base}/sub/page?x=1`);
  assert.equal(rel.body, "<html>sub ?x=1</html>");

  const loop = await safeFetch(`${base}/loop`, { ...T, maxRedirects: 3 });
  assert.equal(loop.status, 301);
  assert.match(loop.error ?? "", /Too many redirects/);
  assert.equal(loop.hops?.length, 4, "maxRedirects + 1 requests were made");
  assert.equal(loop.chain.length, 3);
});

test("node transport: streaming decompression (gzip/br/deflate/raw deflate), cap counted on decompressed bytes", async () => {
  assert.equal((await safeFetch(`${base}/gzip`, T)).body, "<html>gz</html>");
  assert.equal((await safeFetch(`${base}/br`, T)).body, "<html>br</html>");
  assert.equal((await safeFetch(`${base}/deflate`, T)).body, "<html>zlib</html>");
  assert.equal((await safeFetch(`${base}/deflate-raw`, T)).body, "<html>raw</html>");

  const big = await safeFetch(`${base}/gzip-big`, { ...T, maxBytes: 50_000 });
  assert.equal(big.status, 200);
  assert.equal(big.truncated, true);
  assert.equal(big.bytes, 50_000, "cap applies to decompressed bytes, not to the ~200-byte gzip payload");
  assert.equal(big.body.length, 50_000);
  assert.equal(big.error, undefined);

  const bomb = await safeFetch(`${base}/bomb`, { ...T, maxBytes: 100_000, timeoutMs: 5_000 });
  assert.equal(bomb.status, 200);
  assert.equal(bomb.truncated, true);
  assert.equal(bomb.bytes, 100_000);
});

test("node transport: ttfb reflects server delay; connect/first-byte and total timeouts; refused connections", async () => {
  const slow = await safeFetch(`${base}/slow`, T);
  assert.equal(slow.status, 200);
  assert.ok((slow.ttfbMs ?? 0) >= 120, `ttfbMs=${slow.ttfbMs}`);

  const hang = await safeFetch(`${base}/hang`, { ...T, timeoutMs: 400, connectTimeoutMs: 150 });
  assert.equal(hang.status, 0);
  assert.match(hang.error ?? "", /No response within 150ms|Timed out/);

  const total = await safeFetch(`${base}/hang`, { ...T, timeoutMs: 200, connectTimeoutMs: 5_000 });
  assert.equal(total.status, 0);
  assert.match(total.error ?? "", /Timed out after 200ms/);

  const closed = createServer(() => undefined);
  await new Promise<void>((r) => closed.listen(0, "127.0.0.1", r));
  const port = (closed.address() as { port: number }).port;
  await new Promise<void>((r) => closed.close(() => r()));
  const refused = await safeFetch(`http://127.0.0.1:${port}/`, T);
  assert.equal(refused.status, 0);
  assert.match(refused.error ?? "", /ECONNREFUSED/);
});

test("node transport: HEAD has no body but keeps headers; 204; charset decoding; raw bytes", async () => {
  const head = await safeFetch(`${base}/head`, { ...T, method: "HEAD" });
  assert.equal(head.status, 200);
  assert.equal(head.body, "");
  assert.equal(head.bytes, 0);
  assert.equal(head.headers.get("content-length"), "12345");
  assert.equal(head.contentType, "image/png");

  const nc = await safeFetch(`${base}/nocontent`, T);
  assert.equal(nc.status, 204);
  assert.equal(nc.body, "");

  const latin = await safeFetch(`${base}/latin`, { ...T, raw: true });
  assert.equal(latin.body, "é");
  assert.deepEqual(Array.from(latin.raw ?? []), [0xe9]);
});

test("SSRF: a lookup that resolves to a private address is refused at connection time (hostCheck NOT overridden)", async () => {
  const before = hits["/ok"] ?? 0;
  const port = new URL(base).port;
  let lookups = 0;
  const r = await safeFetch(`http://blocked.example:${port}/ok`, {
    allowNonDefaultPort: true,
    lookup: async () => {
      lookups++;
      return [{ address: "127.0.0.1", family: 4 }];
    },
  });
  assert.equal(r.status, 0);
  assert.match(r.error ?? "", /^blocked:/);
  assert.equal(lookups, 1, "resolution happened once, inside the connection");
  assert.equal(hits["/ok"] ?? 0, before, "no TCP request reached the server");

  // 混合答案:一个公网 + 一个私网 → 整个拒绝(攻击者控制 DNS 时常见)
  const mixed = await safeFetch(`http://blocked.example:${port}/ok`, {
    allowNonDefaultPort: true,
    lookup: async () => [
      { address: "93.184.216.34", family: 4 },
      { address: "10.0.0.1", family: 4 },
    ],
  });
  assert.equal(mixed.status, 0);
  assert.match(mixed.error ?? "", /^blocked:/);
  assert.equal(hits["/ok"] ?? 0, before);

  // 名字层黑名单与私网字面量在预检就挡下,连 lookup 都不会调
  const literal = await safeFetch(`http://127.0.0.1:${port}/ok`, { allowNonDefaultPort: true, lookup: async () => [{ address: "8.8.8.8", family: 4 }] });
  assert.equal(literal.status, 0);
  assert.match(literal.error ?? "", /^blocked:/);
  assert.equal(hits["/ok"] ?? 0, before);
  const named = await safeFetch("http://metadata.google.internal/", { lookup: async () => [{ address: "8.8.8.8", family: 4 }] });
  assert.match(named.error ?? "", /^blocked:/);
});

test("SSRF: https → http downgrade redirects are not followed (shared redirect loop, fetch seam)", async () => {
  const calls: string[] = [];
  const fetchImpl = (async (input: string | URL | Request) => {
    const u = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    calls.push(u);
    if (u === "https://a.test/") return new Response(null, { status: 301, headers: { location: "http://a.test/plain" } });
    return new Response("should not be fetched", { status: 200 });
  }) as typeof fetch;
  const r = await safeFetch("https://a.test/", { fetchImpl, hostCheck: allowLoopback });
  assert.equal(r.status, 301);
  assert.match(r.error ?? "", /^downgrade:/);
  assert.deepEqual(calls, ["https://a.test/"], "the http target was never requested");
  assert.deepEqual(r.hops?.map((h) => h.status), [301]);
  assert.deepEqual(r.chain, []);
});

test("node transport: non-default ports are refused unless the test seam allows them", async () => {
  const r = await safeFetch(`${base}/ok`, { hostCheck: allowLoopback });
  assert.equal(r.status, 0);
  assert.match(r.error ?? "", /Non-default port/);
});

test("C10: a redirect with an endless body does not keep streaming after safeFetch returns — the socket is closed within ~1s", async () => {
  const r = await safeFetch(`${base}/endless-redirect`, { ...T, timeoutMs: 3_000 });
  const returnedAt = Date.now();
  assert.equal(r.status, 200);
  assert.equal(r.finalUrl, `${base}/ok`);
  for (let i = 0; i < 40 && drainWatch["/endless-redirect"]?.closedAt == null; i++) await new Promise((res) => setTimeout(res, 50));
  const w = drainWatch["/endless-redirect"];
  assert.ok(w.closedAt !== null, "the redirect socket was destroyed");
  assert.ok((w.closedAt ?? Infinity) - returnedAt < 1_500, `closed ${(w.closedAt ?? 0) - returnedAt}ms after return`);
  const before = w.written;
  await new Promise((res) => setTimeout(res, 300));
  assert.equal(w.written, before, "nothing more is sent once the socket is gone");
});

test("C10: a redirect whose body stalls after 1 byte is torn down by the 1s drain limit instead of hanging forever", async () => {
  const r = await safeFetch(`${base}/stalled-redirect`, { ...T, timeoutMs: 3_000 });
  const returnedAt = Date.now();
  assert.equal(r.status, 200);
  for (let i = 0; i < 40 && drainWatch["/stalled-redirect"]?.closedAt == null; i++) await new Promise((res) => setTimeout(res, 50));
  const w = drainWatch["/stalled-redirect"];
  assert.ok(w.closedAt !== null, "the stalled redirect socket was destroyed");
  assert.ok((w.closedAt ?? Infinity) - returnedAt < 1_800, `closed ${(w.closedAt ?? 0) - returnedAt}ms after return`);
});

test("C10: a normal small redirect body is simply drained (keep-alive preserved) and HEAD/204 still work", async () => {
  const r = await safeFetch(`${base}/small-redirect`, T);
  assert.equal(r.status, 200);
  assert.equal(r.body, "<html><body>ok</body></html>");
  const head = await safeFetch(`${base}/head`, { ...T, method: "HEAD" });
  assert.equal(head.status, 200);
});
