import { runIndexer } from "./indexer.js";

const PROGRAM_ID = "2iquqTG5Frnj64kzwa5RFWawuJpXg3fYhMkTPiT22AiM";
const RPC_URL = "https://testnet.rialo.io:4101";
const MAX_IMAGE_BYTES = 350_000;
const MAX_TOTAL_IMAGE_BYTES = 2_000_000_000;

function withCors(response) {
  const headers = new Headers(response.headers);
  headers.set("access-control-allow-origin", "*");
  headers.set("access-control-allow-methods", "GET,HEAD,POST,OPTIONS");
  headers.set("access-control-allow-headers", "content-type");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

const json = (body, init = {}) => Response.json(body, {
  ...init,
  headers: { "cache-control": "no-store", ...(init.headers || {}) },
});

function requireBinding(env, name) {
  if (!env[name]) throw new Error(`${name} binding is not configured.`);
  return env[name];
}

function cleanString(value, max) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

async function imageKey(buffer, type) {
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  const hash = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  const extension = type === "image/png" ? "png" : type === "image/jpeg" ? "jpg" : "webp";
  return `tokens/${hash}.${extension}`;
}

async function handleImage(request, env, url) {
  const bucket = env.IMAGES;
  const db = requireBinding(env, "DB");
  if (request.method === "POST" && url.pathname === "/api/images") {
    const type = request.headers.get("content-type")?.split(";")[0] || "";
    if (!new Set(["image/webp", "image/png", "image/jpeg"]).has(type)) {
      return json({ error: "Only WebP, PNG and JPEG token images are accepted." }, { status: 415 });
    }
    const buffer = await request.arrayBuffer();
    if (!buffer.byteLength || buffer.byteLength > MAX_IMAGE_BYTES) {
      return json({ error: `Token image must be between 1 byte and ${MAX_IMAGE_BYTES} bytes.` }, { status: 413 });
    }
    const key = await imageKey(buffer, type);
    const existing = bucket
      ? await bucket.head(key)
      : await db.prepare("SELECT key FROM images WHERE key=?").bind(key).first();
    if (existing) return json({ key, url: `/api/images/${key}`, deduplicated: true });
    const reserved = await db.prepare("UPDATE storage_usage SET used_bytes=used_bytes+?, updated_at=? WHERE key='token_images' AND used_bytes+?<=?")
      .bind(buffer.byteLength, Date.now(), buffer.byteLength, MAX_TOTAL_IMAGE_BYTES).run();
    if (!reserved.meta?.changes) return json({ error: "The RialoFun MVP image storage cap has been reached." }, { status: 507 });
    if (bucket) {
      await bucket.put(key, buffer, { httpMetadata: { contentType: type, cacheControl: "public, max-age=31536000, immutable" } });
    } else {
      await db.prepare("INSERT INTO images (key,content_type,body,size_bytes,created_at) VALUES (?,?,?,?,?)")
        .bind(key, type, buffer, buffer.byteLength, Date.now()).run();
    }
    return json({ key, url: `/api/images/${key}` }, { status: 201 });
  }
  if (request.method === "GET" && url.pathname.startsWith("/api/images/")) {
    const key = decodeURIComponent(url.pathname.slice("/api/images/".length));
    if (!key.startsWith("tokens/") || key.includes("..")) return new Response("Not found", { status: 404 });
    if (bucket) {
      const object = await bucket.get(key);
      if (!object) return new Response("Not found", { status: 404 });
      const headers = new Headers();
      object.writeHttpMetadata(headers);
      headers.set("etag", object.httpEtag);
      headers.set("cache-control", "public, max-age=31536000, immutable");
      return new Response(object.body, { headers });
    }
    // D1's BLOB values are not reliable as a Response body when returned
    // directly. Read the bytes as hex so the edge runtime preserves them.
    const object = await db.prepare("SELECT content_type AS contentType,hex(body) AS encoded FROM images WHERE key=?").bind(key).first();
    if (!object?.encoded) return new Response("Not found", { status: 404 });
    const bytes = new Uint8Array(object.encoded.length / 2);
    for (let index = 0; index < bytes.length; index += 1) bytes[index] = Number.parseInt(object.encoded.slice(index * 2, index * 2 + 2), 16);
    return new Response(bytes, { headers: { "content-type": object.contentType, "content-length": String(bytes.byteLength), "cache-control": "public, max-age=31536000, immutable" } });
  }
  return null;
}

async function handleMetadata(request, env) {
  const db = requireBinding(env, "DB");
  if (request.method === "GET") {
    const { results } = await db.prepare(`WITH
      volumes AS (
        SELECT market_id, SUM(rlo_amount) AS volume_rlo
        FROM trades WHERE verified=1 GROUP BY market_id
      ),
      balances AS (
        SELECT market_id, account,
          SUM(CASE WHEN side='BUY' THEN token_amount ELSE -token_amount END) AS balance
        FROM trades WHERE verified=1 AND token_amount IS NOT NULL
        GROUP BY market_id, account
      ),
      holder_counts AS (
        SELECT market_id, COUNT(*) AS holders FROM balances WHERE balance>0 GROUP BY market_id
      )
      SELECT m.id,m.state,m.mint,m.name,m.ticker,m.creator,m.image_url AS image,
        m.created_at AS createdAt,m.updated_at AS updatedAt,
        s.phase,s.virtual_rlo AS virtualRlo,s.token_reserve AS tokenReserve,
        s.actual_rlo AS actualRlo,
        COALESCE(v.volume_rlo,0) AS volumeRlo,
        COALESCE(h.holders,0) AS holders
      FROM markets m
      LEFT JOIN market_snapshots s ON s.state=m.state
      LEFT JOIN volumes v ON v.market_id=m.id
      LEFT JOIN holder_counts h ON h.market_id=m.id
      ORDER BY m.updated_at DESC LIMIT 500`).all();
    return json({ markets: results }, { headers: { "cache-control": "public, max-age=15" } });
  }
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const body = await request.json();
  const market = {
    id: cleanString(body.id, 96), state: cleanString(body.state, 64), mint: cleanString(body.mint, 64),
    name: cleanString(body.name, 64), ticker: cleanString(body.ticker, 12).toUpperCase(),
    creator: cleanString(body.creator, 64), image: cleanString(body.image, 512),
    createdAt: Number(body.createdAt) || Date.now(),
  };
  if (!market.id || !market.state || !market.mint || !market.name || !market.ticker || !market.image.startsWith("/api/images/tokens/")) {
    return json({ error: "Complete on-chain market metadata and a stored token image are required." }, { status: 400 });
  }
  const existing = await db.prepare("SELECT id FROM markets WHERE state=?").bind(market.state).first();
  if (existing && existing.id !== market.id) {
    await db.batch([
      db.prepare("UPDATE markets SET id=?,mint=?,name=?,ticker=?,creator=?,image_url=?,created_at=?,updated_at=? WHERE state=?").bind(market.id, market.mint, market.name, market.ticker, market.creator, market.image, market.createdAt, Date.now(), market.state),
      db.prepare("UPDATE trades SET market_id=? WHERE market_id=?").bind(market.id, market.id === existing.id ? market.id : existing.id),
    ]);
  } else {
    await db.prepare(`INSERT INTO markets (id,state,mint,name,ticker,creator,image_url,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET state=excluded.state,mint=excluded.mint,name=excluded.name,ticker=excluded.ticker,creator=excluded.creator,image_url=excluded.image_url,updated_at=excluded.updated_at`)
      .bind(market.id, market.state, market.mint, market.name, market.ticker, market.creator, market.image, market.createdAt, Date.now()).run();
  }
  return json({ market }, { status: 201 });
}

async function handleTrades(request, env, url) {
  const db = requireBinding(env, "DB");
  if (request.method === "POST" && url.pathname === "/api/trades") {
    const body = await request.json();
    const trade = {
      marketId: cleanString(body.marketId, 96), signature: cleanString(body.signature, 128),
      side: cleanString(body.side, 4).toUpperCase(), account: cleanString(body.account, 64),
      rloAmount: Number(body.rloAmount), tokenAmount: body.tokenAmount == null ? null : Number(body.tokenAmount),
      price: Number(body.price), time: Number(body.time) || Date.now(),
    };
    if (!trade.marketId || !trade.signature || !trade.account || !["BUY", "SELL"].includes(trade.side) || !Number.isFinite(trade.rloAmount) || !Number.isFinite(trade.price)) {
      return json({ error: "Invalid confirmed trade payload." }, { status: 400 });
    }
    await db.batch([
      db.prepare(`INSERT INTO trades (signature,market_id,account,side,rlo_amount,token_amount,price,block_time,verified)
        VALUES (?,?,?,?,?,?,?,?,0) ON CONFLICT(signature) DO UPDATE SET rlo_amount=excluded.rlo_amount,token_amount=excluded.token_amount,price=excluded.price,block_time=excluded.block_time`)
        .bind(trade.signature, trade.marketId, trade.account, trade.side, trade.rloAmount, trade.tokenAmount, trade.price, trade.time),
      db.prepare("UPDATE markets SET updated_at=? WHERE id=?").bind(trade.time, trade.marketId),
    ]);
    return json({ trade }, { status: 201 });
  }
  const match = url.pathname.match(/^\/api\/markets\/([^/]+)\/trades$/);
  if (request.method === "GET" && match) {
    let marketId = decodeURIComponent(match[1]);
    const state = cleanString(url.searchParams.get("state"), 64);
    if (state) {
      const alias = await db.prepare("SELECT id FROM markets WHERE id=? OR state=?").bind(marketId, state).first();
      if (alias?.id) marketId = alias.id;
    }
    const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 100, 1), 500);
    const { results } = await db.prepare(`SELECT signature,market_id AS marketId,account,side,rlo_amount AS rloAmount,token_amount AS tokenAmount,price,block_time AS time,verified
      FROM trades WHERE market_id=? AND verified=1 ORDER BY block_time DESC LIMIT ?`).bind(marketId, limit).all();
    return json({ trades: results }, { headers: { "cache-control": "public, max-age=10" } });
  }
  const holderMatch = url.pathname.match(/^\/api\/markets\/([^/]+)\/holders$/);
  if (request.method === "GET" && holderMatch) {
    let marketId = decodeURIComponent(holderMatch[1]);
    const alias = await db.prepare("SELECT id FROM markets WHERE id=? OR state=?").bind(marketId, url.searchParams.get("state") || "").first();
    if (alias?.id) marketId = alias.id;
    const { results } = await db.prepare(`SELECT account,
      COALESCE(SUM(CASE WHEN side='BUY' THEN token_amount ELSE -token_amount END),0) AS balance
      FROM trades WHERE market_id=? AND verified=1 AND token_amount IS NOT NULL GROUP BY account
      HAVING balance > 0 ORDER BY balance DESC LIMIT 500`).bind(marketId).all();
    return json({ holders: results }, { headers: { "cache-control": "public, max-age=15" } });
  }
  const candleMatch = url.pathname.match(/^\/api\/markets\/([^/]+)\/candles$/);
  if (request.method === "GET" && candleMatch) {
    let marketId = decodeURIComponent(candleMatch[1]);
    const alias = await db.prepare("SELECT id FROM markets WHERE id=? OR state=?").bind(marketId, url.searchParams.get("state") || "").first();
    if (alias?.id) marketId = alias.id;
    const interval = Math.min(Math.max(Number(url.searchParams.get("interval")) || 300000, 60000), 86400000);
    const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 200, 1), 500);
    const { results } = await db.prepare(`SELECT CAST(block_time / ? AS INTEGER) * ? AS time,
      MIN(price) AS low, MAX(price) AS high,
      (SELECT price FROM trades t2 WHERE t2.market_id=t.market_id AND t2.verified=1 AND CAST(t2.block_time / ? AS INTEGER)=CAST(t.block_time / ? AS INTEGER) ORDER BY t2.block_time ASC LIMIT 1) AS open,
      (SELECT price FROM trades t3 WHERE t3.market_id=t.market_id AND t3.verified=1 AND CAST(t3.block_time / ? AS INTEGER)=CAST(t.block_time / ? AS INTEGER) ORDER BY t3.block_time DESC LIMIT 1) AS close,
      COUNT(*) AS volume
      FROM trades t WHERE market_id=? AND verified=1 GROUP BY CAST(block_time / ? AS INTEGER) ORDER BY time DESC LIMIT ?`)
      .bind(interval, interval, interval, interval, interval, interval, marketId, interval, limit).all();
    return json({ candles: results.reverse() }, { headers: { "cache-control": "public, max-age=10" } });
  }
  return null;
}

