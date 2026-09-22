export const PROGRAM_ID = "2iquqTG5Frnj64kzwa5RFWawuJpXg3fYhMkTPiT22AiM";
const RPC_URL = "https://testnet.rialo.io:4101";
const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const TOTAL_SUPPLY = 1_000_000_000;

function decodeBase58(value) {
  let number = 0n;
  for (const character of value) number = number * 58n + BigInt(BASE58.indexOf(character));
  const bytes = [];
  while (number) { bytes.unshift(Number(number & 255n)); number >>= 8n; }
  for (let index = 0; index < value.length && value[index] === "1"; index += 1) bytes.unshift(0);
  return Uint8Array.from(bytes);
}

function readU128(bytes, offset) {
  let value = 0n;
  for (let index = offset + 15; index >= offset; index -= 1) value = (value << 8n) | BigInt(bytes[index] || 0);
  return value;
}

function decodeState(account) {
  if (!account?.data || account.data[1] !== "base64") return null;
  const bytes = Uint8Array.from(atob(account.data[0]), (character) => character.charCodeAt(0));
  if (bytes.length !== 128 || bytes[0] !== 1) return null;
  return {
    phase: bytes[3] === 1 ? "pool" : "curve",
    virtualRlo: Number(readU128(bytes, 40)) / 1e9,
    tokenReserve: Number(readU128(bytes, 56)) / 1e6,
    sold: Number(readU128(bytes, 72)) / 1e6,
    actualRlo: Number(readU128(bytes, 88)) / 1e9,
    fees: Number(readU128(bytes, 104)) / 1e9,
  };
}

async function rpc(method, params) {
  const response = await fetch(RPC_URL, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  if (!response.ok) throw new Error(`Rialo RPC returned ${response.status}.`);
  const payload = await response.json();
  if (payload.error) throw new Error(payload.error.message || "Rialo RPC error.");
  return payload.result;
}

async function snapshotFor(state) {
  const result = await rpc("getAccountInfo", [{ address: state }]);
  return decodeState(result?.value);
}

async function ensureMarket(db, state, mint, creator, time) {
  const existing = await db.prepare("SELECT id FROM markets WHERE state=?").bind(state).first();
  if (existing) return existing.id;
  const id = `chain-${state.slice(0, 8)}`;
  await db.prepare(`INSERT OR IGNORE INTO markets (id,state,mint,name,ticker,creator,image_url,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?)`).bind(id, state, mint || "", "RialoFun market", mint ? `RLO-${mint.slice(0, 4)}` : "RLO", creator || "On-chain", "", time, Date.now()).run();
  return id;
}

function eventFromInstruction(instruction, keys) {
  const programId = keys[instruction.programIdIndex];
  if (programId !== PROGRAM_ID) return null;
  const data = decodeBase58(instruction.data || "");
  const tag = data[0];
  if (![0, 1, 2, 3, 4, 5, 6, 7].includes(tag)) return null;
  const accounts = instruction.accounts || [];
  const state = keys[accounts[0]];
  if (!state) return null;
  return { tag, data, accounts, state, mint: keys[accounts[2]], trader: keys[accounts[1]] };
}

async function indexTransaction(db, item) {
  const transaction = await rpc("getTransaction", [{ signature: item.signature }]);
  if (!transaction || transaction.meta?.err) return;
  const message = transaction.transaction?.message;
  const keys = message?.accountKeys || [];
  const instructions = message?.instructions || [];
  const time = Number(item.blockTime || transaction.block_time || Date.now());
  for (const instruction of instructions) {
    const event = eventFromInstruction(instruction, keys);
    if (!event) continue;
    const current = await snapshotFor(event.state).catch(() => null);
    const previous = await db.prepare("SELECT token_reserve AS tokenReserve,actual_rlo AS actualRlo,virtual_rlo AS virtualRlo,phase FROM market_snapshots WHERE state=?").bind(event.state).first();
    const marketId = await ensureMarket(db, event.state, event.mint, event.trader, time);
    if (current) {
      await db.prepare(`INSERT INTO market_snapshots (state,token_reserve,actual_rlo,virtual_rlo,phase,updated_at) VALUES (?,?,?,?,?,?)
        ON CONFLICT(state) DO UPDATE SET token_reserve=excluded.token_reserve,actual_rlo=excluded.actual_rlo,virtual_rlo=excluded.virtual_rlo,phase=excluded.phase,updated_at=excluded.updated_at`)
        .bind(event.state, current.tokenReserve, current.actualRlo, current.virtualRlo, current.phase, Date.now()).run();
    }
    if (![0, 1, 2, 4, 5].includes(event.tag)) continue;
    const firstAmount = Number(readU128(event.data, 1));
    const measuredTokenDelta = previous && current ? Math.abs(current.tokenReserve - Number(previous.tokenReserve)) : event.tag === 0 && current ? TOTAL_SUPPLY - current.tokenReserve : null;
    const tokenDelta = measuredTokenDelta && measuredTokenDelta > 0 ? measuredTokenDelta : null;
    const rloDelta = previous && current ? Math.abs(current.actualRlo - Number(previous.actualRlo)) : null;
    const side = [0, 1, 4].includes(event.tag) ? "BUY" : "SELL";
    const rloAmount = side === "BUY" ? firstAmount / 1e9 : (rloDelta ?? 0);
    const price = current ? (current.phase === "pool" ? current.actualRlo / Math.max(current.tokenReserve, 1) : current.virtualRlo / Math.max(current.tokenReserve, 1)) : 0;
    await db.prepare(`INSERT INTO trades (signature,market_id,account,side,rlo_amount,token_amount,price,block_time,verified)
      VALUES (?,?,?,?,?,?,?,?,1) ON CONFLICT(signature) DO UPDATE SET market_id=excluded.market_id,account=excluded.account,side=excluded.side,rlo_amount=excluded.rlo_amount,token_amount=excluded.token_amount,price=excluded.price,block_time=excluded.block_time,verified=1`)
      .bind(item.signature, marketId, event.trader || "On-chain", side, rloAmount, tokenDelta, price, time).run();
    await db.prepare("UPDATE markets SET updated_at=? WHERE id=?").bind(time, marketId).run();
  }
  await db.prepare("INSERT OR REPLACE INTO indexed_transactions (signature,block_height,indexed_at) VALUES (?,?,?)").bind(item.signature, Number(item.blockHeight || transaction.block_height || 0), Date.now()).run();
}

export async function runIndexer(env) {
  if (!env.DB) throw new Error("D1 binding is not configured.");
  const cursor = await env.DB.prepare("SELECT value FROM indexer_state WHERE key='latest_signature'").first();
  const config = { limit: 20 };
  if (cursor?.value) config.until = cursor.value;
  const result = await rpc("getSignaturesForAddress", [{ address: PROGRAM_ID, config }]);
  const signatures = (result?.value || []).filter((item) => !item.err).sort((left, right) => Number(left.blockHeight || 0) - Number(right.blockHeight || 0));
  let indexed = 0;
  for (const item of signatures) {
    const existing = await env.DB.prepare("SELECT signature FROM indexed_transactions WHERE signature=?").bind(item.signature).first();
    if (existing) continue;
    await indexTransaction(env.DB, item);
    indexed += 1;
  }
  if (result?.value?.[0]?.signature) await env.DB.prepare("INSERT OR REPLACE INTO indexer_state (key,value,updated_at) VALUES ('latest_signature',?,?)").bind(result.value[0].signature, Date.now()).run();
  return { seen: signatures.length, indexed };
}
