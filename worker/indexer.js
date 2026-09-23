export const PROGRAM_ID = "2iquqTG5Frnj64kzwa5RFWawuJpXg3fYhMkTPiT22AiM";
const TOKEN_PROGRAM_ID = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
const RPC_URL = "https://testnet.rialo.io:4101";
const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function decodeBase58(value = "") {
  let number = 0n;
  for (const character of value) {
    const digit = BASE58.indexOf(character);
    if (digit < 0) return new Uint8Array();
    number = number * 58n + BigInt(digit);
  }
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
    phase: bytes[3] === 2 ? "pool" : bytes[3] === 1 ? "graduation-ready" : "curve",
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

function accountKeys(transaction) {
  const keys = transaction.transaction?.message?.accountKeys || [];
  return keys.map((item) => typeof item === "string" ? item : item.pubkey);
}

function tokenBalance(transaction, accountIndex, mint) {
  const balances = transaction.meta?.postTokenBalances || [];
  const previous = transaction.meta?.preTokenBalances || [];
  const amountFor = (items) => {
    const match = items.find((item) => item.accountIndex === accountIndex && item.mint === mint);
    return match ? BigInt(match.uiTokenAmount?.amount || "0") : 0n;
  };
  return amountFor(balances) - amountFor(previous);
}

export function tokenAmountFromTransaction(transaction, instructionIndex, event, keys) {
  const balanceDelta = tokenBalance(transaction, event.tokenAccountIndex, event.mint);
  if (balanceDelta !== 0n) return balanceDelta < 0n ? -balanceDelta : balanceDelta;
  const isBuy = [0, 1, 4].includes(event.tag);
  let total = 0n;
  for (const inner of transaction.meta?.innerInstructions || []) {
    if (inner.instructionIndex !== instructionIndex) continue;
    const instruction = inner.instruction;
    if (!instruction || keys[instruction.programIdIndex] !== TOKEN_PROGRAM_ID) continue;
    const data = decodeBase58(instruction.data || "");
    if (data.length < 9) continue;
    const accounts = instruction.accounts || [];
    const mintIndex = data[0] === 14 ? accounts[0] : accounts[1];
    const tokenIndex = data[0] === 14 ? accounts[1] : data[0] === 15 ? accounts[0] : isBuy ? accounts[2] : accounts[0];
    if (!new Set([12, 14, 15]).has(data[0]) || keys[mintIndex] !== event.mint || tokenIndex !== event.tokenAccountIndex) continue;
    let amount = 0n;
    for (let offset = 8; offset >= 1; offset -= 1) amount = (amount << 8n) | BigInt(data[offset]);
    total += amount;
  }
  return total;
}

export function receivedRloFromTransaction(transaction, traderIndex) {
  const before = transaction.meta?.preBalances?.[traderIndex];
  const after = transaction.meta?.postBalances?.[traderIndex];
  if (before == null || after == null) return 0;
  const fee = traderIndex === 0 ? BigInt(transaction.meta?.fee || 0) : 0n;
  const received = BigInt(after) - BigInt(before) + fee;
  return Number(received > 0n ? received : 0n) / 1e9;
}

function instructionEvent(instruction, keys) {
  if (keys[instruction.programIdIndex] !== PROGRAM_ID) return null;
  const data = decodeBase58(instruction.data || "");
  const tag = data[0];
  if (![0, 1, 2, 3, 4, 5, 6, 7].includes(tag)) return null;
  const accounts = instruction.accounts || [];
  const state = keys[accounts[0]];
  if (!state) return null;
  return { tag, data, accounts, state, trader: keys[accounts[1]], mint: keys[accounts[2]], tokenAccountIndex: accounts[3], traderIndex: accounts[1] };
}

async function ensureMarket(db, event, time) {
  const existing = await db.prepare("SELECT id FROM markets WHERE state=?").bind(event.state).first();
  if (existing) return existing.id;
  const id = `chain-${event.state.slice(0, 8)}`;
  await db.prepare(`INSERT OR IGNORE INTO markets (id,state,mint,name,ticker,creator,image_url,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?)`).bind(id, event.state, event.mint || "", "RialoFun market", event.mint ? `RLO-${event.mint.slice(0, 4)}` : "RLO", event.trader || "On-chain", "", time, time).run();
  return id;
}

async function indexTransaction(db, item) {
  const transaction = await rpc("getTransaction", [{ signature: item.signature }]);
  if (!transaction) throw new Error("RPC has not made this transaction available yet.");
  if (transaction.meta?.err) return { indexed: true, trades: 0 };
  const keys = accountKeys(transaction);
  const instructions = transaction.transaction?.message?.instructions || [];
  const rawTime = Number(item.blockTime || transaction.block_time || 0);
  const time = rawTime > 0 ? (rawTime < 1_000_000_000_000 ? rawTime * 1000 : rawTime) : Date.now();
  let trades = 0;
  for (const [instructionIndex, instruction] of instructions.entries()) {
    const event = instructionEvent(instruction, keys);
    if (!event) continue;
    const marketId = await ensureMarket(db, event, time);
    if (![0, 1, 2, 4, 5].includes(event.tag)) continue;
    const isBuy = [0, 1, 4].includes(event.tag);
    const tokenDeltaBase = tokenAmountFromTransaction(transaction, instructionIndex, event, keys);
    const tokenAmount = Number(tokenDeltaBase) / 1e6;
    // Rialo RPC may omit pre/post Token-2022 balances. Decode the actual
    // inner mint, burn or transfer instruction instead of guessing an amount.
    if (!Number.isFinite(tokenAmount) || tokenAmount <= 0) throw new Error(`Missing token balance delta for ${item.signature}.`);
    const amount = Number(readU128(event.data, 1)) / (isBuy ? 1e9 : 1e6);
    const rloAmount = isBuy ? amount : receivedRloFromTransaction(transaction, event.traderIndex);
    // Some Rialo transactions omit native balance arrays. Record a verified
    // sell with unknown RLO value, without blocking all later signatures.
    if (isBuy && (!Number.isFinite(rloAmount) || rloAmount <= 0)) throw new Error(`Missing RLO amount for ${item.signature}.`);
    const side = isBuy ? "BUY" : "SELL";
    const price = rloAmount > 0 ? rloAmount / tokenAmount : 0;
    await db.prepare(`INSERT INTO trades (signature,market_id,account,side,rlo_amount,token_amount,price,block_time,verified)
      VALUES (?,?,?,?,?,?,?,?,1) ON CONFLICT(signature) DO UPDATE SET market_id=excluded.market_id,account=excluded.account,side=excluded.side,rlo_amount=excluded.rlo_amount,token_amount=excluded.token_amount,price=excluded.price,block_time=excluded.block_time,verified=1`)
      .bind(item.signature, marketId, event.trader || "On-chain", side, rloAmount, tokenAmount, price, time).run();
    await db.prepare("UPDATE markets SET updated_at=? WHERE id=?").bind(time, marketId).run();
    trades += 1;
  }
  // The cursor only advances after the complete transaction was fetched and parsed.
  await db.prepare("INSERT OR REPLACE INTO indexed_transactions (signature,block_height,indexed_at,attempts,last_error) VALUES (?,?,?,0,'')")
    .bind(item.signature, Number(item.blockHeight || transaction.block_height || 0), Date.now()).run();
  await db.prepare("DELETE FROM indexer_failures WHERE signature=?").bind(item.signature).run();
  return { indexed: true, trades };
}

export async function runIndexer(env) {
  if (!env.DB) throw new Error("D1 binding is not configured.");
  const cursor = await env.DB.prepare("SELECT value FROM indexer_state WHERE key='latest_signature'").first();
  const config = { limit: 50 };
  if (cursor?.value) config.until = cursor.value;
  const result = await rpc("getSignaturesForAddress", [{ address: PROGRAM_ID, config }]);
  const signatures = (result?.value || []).sort((left, right) => Number(left.blockHeight || 0) - Number(right.blockHeight || 0));
  let indexed = 0;
  let failed = null;
  for (const item of signatures) {
    const existing = await env.DB.prepare("SELECT signature FROM indexed_transactions WHERE signature=?").bind(item.signature).first();
    if (existing) continue;
    try {
      await indexTransaction(env.DB, item);
      indexed += 1;
    } catch (error) {
      failed = { signature: item.signature, message: String(error?.message || error) };
      await env.DB.prepare(`INSERT INTO indexer_failures (signature,attempts,last_error,updated_at) VALUES (?,1,?,?)
        ON CONFLICT(signature) DO UPDATE SET attempts=attempts+1,last_error=excluded.last_error,updated_at=excluded.updated_at`)
        .bind(item.signature, failed.message.slice(0, 500), Date.now()).run();
      break;
    }
  }
  // Move the watermark to the newest signature only if every older signature
  // in this window completed. This avoids silently skipping RPC lag/outages.
  if (!failed && signatures.at(-1)?.signature) {
    await env.DB.prepare("INSERT OR REPLACE INTO indexer_state (key,value,updated_at) VALUES ('latest_signature',?,?)")
      .bind(signatures.at(-1).signature, Date.now()).run();
  }
  return { seen: signatures.length, indexed, failed };
}
