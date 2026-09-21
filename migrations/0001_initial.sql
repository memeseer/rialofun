CREATE TABLE IF NOT EXISTS markets (
  id TEXT PRIMARY KEY,
  state TEXT NOT NULL UNIQUE,
  mint TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  ticker TEXT NOT NULL,
  creator TEXT NOT NULL,
  image_url TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS trades (
  signature TEXT PRIMARY KEY,
  market_id TEXT NOT NULL,
  account TEXT NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('BUY','SELL')),
  rlo_amount REAL NOT NULL,
  token_amount REAL,
  price REAL NOT NULL,
  block_time INTEGER NOT NULL,
  verified INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_trades_market_time ON trades(market_id, block_time DESC);
CREATE INDEX IF NOT EXISTS idx_trades_account_time ON trades(account, block_time DESC);

CREATE TABLE IF NOT EXISTS indexer_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS storage_usage (
  key TEXT PRIMARY KEY,
  used_bytes INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);

INSERT OR IGNORE INTO storage_usage (key, used_bytes, updated_at)
VALUES ('token_images', 0, 0);

CREATE TABLE IF NOT EXISTS images (
  key TEXT PRIMARY KEY,
  content_type TEXT NOT NULL,
  body BLOB NOT NULL,
  size_bytes INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
