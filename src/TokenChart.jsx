import { useEffect, useMemo, useState } from "react";

const RANGES = [
  { id: "1m", label: "1m" },
  { id: "5m", label: "5m" },
  { id: "15m", label: "15m" },
  { id: "1h", label: "1h" },
  { id: "4h", label: "4h" },
];

const WIDTH = 900;
const HEIGHT = 260;
const LEFT = 14;
const RIGHT = 72;
const PRICE_TOP = 16;
const PRICE_BOTTOM = 190;
const VOLUME_TOP = 210;
const VOLUME_BOTTOM = 244;
const INTERVAL_MS = { "1m": 60_000, "5m": 300_000, "15m": 900_000, "1h": 3_600_000, "4h": 14_400_000 };
const MAX_CANDLES = 180;
const MAX_EMPTY_CANDLES = 600;

const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp = (value, low, high) => Math.min(Math.max(value, low), high);

function formatPrice(value) {
  const number = finite(value);
  if (!number) return "0";
  if (number >= 1) return number.toLocaleString("en", { maximumFractionDigits: 4 });
  if (number >= 0.0001) return number.toFixed(8).replace(/0+$/, "");
  return number.toFixed(10).replace(/0+$/, "");
}

function formatTime(value, range) {
  const options = range === "4h"
    ? { month: "short", day: "numeric", hour: "2-digit" }
    : { hour: "2-digit", minute: "2-digit" };
  return new Date(finite(value)).toLocaleString([], options);
}

function normalizeCandles(candles, range) {
  const normalized = candles
    .map((item) => ({
      time: finite(item.time),
      open: finite(item.open),
      high: finite(item.high),
      low: finite(item.low),
      close: finite(item.close),
      volume: Math.max(finite(item.volume), 0),
    }))
    .filter((item) => item.time && item.open > 0 && item.high > 0 && item.low > 0 && item.close > 0)
    .sort((left, right) => left.time - right.time);

  const interval = INTERVAL_MS[range] || INTERVAL_MS["5m"];
  const filled = [];
  let emptyCount = 0;
  for (const candle of normalized) {
    const previous = filled.at(-1);
    const missing = previous ? Math.round((candle.time - previous.time) / interval) - 1 : 0;
    if (missing > 0 && emptyCount + missing <= MAX_EMPTY_CANDLES) {
      for (let step = 1; step <= missing; step += 1) {
        const time = previous.time + interval * step;
        filled.push({
          time,
          open: previous.close,
          high: previous.close,
          low: previous.close,
          close: previous.close,
          volume: 0,
          noTrades: true,
        });
      }
      emptyCount += missing;
    }
    filled.push(candle);
  }
  return filled;
}

