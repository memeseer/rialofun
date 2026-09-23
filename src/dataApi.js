const JSON_HEADERS = { "content-type": "application/json" };
// Production uses the Vercel same-origin proxy so metadata/images work even
// when a browser cannot resolve the workers.dev hostname directly.
const API_BASE = (import.meta.env.VITE_RIALOFUN_API || "").replace(/\/$/, "");
const absoluteUrl = (value) => value && value.startsWith("/") ? `${API_BASE}${value}` : value;
const apiPath = (value) => API_BASE && value?.startsWith(API_BASE) ? value.slice(API_BASE.length) : value;
// Image paths are SHA-256 content-addressed and served immutable by the worker.
// Do not key image cache on market.updatedAt: every trade would trigger a needless reload.
const versionedImageUrl = (value) => absoluteUrl(value);

async function api(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, options);
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || `RialoFun API returned ${response.status}.`);
  }
  return response.json();
}

function dataUrlToBlob(dataUrl) {
  const [header, encoded] = dataUrl.split(",");
  const type = header.match(/^data:([^;]+)/)?.[1] || "image/webp";
  const bytes = Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
  return new Blob([bytes], { type });
}

export async function uploadTokenImage(dataUrl) {
  const blob = dataUrlToBlob(dataUrl);
  const payload = await api("/api/images", {
    method: "POST",
    headers: { "content-type": blob.type },
    body: blob,
  });
  return absoluteUrl(payload.url);
}

export async function publishMarketMetadata(market, walletAccount) {
  const metadata = {
    id: market.id,
    state: market.onchain?.state,
    mint: market.onchain?.mint,
    name: market.name,
    ticker: market.ticker,
    creator: market.creator,
    image: apiPath(market.image),
    description: market.description || "",
    website: market.website || "",
    twitter: market.twitter || "",
    launchSignature: market.onchain?.signature || market.onchain?.launchSignature || "",
    createdAt: market.createdAt,
  };
  const message = createMetadataMessage(metadata);
  const account = walletAccount || window.rialoTestnetWallet?.accounts?.find((item) => item.address === market.creator);
  const feature = window.rialoTestnetWallet?.features?.["solana:signMessage"] || window.rialoTestnetWallet?.features?.["rialo:signMessage"];
  if (!feature || !account) throw new Error("This wallet does not support signing market metadata. Your token is on-chain, but its shared profile is not published.");
  const result = await feature.signMessage({ account, message: new TextEncoder().encode(message) });
  const signed = Array.isArray(result) ? result[0] : result;
  if (!signed?.signature) throw new Error("Wallet did not return a metadata signature.");
  const signature = btoa(String.fromCharCode(...signed.signature));
  return api("/api/metadata", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ ...metadata, signature }),
  });
}

export function createMetadataMessage(metadata) {
  return JSON.stringify(["RialoFun metadata authorization v1", metadata.id, metadata.state, metadata.mint, metadata.creator,
    metadata.launchSignature, metadata.name, metadata.ticker, metadata.image, metadata.description, metadata.website, metadata.twitter, metadata.createdAt]);
}

export async function fetchMarketTrades(marketId, state) {
  const params = new URLSearchParams({ limit: "500" });
  if (state) params.set("state", state);
  const payload = await api(`/api/markets/${encodeURIComponent(marketId)}/trades?${params}`);
  return Array.isArray(payload.trades) ? payload.trades : [];
}

const CANDLE_INTERVALS = {
  "1m": 60_000,
  "5m": 5 * 60_000,
  "15m": 15 * 60_000,
  "1h": 60 * 60_000,
  "4h": 4 * 60 * 60_000,
};

export async function fetchMarketCandles(marketId, state, range = "5m") {
  const params = new URLSearchParams({
    interval: String(CANDLE_INTERVALS[range] || CANDLE_INTERVALS["5m"]),
    limit: "180",
  });
  if (state) params.set("state", state);
  const payload = await api(`/api/markets/${encodeURIComponent(marketId)}/candles?${params}`);
  return Array.isArray(payload.candles) ? payload.candles : [];
}

export async function fetchMarketMetadata() {
  const payload = await api("/api/metadata");
  return Array.isArray(payload.markets) ? payload.markets.map((market) => ({ ...market, image: versionedImageUrl(market.image) })) : [];
}
