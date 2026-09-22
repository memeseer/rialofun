import { useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  ChartLineUp,
  Database,
  Lightning,
} from "@phosphor-icons/react";
import { fetchMarketMetadata } from "./dataApi.js";
import "./landing.css";

const TESTNET_URL = "https://www.testnet.rialofun.xyz/";

function shortAddress(value = "") {
  return value.length > 13 ? `${value.slice(0, 5)}…${value.slice(-4)}` : value;
}

export function Landing() {
  const [markets, setMarkets] = useState([]);

  useEffect(() => {
    document.title = "RialoFun | Launch markets on Rialo";
    let active = true;
    fetchMarketMetadata()
      .then((items) => {
        if (active) setMarkets(items.slice(0, 5));
      })
      .catch(() => undefined);
    return () => { active = false; };
  }, []);

  const marketPreview = useMemo(() => markets.slice(0, 3), [markets]);

  return (
    <main className="promo-shell">
      <header className="promo-nav">
        <a className="promo-brand" href="#top" aria-label="RialoFun home">
          <img src="/assets/rialofun-crt.png" alt="" />
          <span>Rialo<strong>Fun</strong></span>
        </a>
        <nav aria-label="Main navigation">
          <a href="#protocol">Protocol</a>
          <a href="#live">Live feed</a>
        </nav>
        <a className="promo-nav-cta" href={TESTNET_URL}>
          Open testnet <ArrowUpRight size={17} weight="bold" />
        </a>
      </header>

      <section className="promo-hero" id="top">
        <div className="promo-copy">
          <p className="promo-kicker"><span /> Built for Rialo testnet</p>
          <h1>A market begins with one transaction.</h1>
          <p className="promo-lede">
            Launch Token-2022 markets, trade bonding curves, and move liquidity into a real Rialo DEX pool.
          </p>
          <div className="promo-actions">
            <a className="promo-primary" href={TESTNET_URL}>
              Launch on testnet <ArrowRight size={20} weight="bold" />
            </a>
            <a className="promo-text-link" href="#protocol">See how it works</a>
          </div>
          <dl className="promo-facts" aria-label="Protocol facts">
            <div><dt>Supply</dt><dd>1B fixed</dd></div>
            <div><dt>Curve fee</dt><dd>1.00%</dd></div>
            <div><dt>Pool fee</dt><dd>0.30%</dd></div>
          </dl>
        </div>

        <div className="promo-terminal" aria-label="Live RialoFun market preview">
          <div className="terminal-bar">
            <span><i /> Rialo testnet feed</span>
            <code>LIVE</code>
          </div>
          <div className="terminal-chart" aria-hidden="true">
            <svg viewBox="0 0 620 250" preserveAspectRatio="none">
              <g className="terminal-grid">
                <path d="M0 50H620M0 100H620M0 150H620M0 200H620" />
                <path d="M103 0V250M206 0V250M309 0V250M412 0V250M515 0V250" />
              </g>
              <path className="terminal-area" d="M0 213L48 205L86 214L132 181L172 188L218 143L264 153L306 112L348 124L391 78L434 91L476 52L520 64L566 27L620 38V250H0Z" />
              <path className="terminal-line" d="M0 213L48 205L86 214L132 181L172 188L218 143L264 153L306 112L348 124L391 78L434 91L476 52L520 64L566 27L620 38" />
            </svg>
            <div className="terminal-price"><small>RFUN / RLO</small><strong>Curve active</strong></div>
          </div>
          <div className="terminal-market-list">
            {(marketPreview.length ? marketPreview : [
              { id: "sync", ticker: "SYNCING", creator: "Indexer online" },
              { id: "curve", ticker: "CURVE", creator: "Awaiting live markets" },
              { id: "pool", ticker: "POOL", creator: "Rialo testnet" },
            ]).map((market, index) => (
              <div className="terminal-market" key={market.id || index}>
                <span className="terminal-rank">0{index + 1}</span>
                <div><b>{market.ticker}</b><small>{shortAddress(market.creator)}</small></div>
                <span className="terminal-state">{market.image ? "ON-CHAIN" : "READY"}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="protocol-flow" id="protocol">
        <div className="flow-intro">
          <span>Protocol route</span>
          <h2>From an idea to open liquidity.</h2>
          <p>One product flow. Every meaningful action waits for your wallet and settles on testnet.</p>
        </div>
        <ol className="flow-track">
          <li><Lightning size={24} weight="fill" /><span>01</span><div><b>Launch</b><p>Create the mint, market state, and first buy together.</p></div></li>
          <li><ChartLineUp size={24} weight="bold" /><span>02</span><div><b>Trade</b><p>Move through a transparent constant-product curve.</p></div></li>
          <li><Database size={24} weight="bold" /><span>03</span><div><b>Graduate</b><p>Migrate reserves into vaults and an LP-backed DEX pool.</p></div></li>
        </ol>
      </section>

      <section className="promo-live" id="live">
        <div className="live-copy">
          <p>Public by default</p>
          <h2>Markets anyone can inspect.</h2>
        </div>
        <div className="live-statement">
          <p>Token metadata, trades, candles, pool state, and explorer links stay visible across browsers.</p>
          <a href={TESTNET_URL}>Enter the live terminal <ArrowUpRight size={18} weight="bold" /></a>
        </div>
        <div className="live-count">
          <strong>{markets.length || "LIVE"}</strong>
          <span>{markets.length === 1 ? "indexed market loaded" : markets.length ? "latest indexed markets" : "indexer connected"}</span>
        </div>
      </section>

      <footer className="promo-footer">
        <div><img src="/assets/rialofun-crt.png" alt="" /><b>RialoFun</b></div>
        <p>Experimental markets on Rialo testnet. Test tokens have no monetary value.</p>
        <a href={TESTNET_URL}>testnet.rialofun.xyz <ArrowUpRight size={14} /></a>
      </footer>
    </main>
  );
}