export function TokenChart({ ticker, candles, range, loading, error, onRangeChange }) {
  const series = useMemo(() => normalizeCandles(candles, range), [candles, range]);
  const [hovered, setHovered] = useState(null);
  const firstCandleTime = series[0]?.time;
  const lastCandleTime = series.at(-1)?.time;
  useEffect(() => setHovered(null), [range, series.length, firstCandleTime, lastCandleTime]);

  const geometry = useMemo(() => {
    if (!series.length) return null;
    const rawLow = Math.min(...series.map((item) => item.low));
    const rawHigh = Math.max(...series.map((item) => item.high));
    const padding = Math.max((rawHigh - rawLow) * 0.12, rawHigh * 0.025, 1e-14);
    const low = Math.max(0, rawLow - padding);
    const high = rawHigh + padding;
    const spread = high - low || 1;
    const plotWidth = WIDTH - LEFT - RIGHT;
    const interval = INTERVAL_MS[range] || INTERVAL_MS["5m"];
    const firstTime = series[0].time;
    const lastTime = series.at(-1).time;
    const hasTimeSpan = lastTime > firstTime;
    const domainStart = firstTime;
    const domainEnd = hasTimeSpan ? lastTime + interval : firstTime + interval * MAX_CANDLES;
    const domainSpan = domainEnd - domainStart;
    const slot = plotWidth * interval / domainSpan;
    const bodyWidth = clamp(slot * 0.68, 3, 18);
    const greatestVolume = Math.max(...series.map((item) => item.volume), 0);
    const maxVolume = greatestVolume > 0 ? greatestVolume : 1;
    const y = (value) => PRICE_BOTTOM - ((value - low) / spread) * (PRICE_BOTTOM - PRICE_TOP);
    return {
      low,
      high,
      bodyWidth,
      interval,
      points: series.map((item, index) => ({
        ...item,
        x: hasTimeSpan
          ? LEFT + ((item.time + interval / 2 - domainStart) / domainSpan) * plotWidth
          : LEFT + plotWidth / 2,
        openY: y(item.open),
        highY: y(item.high),
        lowY: y(item.low),
        closeY: y(item.close),
        volumeY: VOLUME_BOTTOM - (item.volume / maxVolume) * (VOLUME_BOTTOM - VOLUME_TOP),
      })),
    };
  }, [series, range]);

  const active = hovered == null ? series.at(-1) : series[hovered];
  const activeDirection = active?.noTrades ? "No trades" : active && active.close >= active.open ? "Up" : "Down";

  return (
    <section className="token-chart candle-chart" aria-label={`${ticker} candlestick price chart`}>
      <div className="chart-head">
        <div>
          <b>{ticker} / RLO</b>
          <small>{loading ? "Updating indexed candles…" : `${range} candles · confirmed on-chain trades`}</small>
        </div>
        {active && (
          <div className="ohlc-strip" aria-live="polite">
            <span>O <b>{formatPrice(active.open)}</b></span>
            <span>H <b>{formatPrice(active.high)}</b></span>
            <span>L <b>{formatPrice(active.low)}</b></span>
            <span>C <b>{formatPrice(active.close)}</b></span>
            <span className={active?.noTrades ? "muted" : activeDirection === "Up" ? "positive" : "negative"}>{activeDirection}</span>
          </div>
        )}
      </div>

      {geometry ? (
        <div className="candle-stage">
          <svg
            viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
            role="img"
            aria-label={`${range} OHLC chart with ${series.length} candles. Latest close ${formatPrice(series.at(-1).close)} RLO.`}
            preserveAspectRatio="none"
            onMouseLeave={() => setHovered(null)}
          >
            {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
              const y = PRICE_TOP + ratio * (PRICE_BOTTOM - PRICE_TOP);
              const value = geometry.high - ratio * (geometry.high - geometry.low);
              return (
                <g className="candle-grid" key={ratio}>
                  <line x1={LEFT} x2={WIDTH - RIGHT} y1={y} y2={y} />
                  <text x={WIDTH - RIGHT + 9} y={y + 4}>{formatPrice(value)}</text>
                </g>
              );
            })}
            <line className="volume-divider" x1={LEFT} x2={WIDTH - RIGHT} y1={VOLUME_TOP - 8} y2={VOLUME_TOP - 8} />
            {geometry.points.map((item, index) => {
              const rising = item.close >= item.open;
              const bodyTop = Math.min(item.openY, item.closeY);
              const bodyHeight = Math.max(Math.abs(item.closeY - item.openY), 2);
              return (
                <g
                  className={item.noTrades ? "candle candle-idle" : rising ? "candle candle-up" : "candle candle-down"}
                  key={`${item.time}-${index}`}
                  onMouseEnter={() => setHovered(index)}
                  onFocus={() => setHovered(index)}
                  tabIndex="0"
                  aria-label={`${formatTime(item.time, range)} ${item.noTrades ? "no-trade" : rising ? "up" : "down"} candle, open ${formatPrice(item.open)}, high ${formatPrice(item.high)}, low ${formatPrice(item.low)}, close ${formatPrice(item.close)}, volume ${item.volume.toFixed(4)} RLO`}
                >
                  <title>{`${formatTime(item.time, range)} · ${item.noTrades ? "No trades (last close carried forward)" : rising ? "Up" : "Down"} · O ${formatPrice(item.open)} · H ${formatPrice(item.high)} · L ${formatPrice(item.low)} · C ${formatPrice(item.close)} · Vol ${item.volume.toFixed(4)} RLO`}</title>
                  <line className="candle-wick" x1={item.x} x2={item.x} y1={item.highY} y2={item.lowY} />
                  <rect className="candle-body" x={item.x - geometry.bodyWidth / 2} y={bodyTop} width={geometry.bodyWidth} height={bodyHeight} rx="1" />
                  {item.volume > 0 && <rect className="volume-bar" x={item.x - geometry.bodyWidth / 2} y={item.volumeY} width={geometry.bodyWidth} height={Math.max(VOLUME_BOTTOM - item.volumeY, 1)} />}
                  <rect className="candle-hit" x={item.x - Math.max(geometry.bodyWidth, 8)} y={PRICE_TOP} width={Math.max(geometry.bodyWidth * 2, 16)} height={VOLUME_BOTTOM - PRICE_TOP} />
                </g>
              );
            })}
            {hovered != null && geometry.points[hovered] && (
              <line className="candle-crosshair" x1={geometry.points[hovered].x} x2={geometry.points[hovered].x} y1={PRICE_TOP} y2={VOLUME_BOTTOM} />
            )}
            {[...new Set([0, Math.floor((geometry.points.length - 1) / 2), geometry.points.length - 1])].map((index) => {
              const point = geometry.points[index];
              const anchor = point.x < LEFT + 36 ? "start" : point.x > WIDTH - RIGHT - 36 ? "end" : "middle";
              return (
                <g key={`${point.time}-${index}`}>
                  <line className="time-grid" x1={point.x} x2={point.x} y1={PRICE_TOP} y2={VOLUME_BOTTOM} />
                  <text className="time-label" textAnchor={anchor} x={point.x} y={HEIGHT - 3}>
                    {formatTime(point.time, range)}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>
      ) : (
        <div className="chart-empty">
          <b>{error ? "Chart data is temporarily unavailable" : "No indexed candles yet"}</b>
          <span>{error ? "The chart will retry automatically." : "The first confirmed trade will open this chart."}</span>
        </div>
      )}

      <div className="chart-range" role="tablist" aria-label="Candle interval">
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
