// This file mirrors `rialofun-program/src/lib.rs`. Do not change its tags or
// integer layout without updating the Rust core and its codec tests together.
export const RLO_DECIMALS = 9;
export const TOKEN_DECIMALS = 6;

export const LaunchInstructionTag = Object.freeze({
  InitializeAndBuy: 0,
  Buy: 1,
  Sell: 2,
  Graduate: 3,
});
export const PoolInstructionTag = Object.freeze({ Graduate: 3, PoolBuy: 4, PoolSell: 5, AddLiquidity: 6, RemoveLiquidity: 7 });

function decimalToBaseUnits(input, decimals) {
  const text = String(input).trim();
  if (!/^\d+(?:\.\d+)?$/.test(text)) throw new Error("Amount must be a positive decimal number.");
  const [whole, fraction = ""] = text.split(".");
  if (fraction.length > decimals) throw new Error(`Amount supports at most ${decimals} decimal places.`);
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt((fraction + "0".repeat(decimals)).slice(0, decimals));
}

function writeU128(buffer, offset, value) {
  if (typeof value !== "bigint" || value < 0n || value >= 2n ** 128n) throw new Error("Amount does not fit into u128.");
  let remaining = value;
  for (let index = 0; index < 16; index += 1) {
    buffer[offset + index] = Number(remaining & 255n);
    remaining >>= 8n;
  }
}

function encodeTwoAmounts(tag, first, second) {
  const data = new Uint8Array(33);
  data[0] = tag;
  writeU128(data, 1, first);
  writeU128(data, 17, second);
  return data;
}

export function rloToKelvin(value) {
  return decimalToBaseUnits(value, RLO_DECIMALS);
}

export function tokenToBaseUnits(value) {
  return decimalToBaseUnits(value, TOKEN_DECIMALS);
}

export function encodeInitializeAndBuy({ initialBuyRlo, minTokensOut }) {
  return encodeTwoAmounts(LaunchInstructionTag.InitializeAndBuy, rloToKelvin(initialBuyRlo), tokenToBaseUnits(minTokensOut));
}

export function encodeBuy({ rloIn, minTokensOut }) {
  return encodeTwoAmounts(LaunchInstructionTag.Buy, rloToKelvin(rloIn), tokenToBaseUnits(minTokensOut));
}

export function encodeSell({ tokensIn, minRloOut }) {
  return encodeTwoAmounts(LaunchInstructionTag.Sell, tokenToBaseUnits(tokensIn), rloToKelvin(minRloOut));
}

export function encodeGraduate() {
  return new Uint8Array([LaunchInstructionTag.Graduate]);
}

export function encodePoolBuy({ rloIn, minTokensOut }) { return encodeTwoAmounts(PoolInstructionTag.PoolBuy, rloToKelvin(rloIn), tokenToBaseUnits(minTokensOut)); }
export function encodePoolSell({ tokensIn, minRloOut }) { return encodeTwoAmounts(PoolInstructionTag.PoolSell, tokenToBaseUnits(tokensIn), rloToKelvin(minRloOut)); }
export function encodeAddLiquidity({ rloIn, tokensIn, minLpOut }) { const d = new Uint8Array(49); d[0] = PoolInstructionTag.AddLiquidity; writeU128(d, 1, rloToKelvin(rloIn)); writeU128(d, 17, tokenToBaseUnits(tokensIn)); writeU128(d, 33, tokenToBaseUnits(minLpOut)); return d; }
export function encodeRemoveLiquidity({ lpIn, minRloOut, minTokensOut }) { const d = new Uint8Array(49); d[0] = PoolInstructionTag.RemoveLiquidity; writeU128(d, 1, tokenToBaseUnits(lpIn)); writeU128(d, 17, rloToKelvin(minRloOut)); writeU128(d, 33, tokenToBaseUnits(minTokensOut)); return d; }
