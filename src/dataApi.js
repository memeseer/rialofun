const JSON_HEADERS = { "content-type": "application/json" };
// Production uses the Vercel same-origin proxy so metadata/images work even
// when a browser cannot resolve the workers.dev hostname directly.
const API_BASE = (import.meta.env.VITE_RIALOFUN_API || "").replace(/\/$/, "");
const absoluteUrl = (value) => value && value.startsWith("/") ? `${API_BASE}${value}` : value;
const apiPath = (value) => API_BASE && value?.startsWith(API_BASE) ? value.slice(API_BASE.length) : value;
const versionedImageUrl = (value, version) => {
  const resolved = absoluteUrl(value);
  if (!resolved || !resolved.includes("/api/images/")) return resolved;
  return `${resolved}${resolved.includes("?") ? "&" : "?"}v=${encodeURIComponent(version || "binary-v2")}`;
};

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

export async function publishMarketMetadata(market) {
  return api("/api/metadata", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({
      id: market.id,
      state: market.onchain?.state,
      mint: market.onchain?.mint,
      name: market.name,
      ticker: market.ticker,
      creator: market.creator,
      image: apiPath(market.image),
      createdAt: market.createdAt,
    }),
  });
}

export async function publishTrade(trade) {
  return api("/api/trades", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(trade),
  });
}

export async function fetchMarketTrades(marketId, state) {
  const params = new URLSearchParams({ limit: "500" });
  if (state) params.set("state", state);
  const payload = await api(`/api/markets/${encodeURIComponent(marketId)}/trades?${params}`);
  return Array.isArray(payload.trades) ? payload.trades : [];
}

export async function fetchMarketMetadata() {
  const payload = await api("/api/metadata");
  return Array.isArray(payload.markets) ? payload.markets.map((market) => ({ ...market, image: versionedImageUrl(market.image, market.updatedAt) })) : [];
}
