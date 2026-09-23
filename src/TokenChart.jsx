import { useEffect, useMemo, useRef, useState } from "react";

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

function normalizeCandles(candles, range, trades) {
  const interval = INTERVAL_MS[range] || INTERVAL_MS["5m"];
  const flowByBucket = new Map();
  for (const trade of trades) {
    const time = finite(trade.time);
    const amount = Math.max(finite(trade.rloAmount), 0);
    const side = String(trade.side || "").toUpperCase();
    if (!time || !amount || (side !== "BUY" && side !== "SELL")) continue;
    const bucket = Math.floor(time / interval) * interval;
    const flow = flowByBucket.get(bucket) || { buyVolume: 0, sellVolume: 0 };
    if (side === "BUY") flow.buyVolume += amount;
    else flow.sellVolume += amount;
    flowByBucket.set(bucket, flow);
  }
  const normalized = candles
    .map((item) => ({
      time: finite(item.time),
      open: finite(item.open),
      high: finite(item.high),
      low: finite(item.low),
      close: finite(item.close),
      volume: Math.max(finite(item.volume), 0),
      ...(flowByBucket.get(finite(item.time)) || { buyVolume: 0, sellVolume: 0 }),
    }))
    .filter((item) => item.time && item.open > 0 && item.high > 0 && item.low > 0 && item.close > 0)
    .sort((left, right) => left.time - right.time);

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

export function TokenChart({ ticker, candles, trades = [], range, loading, error, onRangeChange }) {
  const series = useMemo(() => normalizeCandles(candles, range, trades), [candles, range, trades]);
  const [hoveredTime, setHoveredTime] = useState(null);
  const [visibleBars, setVisibleBars] = useState(90);
  const [panOffset, setPanOffset] = useState(0);
  const dragRef = useRef(null);
  const firstCandleTime = series[0]?.time;
  const lastCandleTime = series.at(-1)?.time;
  useEffect(() => {
    setHoveredTime(null);
    setPanOffset(0);
  }, [range, series.length, firstCandleTime, lastCandleTime]);

  const visibleEnd = Math.max(0, series.length - panOffset);
  const visibleStart = Math.max(0, visibleEnd - visibleBars);
  const visibleSeries = series.slice(visibleStart, visibleEnd);
  const realCandleCount = visibleSeries.filter((item) => !item.noTrades).length;
  const emptyIntervalCount = visibleSeries.length - realCandleCount;
  const zoom = (factor) => {
    setVisibleBars((current) => {
      const next = clamp(Math.round(current * factor), 20, 500);
      setPanOffset((offset) => clamp(offset, 0, Math.max(0, series.length - next)));
      return next;
    });
  };
  const resetView = () => {
    setVisibleBars(90);
    setPanOffset(0);
    setHoveredTime(null);
  };

  const geometry = useMemo(() => {
    if (!visibleSeries.length) return null;
    const rawLow = Math.min(...visibleSeries.map((item) => item.low));
    const rawHigh = Math.max(...visibleSeries.map((item) => item.high));
    const padding = Math.max((rawHigh - rawLow) * 0.12, rawHigh * 0.025, 1e-14);
    const low = Math.max(0, rawLow - padding);
    const high = rawHigh + padding;
    const spread = high - low || 1;
    const plotWidth = WIDTH - LEFT - RIGHT;
    const interval = INTERVAL_MS[range] || INTERVAL_MS["5m"];
    const firstTime = visibleSeries[0].time;
    const lastTime = visibleSeries.at(-1).time;
    const hasTimeSpan = lastTime > firstTime;
    const domainStart = hasTimeSpan ? firstTime : firstTime - interval * (visibleBars - 1);
    const domainEnd = lastTime + interval;
    const domainSpan = domainEnd - domainStart;
    const slot = plotWidth * interval / domainSpan;
    const bodyWidth = clamp(slot * 0.68, 3, 18);
    const greatestVolume = Math.max(...visibleSeries.map((item) => item.volume), 0);
    const maxVolume = greatestVolume > 0 ? greatestVolume : 1;
    const y = (value) => PRICE_BOTTOM - ((value - low) / spread) * (PRICE_BOTTOM - PRICE_TOP);
    return {
      low,
      high,
      bodyWidth,
      interval,
      points: visibleSeries.map((item, index) => ({
        ...item,
        x: LEFT + ((item.time + interval / 2 - domainStart) / domainSpan) * plotWidth,
        openY: y(item.open),
        highY: y(item.high),
        lowY: y(item.low),
        closeY: y(item.close),
        volumeY: VOLUME_BOTTOM - (item.volume / maxVolume) * (VOLUME_BOTTOM - VOLUME_TOP),
      })),
    };
  }, [visibleSeries, range, visibleBars]);

  const active = hoveredTime == null ? visibleSeries.at(-1) : visibleSeries.find((item) => item.time === hoveredTime) || visibleSeries.at(-1);
  const isFlat = (item) => Math.abs(item.close - item.open) <= Math.max(Math.abs(item.open) * 1e-8, Number.EPSILON);
  const flatSide = (item) => item.buyVolume > item.sellVolume ? "Buy" : item.sellVolume > item.buyVolume ? "Sell" : "Flat";
  const activeDirection = active?.noTrades ? "No trades" : active && isFlat(active) ? flatSide(active) : active && active.close > active.open ? "Up" : "Down";
  const hoveredPoint = hoveredTime == null ? null : geometry?.points.find((item) => item.time === hoveredTime);

  const handlePointerDown = (event) => {
    if (event.button !== 0) return;
    dragRef.current = { pointerId: event.pointerId, startX: event.clientX, startOffset: panOffset };
    setHoveredTime(null);
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const handlePointerMove = (event) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const width = event.currentTarget.getBoundingClientRect().width || 1;
    const movedBars = Math.round(((event.clientX - drag.startX) / width) * visibleBars);
    setPanOffset(clamp(drag.startOffset + movedBars, 0, Math.max(0, series.length - visibleBars)));
  };
  const handlePointerUp = () => { dragRef.current = null; };
  const handleChartKeyDown = (event) => {
    if (event.key === "+" || event.key === "=") { event.preventDefault(); zoom(0.8); }
    else if (event.key === "-") { event.preventDefault(); zoom(1.25); }
    else if (event.key === "Home") { event.preventDefault(); resetView(); }
    else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      const currentIndex = visibleSeries.findIndex((item) => item.time === hoveredTime);
      const nextIndex = clamp(currentIndex < 0 ? visibleSeries.length - 1 : currentIndex + (event.key === "ArrowLeft" ? -1 : 1), 0, visibleSeries.length - 1);
      setHoveredTime(visibleSeries[nextIndex]?.time ?? null);
    }
  };

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
            <span className={active?.noTrades || activeDirection === "Flat" ? "muted" : activeDirection === "Up" || activeDirection === "Buy" ? "positive" : "negative"}>{activeDirection}</span>
          </div>
        )}
        <div className="chart-controls" aria-label="Chart navigation">
          <button type="button" aria-label="Zoom out" title="Zoom out" onClick={() => zoom(1.25)}>−</button>
          <button type="button" aria-label="Zoom in" title="Zoom in" onClick={() => zoom(0.8)}>+</button>
          <button type="button" aria-label="Reset chart view" title="Reset chart view" onClick={resetView}>Reset</button>
        </div>
      </div>

      {geometry ? (
        <div className="candle-stage">
          <svg
            viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
            role="img"
            aria-label={`${range} OHLC chart showing ${realCandleCount} trade candles and ${emptyIntervalCount} no-trade intervals. Drag to pan, use the mouse wheel or plus/minus keys to zoom, and Home to reset. Visible close ${formatPrice(visibleSeries.at(-1).close)} RLO.`}
            preserveAspectRatio="none"
            tabIndex="0"
            onMouseLeave={() => setHoveredTime(null)}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            onWheel={(event) => { event.preventDefault(); zoom(event.deltaY > 0 ? 1.2 : 0.83); }}
            onKeyDown={handleChartKeyDown}
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
              const flat = isFlat(item);
              const bodyTop = Math.min(item.openY, item.closeY);
              const bodyHeight = Math.max(Math.abs(item.closeY - item.openY), flat ? 3 : 2);
              return (
                <g
                  className={item.noTrades ? "candle candle-idle" : flat && item.buyVolume > item.sellVolume ? "candle candle-flat-buy" : flat && item.sellVolume > item.buyVolume ? "candle candle-flat-sell" : flat ? "candle candle-flat" : rising ? "candle candle-up" : "candle candle-down"}
                  key={`${item.time}-${index}`}
                  onMouseEnter={() => setHoveredTime(item.time)}
                  aria-label={`${formatTime(item.time, range)} ${item.noTrades ? "no-trade" : flat ? `${flatSide(item).toLowerCase()} flat` : rising ? "up" : "down"} candle, open ${formatPrice(item.open)}, high ${formatPrice(item.high)}, low ${formatPrice(item.low)}, close ${formatPrice(item.close)}, volume ${item.volume.toFixed(4)} RLO`}
                >
                  <title>{`${formatTime(item.time, range)} · ${item.noTrades ? "No trades (last close carried forward)" : flat ? `${flatSide(item)} · flat OHLC` : rising ? "Up" : "Down"} · O ${formatPrice(item.open)} · H ${formatPrice(item.high)} · L ${formatPrice(item.low)} · C ${formatPrice(item.close)} · Vol ${item.volume.toFixed(4)} RLO`}</title>
                  <line className="candle-wick" x1={item.x} x2={item.x} y1={item.highY} y2={item.lowY} />
                  <rect className="candle-body" x={item.x - geometry.bodyWidth / 2} y={bodyTop} width={geometry.bodyWidth} height={bodyHeight} rx="1" />
                  {item.volume > 0 && <rect className="volume-bar" x={item.x - geometry.bodyWidth / 2} y={item.volumeY} width={geometry.bodyWidth} height={Math.max(VOLUME_BOTTOM - item.volumeY, 1)} />}
                  <rect className="candle-hit" x={item.x - Math.max(geometry.bodyWidth, 8)} y={PRICE_TOP} width={Math.max(geometry.bodyWidth * 2, 16)} height={VOLUME_BOTTOM - PRICE_TOP} />
                </g>
              );
            })}
            {hoveredPoint && (
              <line className="candle-crosshair" x1={hoveredPoint.x} x2={hoveredPoint.x} y1={PRICE_TOP} y2={VOLUME_BOTTOM} />
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
        <span className="chart-hint">Drag to pan · wheel or +/− to zoom</span>
      </div>
    </section>
  );
}
