import { useMemo } from "react";

const RANGES = [
  { id: "5m", label: "5m", duration: 5 * 60 * 1000 },
  { id: "1h", label: "1h", duration: 60 * 60 * 1000 },
  { id: "6h", label: "6h", duration: 6 * 60 * 60 * 1000 },
  { id: "24h", label: "24h", duration: 24 * 60 * 60 * 1000 },
  { id: "all", label: "All", duration: Infinity },
];

const WIDTH = 900;
const HEIGHT = 240;
const PAD_X = 18;
const PAD_Y = 24;

function makeSeries(trades, currentPrice, range) {
  const duration = RANGES.find((item) => item.id === range)?.duration ?? Infinity;
  const cutoff = Number.isFinite(duration) ? Date.now() - duration : 0;
  const points = trades
    .filter((trade) => Number(trade.time) >= cutoff && Number(trade.price) > 0)
    .sort((left, right) => Number(left.time) - Number(right.time))
    .map((trade) => ({ time: Number(trade.time), price: Number(trade.price) }));

  if (!points.length) return [{ time: Date.now(), price: currentPrice }];
  const last = points.at(-1);
  if (currentPrice > 0 && Math.abs(last.price - currentPrice) > Number.EPSILON) {
    points.push({ time: Date.now(), price: currentPrice });
  }
  return points;
}

function toPath(series) {
  const prices = series.map((point) => point.price);
  const low = Math.min(...prices);
  const high = Math.max(...prices);
  const spread = high - low || Math.max(high * 0.06, 1e-12);
  const start = series[0]?.time || 0;
  const end = series.at(-1)?.time || start;
  const timeSpread = end - start || 1;

  if (series.length === 1) {
    const y = HEIGHT / 2;
    return `M ${PAD_X} ${y} L ${WIDTH - PAD_X} ${y}`;
  }

  return series
    .map((point, index) => {
      const x = PAD_X + ((point.time - start) / timeSpread) * (WIDTH - PAD_X * 2);
      const y = HEIGHT - PAD_Y - ((point.price - low) / spread) * (HEIGHT - PAD_Y * 2);
      return `${index ? "L" : "M"} ${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
}

export function TokenChart({ ticker, trades, price, range, onRangeChange }) {
  const series = useMemo(() => makeSeries(trades, price, range), [trades, price, range]);
  const path = useMemo(() => toPath(series), [series]);
  const hasTrades = series.length > 1;

  return (
    <section className="token-chart" aria-label="Token price chart">
      <div className="chart-head">
        <div>
          <b>Price chart</b>
          <small>{hasTrades ? `${series.length} indexed price points` : "Waiting for the first indexed trade"}</small>
        </div>
        <span>RLO / {ticker}</span>
      </div>
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label={`${range} price history`} preserveAspectRatio="none">
        <defs>
          <linearGradient id="rialofun-chart-fill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="currentColor" stopOpacity=".22" />
            <stop offset="1" stopColor="currentColor" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={`${path} L ${WIDTH - PAD_X} ${HEIGHT - 2} L ${PAD_X} ${HEIGHT - 2} Z`} fill="url(#rialofun-chart-fill)" stroke="none" />
        <path d={path} fill="none" stroke="currentColor" strokeWidth="4" vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="chart-range" role="tablist" aria-label="Chart timeframe">
        {RANGES.map((item) => (
          <button
            type="button"
            role="tab"
            aria-selected={range === item.id}
            className={range === item.id ? "active" : ""}
            key={item.id}
            onClick={() => onRangeChange(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>
    </section>
  );
}
