CREATE TABLE IF NOT EXISTS indexed_transactions (
  signature TEXT PRIMARY KEY,
  block_height INTEGER NOT NULL,
  indexed_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS market_snapshots (
  state TEXT PRIMARY KEY,
  token_reserve REAL NOT NULL,
  actual_rlo REAL NOT NULL,
  virtual_rlo REAL NOT NULL,
  phase TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_markets_mint ON markets(mint);
CREATE INDEX IF NOT EXISTS idx_trades_verified ON trades(market_id, verified, block_time DESC);
