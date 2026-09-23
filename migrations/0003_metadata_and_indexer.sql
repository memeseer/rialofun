ALTER TABLE markets ADD COLUMN description TEXT NOT NULL DEFAULT '';
ALTER TABLE markets ADD COLUMN website TEXT NOT NULL DEFAULT '';
ALTER TABLE markets ADD COLUMN twitter TEXT NOT NULL DEFAULT '';
ALTER TABLE markets ADD COLUMN launch_signature TEXT NOT NULL DEFAULT '';
ALTER TABLE indexed_transactions ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE indexed_transactions ADD COLUMN last_error TEXT NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS api_rate_limits (
  bucket TEXT NOT NULL,
  window_start INTEGER NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (bucket, window_start)
);

CREATE TABLE IF NOT EXISTS indexer_failures (
  signature TEXT PRIMARY KEY,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT NOT NULL DEFAULT '',
  updated_at INTEGER NOT NULL
);

-- Earlier worker builds stored RPC blockTime in seconds even though the UI and
-- candle bucketing use milliseconds.
UPDATE trades SET block_time=block_time*1000 WHERE block_time>0 AND block_time<1000000000000;
UPDATE markets SET created_at=created_at*1000 WHERE created_at>0 AND created_at<1000000000000;
UPDATE markets SET updated_at=updated_at*1000 WHERE updated_at>0 AND updated_at<1000000000000;
