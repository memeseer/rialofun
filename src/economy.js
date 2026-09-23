export const ECONOMICS = Object.freeze({
  totalSupply: 1_000_000_000,
  initialVirtualRlo: 30,
  curveFee: 0.01,
  poolFee: 0.003,
  graduationSold: 800_000_000,
});

const round = (value, decimals = 6) => Number(value.toFixed(decimals));
const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

export function createMarket({ id, name, ticker, creator, image = "" }) {
  return {
    id, name, ticker, creator, image,
    phase: "curve",
    virtualRlo: ECONOMICS.initialVirtualRlo,
    tokenReserve: ECONOMICS.totalSupply,
    actualRlo: 0,
    poolRlo: 0,
    poolTokens: 0,
    platformFees: 0,
    poolFees: 0,
    volumeRlo: 0,
    netBuyers: 0,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

export function soldTokens(market) {
  return ECONOMICS.totalSupply - market.tokenReserve;
}

export function progress(market) {
  return clamp((soldTokens(market) / ECONOMICS.graduationSold) * 100, 0, 100);
}

export function spotPrice(market) {
  if (market.phase === "pool") return market.poolRlo / market.poolTokens;
  return market.virtualRlo / market.tokenReserve;
}

export function formatRlo(value) {
  if (!Number.isFinite(value)) return "—";
  if (Math.abs(value) >= 1) return `${round(value, 3)} RLO`;
  if (Math.abs(value) >= 0.001) return `${round(value, 5)} RLO`;
  return `${value.toFixed(9)} RLO`;
}

export function formatTokenPrice(value) {
  if (!Number.isFinite(value)) return "—";
  return formatRlo(value);
}

export function quote(market, side, input) {
  const amount = Number(input);
  if (!Number.isFinite(amount) || amount <= 0) return { output: 0, fee: 0, priceImpact: 0, error: "Enter an amount." };
  const feeRate = market.phase === "pool" ? ECONOMICS.poolFee : ECONOMICS.curveFee;

  if (side === "buy") {
    const fee = amount * feeRate;
    const effective = amount - fee;
    const rlo = market.phase === "pool" ? market.poolRlo : market.virtualRlo;
    const tokens = market.phase === "pool" ? market.poolTokens : market.tokenReserve;
    const output = tokens - (rlo * tokens) / (rlo + effective);
    if (output <= 0 || output >= tokens) return { output: 0, fee, priceImpact: 0, error: "Insufficient liquidity." };
    return { output, fee, priceImpact: output / tokens * 100 };
  }

  const tokens = market.phase === "pool" ? market.poolTokens : market.tokenReserve;
  const rlo = market.phase === "pool" ? market.poolRlo : market.virtualRlo;
  if (amount >= tokens) return { output: 0, fee: 0, priceImpact: 0, error: "Amount exceeds available curve liquidity." };
  const gross = rlo - (rlo * tokens) / (tokens + amount);
  const fee = gross * feeRate;
  const output = gross - fee;
  if (market.phase === "curve" && output > market.actualRlo) return { output: 0, fee, priceImpact: 0, error: "Curve reserve is insufficient." };
  return { output, fee, priceImpact: amount / tokens * 100 };
}