async function handleOnchainMarkets() {
  const rpc = await fetch(RPC_URL, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getAccountsByOwner", params: [{ owner: PROGRAM_ID, filter: { type: "programAccounts" } }] }),
  });
  if (!rpc.ok) return json({ error: "Rialo RPC unavailable" }, { status: 502 });
  const payload = await rpc.json();
  const entries = payload.result?.[0] ?? [];
  const markets = entries.flatMap((entry) => {
    const account = entry.account;
    if (!account || account.data?.[1] !== "base64") return [];
    const bytes = Uint8Array.from(atob(account.data[0]), (char) => char.charCodeAt(0));
    if (bytes.length !== 128 || bytes[0] !== 1) return [];
    const read = (offset) => { let value = 0n; for (let index = offset + 15; index >= offset; index -= 1) value = (value << 8n) | BigInt(bytes[index]); return value.toString(); };
    return [{ state: entry.pubkey, phase: bytes[3] === 1 ? "pool" : "curve", virtualRloKelvin: read(40), tokenReserveBaseUnits: read(56), soldBaseUnits: read(72), actualRloKelvin: read(88), feesKelvin: read(104) }];
  });
  return json({ program: PROGRAM_ID, markets, fetchedAt: new Date().toISOString() }, { headers: { "cache-control": "public, max-age=10" } });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    try {
      if (request.method === "OPTIONS") return withCors(new Response(null, { status: 204 }));
      if (url.pathname === "/api/health") return withCors(json({ ok: true, storage: Boolean(env.DB), imageStore: env.IMAGES ? "r2" : env.DB ? "d1" : null }));
      if (url.pathname === "/api/markets" && request.method === "GET") {
        ctx.waitUntil(runIndexer(env).catch(() => undefined));
        return withCors(await handleOnchainMarkets());
      }
      if (url.pathname === "/api/metadata") {
        if (request.method === "GET") ctx.waitUntil(runIndexer(env).catch(() => undefined));
        return withCors(await handleMetadata(request, env));
      }
      if (url.pathname === "/api/images" || url.pathname.startsWith("/api/images/")) return withCors(await handleImage(request, env, url) || new Response("Not found", { status: 404 }));
      if (url.pathname === "/api/trades" || /\/api\/markets\/[^/]+\/trades$/.test(url.pathname) || /\/api\/markets\/[^/]+\/(holders|candles)$/.test(url.pathname)) return withCors(await handleTrades(request, env, url) || new Response("Not found", { status: 404 }));
    } catch (error) {
      return withCors(json({ error: error instanceof Error ? error.message : "RialoFun API failed." }, { status: 503 }));
    }
    const response = await env.ASSETS.fetch(request);
    const acceptsHtml = request.headers.get("accept")?.includes("text/html");
    if (response.status !== 404 || !acceptsHtml || !["GET", "HEAD"].includes(request.method)) return withCors(response);
    const indexUrl = new URL(request.url);
    indexUrl.pathname = "/index.html";
    indexUrl.search = "";
    return withCors(await env.ASSETS.fetch(new Request(indexUrl, request)));
  },
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(runIndexer(env));
  },
};
