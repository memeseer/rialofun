import { runIndexer } from "./indexer.js";

const PROGRAM_ID = "2iquqTG5Frnj64kzwa5RFWawuJpXg3fYhMkTPiT22AiM";
const RPC_URL = "https://testnet.rialo.io:4101";
const MAX_IMAGE_BYTES = 350_000;
const MAX_TOTAL_IMAGE_BYTES = 2_000_000_000;
const ALLOWED_ORIGINS = new Set(["https://rialofun.xyz", "https://www.rialofun.xyz", "https://testnet.rialofun.xyz", "https://www.testnet.rialofun.xyz"]);
const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function withCors(response, request) {
  const headers = new Headers(response.headers);
  const origin = request?.headers.get("origin");
  if (origin && ALLOWED_ORIGINS.has(origin)) headers.set("access-control-allow-origin", origin);
  headers.set("vary", "Origin");
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

async function enforceRateLimit(request, env, scope, max, windowMs = 60 * 60_000) {
  const ip = request.headers.get("cf-connecting-ip") || "unknown";
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${scope}:${ip}`)));
  const key = [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  const windowStart = Math.floor(Date.now() / windowMs) * windowMs;
  const result = await env.DB.prepare(`INSERT INTO api_rate_limits (bucket,window_start,request_count) VALUES (?,?,1)
    ON CONFLICT(bucket,window_start) DO UPDATE SET request_count=request_count+1 WHERE request_count<?`)
    .bind(key, windowStart, max).run();
  if (Number.parseInt(key.at(-1), 16) === 0) await env.DB.prepare("DELETE FROM api_rate_limits WHERE window_start<?").bind(windowStart - 48 * 60 * 60_000).run();
  return Boolean(result.meta?.changes);
}

function validImageBytes(bytes, type) {
  if (type === "image/png") return bytes.length >= 8 && [137,80,78,71,13,10,26,10].every((byte, i) => bytes[i] === byte);
  if (type === "image/jpeg") return bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  return bytes.length >= 12 && bytes[0] === 82 && bytes[1] === 73 && bytes[2] === 70 && bytes[3] === 70 && bytes[8] === 87 && bytes[9] === 69 && bytes[10] === 66 && bytes[11] === 80;
}

function decodeBase58(value) {
  let number = 0n;
  for (const char of value) { const digit = BASE58.indexOf(char); if (digit < 0) return new Uint8Array(); number = number * 58n + BigInt(digit); }
  const bytes = [];
  while (number) { bytes.unshift(Number(number & 255n)); number >>= 8n; }
  for (let i = 0; i < value.length && value[i] === "1"; i += 1) bytes.unshift(0);
  return Uint8Array.from(bytes);
}

function metadataMessage(market) {
  return JSON.stringify(["RialoFun metadata authorization v1", market.id, market.state, market.mint, market.creator,
    market.launchSignature, market.name, market.ticker, market.image, market.description, market.website, market.twitter, market.createdAt]);
}

async function verifyMetadataSignature(market, signature) {
  const publicKey = decodeBase58(market.creator);
  let signatureBytes;
  try { signatureBytes = Uint8Array.from(atob(signature), (character) => character.charCodeAt(0)); } catch { return false; }
  if (publicKey.length !== 32 || signatureBytes.length !== 64) return false;
  try {
    const key = await crypto.subtle.importKey("raw", publicKey, { name: "Ed25519" }, false, ["verify"]);
    return crypto.subtle.verify("Ed25519", key, signatureBytes, new TextEncoder().encode(metadataMessage(market)));
  } catch { return false; }
}

async function verifyLaunchOnchain(market) {
  const rpc = async (method, params) => {
    const response = await fetch(RPC_URL, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
    if (!response.ok) return null;
    return (await response.json()).result;
  };
  const tx = await rpc("getTransaction", [{ signature: market.launchSignature }]);
  if (!tx || tx.meta?.err) return false;
  const keys = (tx.transaction?.message?.accountKeys || []).map((item) => typeof item === "string" ? item : item.pubkey);
  const launched = (tx.transaction?.message?.instructions || []).some((instruction) => {
    if (keys[instruction.programIdIndex] !== PROGRAM_ID) return false;
    const bytes = decodeBase58(instruction.data || "");
    const accounts = instruction.accounts || [];
    return bytes[0] === 0 && keys[accounts[0]] === market.state && keys[accounts[1]] === market.creator && keys[accounts[2]] === market.mint;
  });
  if (!launched) return false;
  const account = (await rpc("getAccountInfo", [{ address: market.state }]))?.value;
  if (account?.owner !== PROGRAM_ID || account.data?.[1] !== "base64") return false;
  const bytes = Uint8Array.from(atob(account.data[0]), (character) => character.charCodeAt(0));
  const mintBytes = decodeBase58(market.mint);
  return bytes.length === 128 && bytes[0] === 1 && mintBytes.length === 32 && bytes.slice(8, 40).every((byte, index) => byte === mintBytes[index]);
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
    if (!await enforceRateLimit(request, env, "image-upload", 30)) return json({ error: "Image upload limit reached. Try again later." }, { status: 429 });
    if (Number(request.headers.get("content-length")) > MAX_IMAGE_BYTES) return json({ error: `Token image must be under ${MAX_IMAGE_BYTES} bytes.` }, { status: 413 });
    const type = request.headers.get("content-type")?.split(";")[0] || "";
    if (!new Set(["image/webp", "image/png", "image/jpeg"]).has(type)) {
      return json({ error: "Only WebP, PNG and JPEG token images are accepted." }, { status: 415 });
    }
    const buffer = await request.arrayBuffer();
    if (!buffer.byteLength || buffer.byteLength > MAX_IMAGE_BYTES) {
      return json({ error: `Token image must be between 1 byte and ${MAX_IMAGE_BYTES} bytes.` }, { status: 413 });
    }
    if (!validImageBytes(new Uint8Array(buffer), type)) return json({ error: "Image content does not match its declared type." }, { status: 415 });
    const key = await imageKey(buffer, type);
    const existing = bucket
      ? await bucket.head(key)
      : await db.prepare("SELECT key FROM images WHERE key=?").bind(key).first();
    if (existing) return json({ key, url: `/api/images/${key}`, deduplicated: true });
    const reserved = await db.prepare("UPDATE storage_usage SET used_bytes=used_bytes+?, updated_at=? WHERE key='token_images' AND used_bytes+?<=?")
      .bind(buffer.byteLength, Date.now(), buffer.byteLength, MAX_TOTAL_IMAGE_BYTES).run();
    if (!reserved.meta?.changes) return json({ error: "The RialoFun MVP image storage cap has been reached." }, { status: 507 });
    try {
      if (bucket) await bucket.put(key, buffer, { httpMetadata: { contentType: type, cacheControl: "public, max-age=31536000, immutable" } });
      else await db.prepare("INSERT INTO images (key,content_type,body,size_bytes,created_at) VALUES (?,?,?,?,?)")
        .bind(key, type, buffer, buffer.byteLength, Date.now()).run();
    } catch (error) {
      await db.prepare("UPDATE storage_usage SET used_bytes=MAX(0,used_bytes-?),updated_at=? WHERE key='token_images'").bind(buffer.byteLength, Date.now()).run();
      throw error;
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
        m.created_at AS createdAt,m.updated_at AS updatedAt,m.description,m.website,m.twitter,m.launch_signature AS launchSignature,
        s.phase,s.virtual_rlo AS virtualRlo,s.token_reserve AS tokenReserve,
        s.actual_rlo AS actualRlo,
        COALESCE(v.volume_rlo,0) AS volumeRlo,
      COALESCE(h.holders,0) AS netBuyers
      FROM markets m
      LEFT JOIN market_snapshots s ON s.state=m.state
      LEFT JOIN volumes v ON v.market_id=m.id
      LEFT JOIN holder_counts h ON h.market_id=m.id
      ORDER BY m.updated_at DESC LIMIT 500`).all();
    return json({ markets: results }, { headers: { "cache-control": "public, max-age=15" } });
  }
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
  if (!await enforceRateLimit(request, env, "metadata-write", 20)) return json({ error: "Metadata update limit reached. Try again later." }, { status: 429 });
  if (Number(request.headers.get("content-length")) > 16_384) return json({ error: "Metadata payload is too large." }, { status: 413 });
  let body;
  try { body = await request.json(); } catch { return json({ error: "Malformed metadata JSON." }, { status: 400 }); }
  const market = {
    id: cleanString(body.id, 96), state: cleanString(body.state, 64), mint: cleanString(body.mint, 64),
    name: cleanString(body.name, 64), ticker: cleanString(body.ticker, 12).toUpperCase(),
    creator: cleanString(body.creator, 64), image: cleanString(body.image, 512),
    description: cleanString(body.description, 280), website: cleanString(body.website, 200), twitter: cleanString(body.twitter, 100),
    launchSignature: cleanString(body.launchSignature, 128),
    createdAt: Number(body.createdAt) || Date.now(),
  };
  if (!market.id || !market.state || !market.mint || !market.name || !market.ticker || !market.creator || !market.launchSignature || !market.image.startsWith("/api/images/tokens/")) {
    return json({ error: "Complete on-chain market metadata and a stored token image are required." }, { status: 400 });
  }
  if (market.website && !/^https:\/\//i.test(market.website)) return json({ error: "Website must use HTTPS." }, { status: 400 });
  if (market.twitter && !/^(@?[A-Za-z0-9_]{1,32}|https:\/\/(www\.)?(x\.com|twitter\.com)\/[^\s]{1,80})$/i.test(market.twitter)) return json({ error: "Enter an X handle or an HTTPS X/Twitter URL." }, { status: 400 });
  const imageKeyValue = market.image.slice("/api/images/".length);
  const image = env.IMAGES ? await env.IMAGES.head(imageKeyValue) : await db.prepare("SELECT key FROM images WHERE key=?").bind(imageKeyValue).first();
  if (!image) return json({ error: "The image is not present in shared token storage." }, { status: 400 });
  if (!await verifyMetadataSignature(market, body.signature)) return json({ error: "Wallet metadata signature is invalid." }, { status: 401 });
  if (!await verifyLaunchOnchain(market)) return json({ error: "The launch transaction could not be verified on Rialo Testnet." }, { status: 422 });
  const existing = await db.prepare("SELECT id FROM markets WHERE state=?").bind(market.state).first();
  if (existing && existing.id !== market.id) return json({ error: "This on-chain market is already registered under a different ID." }, { status: 409 });
  await db.prepare(`INSERT INTO markets (id,state,mint,name,ticker,creator,image_url,created_at,updated_at,description,website,twitter,launch_signature)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,ticker=excluded.ticker,image_url=excluded.image_url,updated_at=excluded.updated_at,description=excluded.description,website=excluded.website,twitter=excluded.twitter,launch_signature=excluded.launch_signature
    WHERE markets.state=excluded.state AND markets.creator=excluded.creator AND markets.mint=excluded.mint`)
    .bind(market.id, market.state, market.mint, market.name, market.ticker, market.creator, market.image, market.createdAt, Date.now(), market.description, market.website, market.twitter, market.launchSignature).run();
  const saved = await db.prepare("SELECT id FROM markets WHERE id=? AND state=? AND creator=?").bind(market.id, market.state, market.creator).first();
  if (!saved) return json({ error: "Market metadata could not be updated by this wallet." }, { status: 409 });
  return json({ market }, { status: 201 });
}

