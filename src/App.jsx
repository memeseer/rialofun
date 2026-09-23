import { useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  ArrowSquareOut,
  CaretDown,
  ChartLineUp,
  ImageSquare,
  Plus,
  UploadSimple,
  Wallet,
  X,
} from "@phosphor-icons/react";
import {
  ECONOMICS,
  createMarket,
  formatRlo,
  formatTokenPrice,
  progress,
  quote,
  spotPrice,
} from "./economy.js";
import {
  getRloBalance,
  discoverOnchainMarkets,
  graduateOnchain,
  liquidityOnchain,
  launchOnchain,
  loadOnchainMarkets,
  readOnchainMarket,
  saveOnchainMarket,
  tradeOnchain,
} from "./rialoSettlement.js";
import {
  fetchMarketMetadata,
  fetchMarketCandles,
  fetchMarketTrades,
  publishMarketMetadata,
  uploadTokenImage,
} from "./dataApi.js";
import { TokenChart } from "./TokenChart.jsx";

const filters = ["Latest", "Trending", "Top volume", "Newest"];
const compact = (number) =>
  new Intl.NumberFormat("en", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(number);

const shortAddress = (value = "") =>
  value.length > 13 ? `${value.slice(0, 5)}…${value.slice(-4)}` : value;
const explorerAccount = (address) => `https://rialo-explorer-testnet-direct.vercel.app/accounts/${address}?network=testnet`;
const explorerTransaction = (signature) => `https://rialo-explorer-testnet-direct.vercel.app/txs/${signature}?network=testnet`;

const relativeTime = (value) => {
  const elapsed = Date.now() - Number(value || 0);
  if (!Number.isFinite(elapsed) || elapsed < 0) return "now";
  if (elapsed < 60_000) return "now";
  if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)}m`;
  if (elapsed < 86_400_000) return `${Math.floor(elapsed / 3_600_000)}h`;
  return `${Math.floor(elapsed / 86_400_000)}d`;
};

function TokenVisual({ market }) {
  const [visibleImage, setVisibleImage] = useState("");

  useEffect(() => {
    if (!market.image) {
      setVisibleImage("");
      return undefined;
    }

    let active = true;
    const preload = new Image();
    preload.onload = () => {
      if (active) setVisibleImage(market.image);
    };
    preload.src = market.image;
    return () => {
      active = false;
      preload.onload = null;
    };
  }, [market.image]);

  return visibleImage ? (
    <img
      className="token-image"
      src={visibleImage}
      alt={`${market.name} token artwork`}
    />
  ) : (
    <div className="token-image empty">
      <ImageSquare size={42} weight="light" />
      <span>Creator image</span>
    </div>
  );
}

function MarketCard({ market, onTrade }) {
  const isPool = market.phase === "pool";
  return (
    <article className="market-card">
      <TokenVisual market={market} />
      <div className="card-top">
        <h3>{market.ticker}</h3>
        <span className={isPool ? "pool-state" : "positive"}>
          {isPool ? "POOL LIVE" : "CURVE"}
        </span>
      </div>
      <p className="market-price">
        {formatTokenPrice(spotPrice(market))}
        <small> / token</small>
      </p>
      <div className="curve">
        <div>
          <span>
            {isPool
              ? "Liquidity pool"
              : `${progress(market).toFixed(1)}% to pool`}
          </span>
          <b>
            {isPool
              ? formatRlo(market.poolRlo)
              : `${compact(ECONOMICS.graduationSold - (ECONOMICS.totalSupply - market.tokenReserve))} left`}
          </b>
        </div>
        <i>
          <span style={{ width: `${isPool ? 100 : progress(market)}%` }} />
        </i>
      </div>
      <div className="card-meta">
        <span>Vol&nbsp; {formatRlo(market.volumeRlo)}</span>
        <span>Net buyers&nbsp; {market.netBuyers ?? 0}</span>
      </div>
      <div className="creator">
        <i /> <span>Created by&nbsp;</span>
        <code title={market.creator}>{shortAddress(market.creator)}</code>
        <button onClick={() => { window.location.hash = `token/${market.id}`; onTrade(market.id); }}>
          Trade <ArrowRight size={14} />
        </button>
      </div>
    </article>
  );
}

function TradeHistory({ trades, ticker }) {
  if (!trades.length)
    return (
      <div className="empty-history">
        <strong>No trades yet</strong>
        <span>The first confirmed trade will appear here.</span>
      </div>
    );

  return (
    <div className="history-table" role="table" aria-label={`${ticker} confirmed trades`}>
      <div className="history-row history-head" role="row">
        <span>Trader</span><span>Side</span><span>Value</span><span>Tokens</span>
        <span>Avg price</span><span>Time</span><span aria-label="Transaction" />
      </div>
      {trades.map((item) => (
        <div className="history-row" role="row" key={item.signature}>
          <span className="history-account" data-label="Trader">
            <i aria-hidden="true" />
            <code title={item.account}>{shortAddress(item.account)}</code>
          </span>
          <strong data-label="Side" className={`history-side ${item.side === "BUY" ? "is-buy" : "is-sell"}`}>
            {item.side}
          </strong>
          <span data-label="Value" className="history-number" title={item.rloAmount == null ? "Rialo RPC did not provide the native balance change" : undefined}>{item.rloAmount == null ? "—" : formatRlo(Number(item.rloAmount))}</span>
          <span data-label="Tokens" className="history-number">
            {item.tokenAmount ? `${compact(Number(item.tokenAmount))} ${ticker}` : "Pending index"}
          </span>
          <span data-label="Price" className="history-number">
            {Number(item.price) > 0 ? formatTokenPrice(Number(item.price)) : "—"}
          </span>
          <time data-label="Time" dateTime={new Date(Number(item.time)).toISOString()} title={new Date(Number(item.time)).toLocaleString()}>
            {relativeTime(item.time)}
          </time>
          <a
            className="history-tx"
            href={explorerTransaction(item.signature)}
            target="_blank"
            rel="noreferrer"
            aria-label={`Open ${shortAddress(item.signature)} in Rialo explorer`}
            title="Open transaction in Rialo explorer"
          >
            <ArrowSquareOut size={16} weight="bold" />
          </a>
        </div>
      ))}
    </div>
  );
}

export function App() {
  const [activeFilter, setActiveFilter] = useState("Latest");
  const [wallet, setWallet] = useState("");
  const [walletAccount, setWalletAccount] = useState(null);
  const [notice, setNotice] = useState("");
  const [markets, setMarkets] = useState(() => loadOnchainMarkets().filter((market) => !["rialo-live", "rialo-graduation"].includes(market.id)));
  const [launchOpen, setLaunchOpen] = useState(false);
  const [launchRoute, setLaunchRoute] = useState(() => window.location.hash === "#launch");
  const [theme, setTheme] = useState(() => localStorage.getItem("rialofun:theme") || "light");
  const [tradeId, setTradeId] = useState("");
  const [detailRoute, setDetailRoute] = useState(() => window.location.hash.startsWith("#token/"));
  useEffect(() => { const onHash = () => { const match = window.location.hash.match(/^#token\/([^/]+)/); const isLaunch=window.location.hash==="#launch"; setDetailRoute(Boolean(match)); setLaunchRoute(isLaunch); setLaunchOpen(isLaunch); setTradeId(match ? decodeURIComponent(match[1]) : ""); }; onHash(); window.addEventListener("hashchange", onHash); return () => window.removeEventListener("hashchange", onHash); }, []);
  useEffect(() => { localStorage.setItem("rialofun:theme", theme); }, [theme]);
  const [form, setForm] = useState({
    name: "",
    ticker: "",
    image: "",
    description: "",
    website: "",
    twitter: "",
    initialBuy: "1",
  });
  const [tradeSide, setTradeSide] = useState("buy");
  const [tradeInput, setTradeInput] = useState("1");
  const [liquidityOpen, setLiquidityOpen] = useState(false);
  const [liquiditySide, setLiquiditySide] = useState("add");
  const [liquidityRlo, setLiquidityRlo] = useState("1");
  const [liquidityToken, setLiquidityToken] = useState("1");
  const [portfolio, setPortfolio] = useState({ rlo: 0, tokens: {} });
  const [pending, setPending] = useState(false);
  const [chartRange, setChartRange] = useState("5m");
  const [confirmedTrades, setConfirmedTrades] = useState([]);
  const [candles, setCandles] = useState([]);
  const [candlesLoading, setCandlesLoading] = useState(false);
  const [candlesError, setCandlesError] = useState(false);
  const selected = markets.find((market) => market.id === tradeId) ?? null;
  useEffect(() => { if (detailRoute && tradeId && markets.length && !selected) window.location.hash = "explore"; }, [detailRoute, tradeId, markets, selected]);
  useEffect(() => {
    if (!selected) {
      setConfirmedTrades([]);
      return;
    }
    setChartRange("5m");
    setConfirmedTrades([]);
    let active = true;
    const refresh = () => fetchMarketTrades(selected.id, selected.onchain?.state)
      .then((remote) => { if (active) setConfirmedTrades(remote); })
      .catch(() => undefined);
    void refresh();
    const timer = window.setInterval(refresh, 12_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [selected?.id]);
  useEffect(() => {
    if (!selected) {
      setCandles([]);
      return undefined;
    }
    let active = true;
    const refresh = async () => {
      setCandlesLoading(true);
      try {
        const indexed = await fetchMarketCandles(selected.id, selected.onchain?.state, chartRange);
        if (active) { setCandles(indexed); setCandlesError(false); }
      } catch {
        if (active) setCandlesError(true);
      } finally {
        if (active) setCandlesLoading(false);
      }
    };
    void refresh();
    const timer = window.setInterval(refresh, 12_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [selected?.id, selected?.onchain?.state, chartRange]);
  const tradeQuote = selected
    ? quote(selected, tradeSide, Number(tradeInput))
    : null;

  const visibleMarkets = useMemo(() => {
    const next = [...markets];
    if (activeFilter === "Trending")
      return next.sort((a, b) => progress(b) - progress(a));
    if (activeFilter === "Top volume")
      return next.sort((a, b) => b.volumeRlo - a.volumeRlo);
    if (activeFilter === "Newest")
      return next.sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
    return next.sort((a, b) => Number(b.updatedAt || b.createdAt || 0) - Number(a.updatedAt || a.createdAt || 0));
  }, [activeFilter, markets]);

  const connectWallet = async () => {
    const provider = window.rialoTestnetWallet;
    if (!provider)
      return setNotice(
        "Rialo Testnet Wallet was not found. Reload after enabling the extension.",
      );
    try {
      const result = await provider.features["standard:connect"].connect();
      const account = result.accounts?.[0];
      const address = account?.address;
      if (!address) throw new Error("Wallet did not return an address.");
      setWallet(address);
      setWalletAccount(account);
      const rlo = await getRloBalance(address);
      setPortfolio((current) => ({ ...current, rlo }));
      setNotice(`Wallet connected. Testnet balance: ${formatRlo(rlo)}.`);
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "Wallet connection was cancelled.",
      );
    }
  };

  useEffect(() => {
    const announce = () =>
      setNotice("Rialo Testnet Wallet detected — connect when ready.");
    window.addEventListener("rialo-testnet-wallet-ready", announce);
    return () =>
      window.removeEventListener("rialo-testnet-wallet-ready", announce);
  }, []);

  const syncMarket = async (market, address = wallet) => {
    if (!market?.onchain) return market;
    const chain = await readOnchainMarket(market.onchain, address);
    const next = {
      ...market,
      phase: chain.phase,
      virtualRlo: chain.virtualRlo,
      tokenReserve: chain.tokenReserve,
      actualRlo: chain.actualRlo,
      platformFees: chain.fees,
      poolRlo: chain.phase === "pool" ? chain.actualRlo : 0,
      poolTokens: chain.phase === "pool" ? chain.tokenReserve : 0,
    };
    setMarkets((current) => current.map((item) => item.onchain?.state === market.onchain.state
      ? { ...item, phase: chain.phase, virtualRlo: chain.virtualRlo, tokenReserve: chain.tokenReserve,
        actualRlo: chain.actualRlo, platformFees: chain.fees,
        poolRlo: chain.phase === "pool" ? chain.actualRlo : 0,
        poolTokens: chain.phase === "pool" ? chain.tokenReserve : 0,
        dataLoading: false, onchainHydrated: true }
      : item));
    if (address)
      setPortfolio((current) => ({
        ...current,
        tokens: { ...current.tokens, [market.id]: chain.balance },
      }));
    return next;
  };
  useEffect(() => {
    loadOnchainMarkets().filter((market) => !["rialo-live", "rialo-graduation"].includes(market.id))
      .forEach((market) => void syncMarket(market, wallet).catch(() => undefined));
    let active = true;
    const refresh = () => discoverOnchainMarkets().then((found) => {
      if (!active) return;
      setMarkets((current) => {
        const byState = new Map(found.map((item) => [item.onchain.state, item]));
        return current.map((item) => {
          const chain = byState.get(item.onchain?.state);
          return chain ? { ...chain, ...item, onchain: { ...chain.onchain, ...item.onchain },
            phase: chain.phase, virtualRlo: chain.virtualRlo, tokenReserve: chain.tokenReserve,
            actualRlo: chain.actualRlo, poolRlo: chain.phase === "pool" ? chain.actualRlo : 0,
            poolTokens: chain.phase === "pool" ? chain.tokenReserve : 0,
            onchainHydrated: true, dataLoading: false } : item;
        }).concat(found.filter((item) => !current.some((existing) => existing.onchain?.state === item.onchain.state)));
      });
    }).catch(() => undefined);
    void refresh();
    const timer = window.setInterval(refresh, 30_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [wallet]);
  useEffect(() => {
    const hydrateSharedMetadata = () => fetchMarketMetadata().then((metadata) => setMarkets((current) => {
      const next = [...current];
      for (const saved of metadata) {
        const index = next.findIndex((market) => market.id === saved.id || market.onchain?.state === saved.state);
        const profilePublished = Boolean(saved.profilePublished ?? saved.image);
        const patch = {
          creator: saved.creator,
          ...(profilePublished ? {
            name: saved.name, ticker: saved.ticker, image: saved.image,
            description: saved.description || "", website: saved.website || "",
            twitter: saved.twitter || "", metadataPending: false,
          } : {}),
          createdAt: Number(saved.createdAt || 0) || undefined,
          updatedAt: Number(saved.updatedAt || saved.createdAt || 0) || undefined,
          volumeRlo: Number(saved.volumeRlo) || 0,
          netBuyers: Number(saved.netBuyers) || 0,
        };
        if (index >= 0) {
          next[index] = { ...next[index], ...patch, createdAt: patch.createdAt || next[index].createdAt, updatedAt: patch.updatedAt || next[index].updatedAt };
        } else if (saved.state && saved.mint) {
          const snapshot = {};
          if (saved.phase) snapshot.phase = saved.phase;
          if (saved.virtualRlo != null && Number(saved.virtualRlo) > 0) snapshot.virtualRlo = Number(saved.virtualRlo);
          if (saved.tokenReserve != null && Number(saved.tokenReserve) > 0) snapshot.tokenReserve = Number(saved.tokenReserve);
          if (saved.actualRlo != null && Number.isFinite(Number(saved.actualRlo))) snapshot.actualRlo = Number(saved.actualRlo);
          next.push({
            ...createMarket({ id: saved.id, name: saved.name, ticker: saved.ticker, creator: saved.creator, image: saved.image }),
            ...snapshot,
            ...patch,
            id: saved.id,
            onchain: { program: "2iquqTG5Frnj64kzwa5RFWawuJpXg3fYhMkTPiT22AiM", state: saved.state, mint: saved.mint },
          });
        }
      }
      return next;
    })).catch(() => undefined);
    void hydrateSharedMetadata();
    const timer = window.setInterval(hydrateSharedMetadata, 12_000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    const pending = loadOnchainMarkets().filter((market) => typeof market.image === "string" && market.image.startsWith("data:"));
    if (!pending.length) return;
    void Promise.all(pending.map(async (market) => {
      try {
        const image = await uploadTokenImage(market.image);
        const synced = { ...market, image, updatedAt: Date.now() };
        saveOnchainMarket(synced);
        await publishMarketMetadata(synced);
        setMarkets((current) => current.map((item) => item.id === synced.id ? { ...item, image, updatedAt: synced.updatedAt } : item));
      } catch {
        // Retry on the next load; the local data URI remains available in this browser.
      }
    }));
  }, []);

  const launch = async (event) => {
    event.preventDefault();
    if (!wallet)
      return setNotice("Connect your Testnet Wallet before preparing a curve.");
    if (!form.name.trim() || !form.ticker.trim()) return;
    if (!form.image) return setNotice("Upload a token image before launch.");
    const ticker = form.ticker.toUpperCase();
    let persistentImage;
    try {
      persistentImage = await uploadTokenImage(form.image);
    } catch (error) {
      return setNotice(error instanceof Error ? `Image upload failed; token not launched. ${error.message}` : "Image upload failed; token not launched.");
    }
    let market = createMarket({
      id: `${ticker}-${Date.now()}`,
      name: form.name.trim(),
      ticker,
      creator: wallet,
      image: persistentImage,
      description: form.description.trim(),
      website: form.website.trim(),
      twitter: form.twitter.trim(),
    });
    market.updatedAt = Date.now();
    const initialBuy = Number(form.initialBuy || 0);
    if (!Number.isFinite(initialBuy) || initialBuy < 0)
      return setNotice("Initial buy must be a valid RLO amount.");
    if (initialBuy <= 0)
      return setNotice("The first atomic buy must be greater than zero.");
    if (initialBuy > portfolio.rlo)
      return setNotice(
        "Your testnet RLO balance is too low for the initial buy and account rent.",
      );
    setPending(true);
    try {
      const preview = quote(market, "buy", initialBuy);
      if (preview.error) throw new Error(preview.error);
      const deployed = await launchOnchain({
        walletAddress: wallet,
        name: market.name,
        ticker,
        initialBuy: String(initialBuy),
        minTokensOut: (preview.output * 0.99).toFixed(6),
      });
      market.id = `chain-${deployed.state.slice(0, 8)}`;
      market = { ...market, onchain: deployed, virtualRlo: 0, tokenReserve: 0, actualRlo: 0, poolRlo: 0, poolTokens: 0, volumeRlo: 0, netBuyers: 0, dataLoading: true };
      try { market = await syncMarket(market, wallet); } catch { /* The launch tx already succeeded; keep it discoverable while RPC catches up. */ }
      saveOnchainMarket(market);
      void getRloBalance(wallet).then((rlo) => setPortfolio((current) => ({ ...current, rlo }))).catch(() => undefined);
      setMarkets((current) => [
        market,
        ...current.filter((item) => item.id !== market.id),
      ]);
      setLaunchOpen(false);
      setTradeId(market.id);
      window.location.hash = `token/${market.id}`;
      setForm({ name: "", ticker: "", image: "", description: "", website: "", twitter: "", initialBuy: "1" });
      try {
        await publishMarketMetadata(market, walletAccount);
        setNotice(`${ticker} is live. Launch transaction ${deployed.signature.slice(0, 10)}… Shared profile published.`);
      } catch (error) {
        const pendingProfile = { ...market, metadataPending: true };
        saveOnchainMarket(pendingProfile);
        setMarkets((items) => items.map((item) => item.id === market.id ? pendingProfile : item));
        setNotice(`${ticker} is live on-chain, but its shared profile still needs your wallet signature. ${error instanceof Error ? error.message : ""}`);
      }
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "Launch transaction failed.",
      );
    } finally {
      setPending(false);
    }
  };

  const applyTrade = async () => {
    if (!selected || !wallet || !tradeQuote || tradeQuote.error) return;
    const amount = Number(tradeInput);
    const holdings = portfolio.tokens[selected.id] ?? 0;
    if (selected.onchain) {
      if (tradeSide === "buy" && amount > portfolio.rlo)
        return setNotice("Your testnet RLO balance is too low for this trade.");
      if (tradeSide === "sell" && amount > holdings)
        return setNotice(`You hold ${compact(holdings)} ${selected.ticker}.`);
      setPending(true);
      try {
        const minimum = String(
          (tradeQuote.output * 0.99).toFixed(tradeSide === "buy" ? 6 : 9),
        );
        const result = await tradeOnchain({
          walletAddress: wallet,
          market: { ...selected.onchain, id: selected.id },
          side: tradeSide,
          amount: String(amount),
          minOut: minimum,
        });
        const synced = await syncMarket(selected, wallet);
        setMarkets((current) => current.map((item) => item.id === selected.id ? { ...item, updatedAt: Date.now() } : item));
        const rlo = await getRloBalance(wallet);
        setPortfolio((current) => ({ ...current, rlo }));
        void fetchMarketTrades(selected.id, selected.onchain?.state).then(setConfirmedTrades).catch(() => undefined);
        setNotice(
          `${tradeSide === "buy" ? "Buy" : "Sell"} settled on testnet: ${result.signature.slice(0, 12)}… Trade history updates after indexer confirmation.`,
        );
      } catch (error) {
        setNotice(
          error instanceof Error ? error.message : "Trade transaction failed.",
        );
      } finally {
        setPending(false);
      }
      return;
    }
    setNotice("This market is not available for on-chain trading.");
  };
  const graduateMarket = async () => {
    if (!selected?.onchain || !wallet) return;
    setPending(true);
    try { const pool = await graduateOnchain({ walletAddress: wallet, market: selected.onchain }); const next={...selected,onchain:{...selected.onchain,pool},phase:"pool",poolRlo:selected.actualRlo,poolTokens:selected.tokenReserve}; setMarkets(items=>items.map(item=>item.id===next.id?next:item)); saveOnchainMarket(next); setNotice(`Pool created: ${pool.pool.slice(0,8)}… Transaction: ${pool.signature.slice(0,10)}…`); }
    catch(error){setNotice(error instanceof Error?error.message:"Graduation failed.");} finally {setPending(false);}
  };
  const applyLiquidity = async () => { if(!selected?.onchain||!wallet)return;setPending(true);try{const result=await liquidityOnchain({walletAddress:wallet,market:selected.onchain,side:liquiditySide,rloAmount:liquidityRlo,tokenAmount:liquidityToken,lpAmount:liquidityToken,minOut:"0"});setNotice(`Liquidity transaction submitted: ${result.signature.slice(0,12)}…`);setLiquidityOpen(false);}catch(error){setNotice(error instanceof Error?error.message:"Liquidity transaction failed.");}finally{setPending(false);} };

  const readImage = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => { const image=new Image(); image.onload=()=>{const size=640,canvas=document.createElement("canvas"),context=canvas.getContext("2d");canvas.width=size;canvas.height=size;const scale=Math.max(size/image.width,size/image.height),width=image.width*scale,height=image.height*scale;context.drawImage(image,(size-width)/2,(size-height)/2,width,height);let quality=.82,encoded=canvas.toDataURL("image/webp",quality);while(encoded.length*.75>320000&&quality>.42){quality-=.08;encoded=canvas.toDataURL("image/webp",quality)}setForm(current=>({...current,image:encoded}));};image.src=String(reader.result); };
    reader.readAsDataURL(file);
  };

  return (
    <main className={`app-shell theme-${theme} ${detailRoute ? "token-route" : ""} ${launchRoute ? "launch-route" : ""}`}>
      <header className="topbar">
        <a className="brand" href="#explore" onClick={() => { setTradeId(""); setLaunchOpen(false); }}>
          <img
            src="/assets/rialofun-crt.png"
            alt="RialoFun retro terminal logo"
          />
          <span>
            Rialo<span>Fun</span>
          </span>
        </a>
        <nav>
          <a className={!detailRoute && !launchRoute ? "active" : ""} href="#explore">
            Explore
          </a>
          <a className={launchRoute ? "active" : ""} href="#launch">
            Launch
          </a>
        </nav>
        <div className="header-actions">
          <button className="theme-toggle" onClick={() => setTheme(value => value === "light" ? "dark" : "light")} aria-label="Toggle color theme">{theme === "light" ? "Dark" : "Light"}</button>
          <button
            className="button primary compact"
            onClick={() => { window.location.hash="launch"; }}
          >
            <Plus size={19} weight="bold" /> Create token
          </button>
          <button className="button ghost compact" onClick={connectWallet}>
            <Wallet size={19} weight="bold" />{" "}
            {wallet
              ? `${wallet.slice(0, 6)}…${wallet.slice(-4)}`
              : "Connect wallet"}
          </button>
        </div>
      </header>
      <section className="hero" id="top">
        <div>
          <h1>
            Launch a token.
            <br />
            <em>Grow its pool.</em>
          </h1>
          <p className="subhead">Bonding curve → creator-triggered pool migration → on-chain trading.</p>
          <button
            className="button primary hero-button"
            onClick={() => setLaunchOpen(true)}
          >
            Create token <ArrowRight size={22} weight="bold" />
          </button>
          <p className="hero-note">Create on Rialo Testnet · trades require wallet approval</p>
        </div>
        <div className="hero-chart">
          <div className="hero-labels">
            <span>1B SUPPLY</span>
            <span>1% CURVE FEE</span>
            <span>0.3% POOL FEE</span>
            <span>800M TO GRADUATE</span>
          </div>
          <div className="chart-card">
            <img
              src="/assets/rialofun-crt.png"
              alt="RialoFun market terminal"
            />
            <strong>
              CURVE
              <br />→ POOL
            </strong>
          </div>
        </div>
      </section>
      <section className="market-section" id="explore">
        <div className="section-title">
          <h2>
            Live curves <span>↗</span>
          </h2>
          <div className="local-balance">
            {wallet ? "Wallet balance" : "Connect wallet"} <b>{wallet ? formatRlo(portfolio.rlo) : "—"}</b>
          </div>
        </div>
        <div className="trend-row">
          {markets.slice(0, 4).map((market) => (
            <button
              key={market.id}
              className="trend-item"
              onClick={() => { window.location.hash = `token/${market.id}`; setTradeId(market.id); }}
            >
              <span>{market.ticker}</span>
              <b>{formatTokenPrice(spotPrice(market))}</b>
              <strong
                className={market.phase === "pool" ? "pool-state" : "positive"}
              >
                {market.phase === "pool"
                  ? "POOL"
                  : `${progress(market).toFixed(0)}%`}
              </strong>
              <small>
                {market.phase === "pool"
                  ? `${formatRlo(market.poolRlo)} LP`
                  : "bonding curve"}
              </small>
            </button>
          ))}
        </div>
        <div className="toolbar">
          <div className="filters" role="tablist">
            {filters.map((filter) => (
              <button
                key={filter}
                className={activeFilter === filter ? "selected" : ""}
                onClick={() => setActiveFilter(filter)}
              >
                {filter}
              </button>
            ))}
          </div>
          <div className="toolbar-actions">
            <span className="economy-note">
              <ChartLineUp size={17} /> Live on-chain markets only
            </span>
            <button className="category">
              All categories <CaretDown size={16} weight="bold" />
            </button>
          </div>
        </div>
        <div className="market-grid">
          {visibleMarkets.map((market) => (
            <MarketCard market={market} onTrade={setTradeId} key={market.id} />
          ))}
          {!visibleMarkets.length && <div className="empty-markets"><b>No indexed markets yet</b><span>New token profiles appear here after their launch metadata is signed and indexed.</span></div>}
        </div>
      </section>
      {notice && (
        <button className="notice" onClick={() => setNotice("")}>
          {notice} <X size={16} />
        </button>
      )}
      {launchOpen && (
        <div
          className={`modal-backdrop ${launchRoute ? "launch-route-shell" : ""}`}
          onMouseDown={launchRoute ? undefined : () => setLaunchOpen(false)}
        >
          <section
            className="launch-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Create a token"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <button
              className="close"
              onClick={() => { setLaunchOpen(false); window.location.hash="explore"; }}
              aria-label="Close"
            >
              <X size={21} />
            </button>
            <img src="/assets/rialofun-crt.png" alt="" />
            <p className="eyebrow">CREATE TOKEN</p>
            <h2>Launch a new market.</h2>
            <p>
              1B supply · 30 RLO virtual reserve · 1% curve fee · pool at 800M
              sold.
            </p>
            <form onSubmit={launch}>
              <label>
                Token name
                <input
                  value={form.name}
                  onChange={(event) =>
                    setForm({ ...form, name: event.target.value })
                  }
                  placeholder="e.g. Nova"
                  autoFocus
                />
              </label>
              <label>
                Ticker
                <input
                  value={form.ticker}
                  onChange={(event) =>
                    setForm({ ...form, ticker: event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10) })
                  }
                  placeholder="NOVA"
                  maxLength="10"
                  required
                />
              </label>
              <label>Short description <textarea maxLength={280} rows={3} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} placeholder="What is this token about?" /></label>
              <label>Website <input type="url" value={form.website} onChange={(event) => setForm({ ...form, website: event.target.value })} placeholder="https://example.com" /></label>
              <label>X / Twitter <input value={form.twitter} onChange={(event) => setForm({ ...form, twitter: event.target.value.slice(0, 100) })} placeholder="https://x.com/project" /></label>
              <label>
                Initial buy (RLO)
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={form.initialBuy}
                  onChange={(event) =>
                    setForm({ ...form, initialBuy: event.target.value })
                  }
                />
              </label>
              <label className="image-upload">
                <UploadSimple size={18} weight="bold" />{" "}
                {form.image
                  ? "Image ready — choose another"
                  : "Upload token image"}
                <input type="file" accept="image/*" onChange={readImage} />
              </label>
              {form.image && (
                <img
                  className="upload-preview"
                  src={form.image}
                  alt="Selected token preview"
                />
              )}
              <button className="button primary" type="submit" disabled={pending || !form.image}>
                {pending ? "Waiting for wallet…" : "Create + buy atomically"} <ArrowRight size={20} />
              </button>
            </form>
          </section>
        </div>
      )}
      {selected && (
        <div
          className={`modal-backdrop trade-screen ${detailRoute ? "detail-route token-route-shell" : ""}`}
          onMouseDown={detailRoute ? undefined : () => setTradeId("")}
        >
          <section
            className="trade-modal"
            role="dialog"
            aria-modal="true"
            aria-label={`Trade ${selected.ticker}`}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <button
              className="close"
              onClick={() => { setTradeId(""); window.location.hash = "explore"; }}
              aria-label="Close"
            >
              <X size={21} />
            </button>
            <div className="trade-summary">
              <p className="eyebrow">
                {selected.phase === "pool" ? "LIQUIDITY POOL" : selected.phase === "graduation-ready" ? "READY TO GRADUATE" : "BONDING CURVE"}
              </p>
              <h2>
                {selected.name} <span>{selected.ticker}</span>
              </h2>
              <p className="trade-price">
                {formatTokenPrice(spotPrice(selected))}
                <small> per token</small>
              </p>
              {detailRoute && <TokenChart ticker={selected.ticker} candles={candles} price={spotPrice(selected)} range={chartRange} loading={candlesLoading} error={candlesError} onRangeChange={setChartRange} />}
              <section className="token-profile">
                {selected.description && <p>{selected.description}</p>}
                <div className="token-addresses">
                  <span>Creator <a href={explorerAccount(selected.creator)} target="_blank" rel="noreferrer">{shortAddress(selected.creator)} <ArrowSquareOut size={13} /></a></span>
                  {selected.onchain?.mint && <span>Token <a href={explorerAccount(selected.onchain.mint)} target="_blank" rel="noreferrer">{shortAddress(selected.onchain.mint)} <ArrowSquareOut size={13} /></a></span>}
                  {selected.onchain?.pool?.pool && <span>Pool <a href={explorerAccount(selected.onchain.pool.pool)} target="_blank" rel="noreferrer">{shortAddress(selected.onchain.pool.pool)} <ArrowSquareOut size={13} /></a></span>}
                  {selected.website && <a href={selected.website} target="_blank" rel="noreferrer">Website <ArrowSquareOut size={13} /></a>}
                  {selected.twitter && <a href={selected.twitter.startsWith("http") ? selected.twitter : `https://x.com/${selected.twitter.replace(/^@/, "")}`} target="_blank" rel="noreferrer">X / Twitter <ArrowSquareOut size={13} /></a>}
                </div>
                {selected.metadataPending && wallet === selected.creator && <button className="button ghost" disabled={pending} onClick={async () => { setPending(true); try { await publishMarketMetadata(selected, walletAccount); setMarkets((items) => items.map((item) => item.id === selected.id ? { ...item, metadataPending: false } : item)); setNotice("Shared token profile published."); } catch (error) { setNotice(error instanceof Error ? error.message : "Could not publish token metadata."); } finally { setPending(false); } }}>Publish shared profile</button>}
              </section>
              <div className="metric-grid">
                <div>
                  <span>Progress</span>
                  <b>
                    {selected.phase === "pool"
                      ? "Graduated"
                      : `${progress(selected).toFixed(2)}%`}
                  </b>
                </div>
                <div>
                  <span>Liquidity</span>
                  <b>
                    {selected.phase === "pool"
                      ? formatRlo(selected.poolRlo)
                      : formatRlo(selected.actualRlo)}
                  </b>
                </div>
                <div>
                  <span>Volume</span>
                  <b>{formatRlo(selected.volumeRlo)}</b>
                </div>
                <div>
                  <span>Your tokens</span>
                  <b>{compact(portfolio.tokens[selected.id] ?? 0)}</b>
                </div>
              </div>
              <section className="price-board">
                <div>
                  <b>Price model</b>
                  <span>
                    {selected.phase === "pool"
                      ? "Pool price and reserves"
                      : "Bonding curve price and reserves"}
                  </span>
                </div>
                <div className="price-points"><b>{formatTokenPrice(spotPrice(selected))} RLO / token</b></div>
              </section>
              <div className="curve-visual">
                <i
                  style={{
                    width: `${selected.phase === "pool" ? 100 : progress(selected)}%`,
                  }}
                />
              </div>
              <p className="model-note">
                {selected.phase === "pool"
                  ? "Constant-product pool · 0.30% LP fee"
                  : "Virtual-reserve curve · 1.00% platform fee"}
              </p>
              {selected.onchain && selected.phase === "graduation-ready" && <button className="button ghost" disabled={pending || !wallet} onClick={graduateMarket}>Graduate to DEX pool</button>}
              {selected.onchain && selected.phase === "pool" && <button className="button ghost" disabled={pending || !wallet} onClick={() => setLiquidityOpen(value => !value)}>{liquidityOpen ? "Close liquidity" : "Manage liquidity"}</button>}
              {liquidityOpen && <section className="liquidity-panel"><div><button className={liquiditySide === "add" ? "active" : ""} onClick={() => setLiquiditySide("add")}>Add</button><button className={liquiditySide === "remove" ? "active" : ""} onClick={() => setLiquiditySide("remove")}>Remove</button></div><input value={liquidityRlo} onChange={event => setLiquidityRlo(event.target.value)} placeholder="RLO amount"/><input value={liquidityToken} onChange={event => setLiquidityToken(event.target.value)} placeholder={liquiditySide === "add" ? "Token amount" : "LP amount"}/><button className="button primary" disabled={pending} onClick={applyLiquidity}>{pending ? "Waiting for wallet…" : `${liquiditySide === "add" ? "Add" : "Remove"} liquidity`}</button></section>}
              <section className="recent-trades trade-history">
                <div className="history-title">
                  <div><b>Market activity</b><span>Confirmed on Rialo testnet</span></div>
                  <small>{confirmedTrades.length} trades</small>
                </div>
                <TradeHistory trades={confirmedTrades} ticker={selected.ticker} />
              </section>
            </div>
            <div className="trade-panel">
              <div className="trade-tabs">
                <button
                  className={tradeSide === "buy" ? "active" : ""}
                  onClick={() => setTradeSide("buy")}
                >
                  Buy
                </button>
                <button
                  className={tradeSide === "sell" ? "active" : ""}
                  onClick={() => setTradeSide("sell")}
                >
                  Sell
                </button>
              </div>
              <label>
                {tradeSide === "buy"
                  ? "You pay (RLO)"
                  : `You sell (${selected.ticker})`}
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={tradeInput}
                  onChange={(event) => setTradeInput(event.target.value)}
                />
              </label>
              <div className="quick-actions">
                <button onClick={() => setTradeInput("1")}>1</button>
                <button onClick={() => setTradeInput("5")}>5</button>
                <button
                  onClick={() =>
                    setTradeInput(
                      tradeSide === "buy"
                        ? String(portfolio.rlo)
                        : String(portfolio.tokens[selected.id] ?? 0),
                    )
                  }
                >
                  Max
                </button>
              </div>
              <section className="quote">
                <div>
                  <span>You receive</span>
                  <b>
                    {tradeQuote?.error
                      ? "—"
                      : `${compact(tradeQuote?.output ?? 0)} ${tradeSide === "buy" ? selected.ticker : "RLO"}`}
                  </b>
                </div>
                <div>
                  <span>Fee</span>
                  <b>
                    {tradeQuote?.error ? "—" : formatRlo(tradeQuote?.fee ?? 0)}
                  </b>
                </div>
                <div>
                  <span>Price impact</span>
                  <b>
                    {tradeQuote?.error
                      ? "—"
                      : `${(tradeQuote?.priceImpact ?? 0).toFixed(2)}%`}
                  </b>
                </div>
              </section>
              {tradeQuote?.error && (
                <p className="trade-error">{tradeQuote.error}</p>
              )}
              <button
                className="button primary trade-submit"
                onClick={wallet ? applyTrade : connectWallet}
                disabled={pending}
              >
                {pending ? "Waiting for wallet…" : wallet ? `${selected.onchain ? "Confirm" : "Unavailable"} ${tradeSide}` : "Connect wallet to trade"}
              </button>
              <p className="trade-disclaimer">{selected.onchain ? "Rialo Testnet transaction · wallet approval required" : "On-chain market data is not available for this token."}</p>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
