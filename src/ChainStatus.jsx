import { useEffect, useState } from 'react';
import { PROBE, formatUnits, readProbe } from './chainProbe.js';
import './chain-status.css';

export function ChainStatus() {
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState({ loading: true });
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    let active = true;
    setStatus({ loading: true });
    readProbe({ signal: controller.signal }).then(
      data => { if (active) setStatus({ data }); },
      error => { if (active) setStatus({ error: error.name === 'AbortError' ? 'RPC request timed out.' : error.message }); },
    ).finally(() => clearTimeout(timer));
    return () => { active = false; clearTimeout(timer); controller.abort(); };
  }, [attempt]);
  return <details className="chain-status">
    <summary>Rialo testnet settlement · {status.loading ? 'Checking…' : status.error ? 'Unavailable' : 'Live'}</summary>
    <p>RialoFun lists on-chain Rialo Testnet markets only. Trades settle native RLO and Token-2022 balances after wallet approval.</p>
    <p>Program <code>{PROBE.program}</code></p>
    <p>State account <code>{PROBE.state}</code></p>
    <div aria-live="polite">
      {status.error && <p role="alert">{status.error} No live data available.</p>}
      {status.data && <p>Virtual reserve: {formatUnits(status.data.virtualRlo, 9)} RLO · Funded reserve: {formatUnits(status.data.actualRlo, 9)} RLO · Token reserve: {formatUnits(status.data.tokenReserve, 6)}</p>}
    </div>
    <button className="button ghost compact" disabled={status.loading} onClick={() => setAttempt(n => n + 1)}>Refresh testnet state</button>
  </details>;
}