async function handleTrades(request, env, url) {
  const db = requireBinding(env, "DB");
  if (request.method === "POST" && url.pathname === "/api/trades") {
    return json({ error: "Trade history is written only by the on-chain indexer." }, { status: 405 });
  }
  const match = url.pathname.match(/^\/api\/markets\/([^/]+)\/trades$/);
  if (request.method === "GET" && match) {
    let marketId = decodeURIComponent(match[1]);
    const state = cleanString(url.searchParams.get("state"), 64);
    if (state) {
      const alias = await db.prepare("SELECT id FROM markets WHERE id=? OR state=?").bind(marketId, state).first();
      if (alias?.id) marketId = alias.id;
    }
    const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 100, 1), 100);
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
      SUM(rlo_amount) AS volume
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
    return [{ state: entry.pubkey, phase: bytes[3] === 2 ? "pool" : bytes[3] === 1 ? "graduation-ready" : "curve", virtualRloKelvin: read(40), tokenReserveBaseUnits: read(56), soldBaseUnits: read(72), actualRloKelvin: read(88), feesKelvin: read(104) }];
  });
  return json({ program: PROGRAM_ID, markets, fetchedAt: new Date().toISOString() }, { headers: { "cache-control": "public, max-age=10" } });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    try {
      if (request.method === "OPTIONS") return withCors(new Response(null, { status: 204 }), request);
      if (url.pathname === "/api/health") return withCors(json({ ok: true, storage: Boolean(env.DB), imageStore: env.IMAGES ? "r2" : env.DB ? "d1" : null }), request);
      if (url.pathname === "/api/markets" && request.method === "GET") {
        ctx.waitUntil(runIndexer(env).catch(() => undefined));
        return withCors(await handleOnchainMarkets(), request);
      }
      if (url.pathname === "/api/metadata") {
        if (request.method === "GET") ctx.waitUntil(runIndexer(env).catch(() => undefined));
        return withCors(await handleMetadata(request, env), request);
      }
      if (url.pathname === "/api/images" || url.pathname.startsWith("/api/images/")) return withCors(await handleImage(request, env, url) || new Response("Not found", { status: 404 }), request);
      if (url.pathname === "/api/trades" || /\/api\/markets\/[^/]+\/trades$/.test(url.pathname) || /\/api\/markets\/[^/]+\/(holders|candles)$/.test(url.pathname)) return withCors(await handleTrades(request, env, url) || new Response("Not found", { status: 404 }), request);
    } catch (error) {
      return withCors(json({ error: error instanceof Error ? error.message : "RialoFun API failed." }, { status: 503 }), request);
    }
    const response = await env.ASSETS.fetch(request);
    const acceptsHtml = request.headers.get("accept")?.includes("text/html");
    if (response.status !== 404 || !acceptsHtml || !["GET", "HEAD"].includes(request.method)) return withCors(response, request);
    const indexUrl = new URL(request.url);
    indexUrl.pathname = "/index.html";
    indexUrl.search = "";
    return withCors(await env.ASSETS.fetch(new Request(indexUrl, request)), request);
  },
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(runIndexer(env));
  },
};
