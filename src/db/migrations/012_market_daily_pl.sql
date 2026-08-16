-- Daily scrape snapshot per market (IST calendar day)
-- First scrape of the day inserts; later scrapes update same row (no duplicates).
-- Result updates when a real result arrives.

CREATE TABLE IF NOT EXISTS market_daily (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  market_id VARCHAR(40) NOT NULL,
  market_name VARCHAR(120) NOT NULL,
  result_date DATE NOT NULL,
  open_time TIME NULL,
  close_time TIME NULL,
  scrape_timing VARCHAR(255) NULL,
  result VARCHAR(120) NULL,
  result_declared TINYINT(1) NOT NULL DEFAULT 0,
  first_seen_at DATETIME NOT NULL,
  last_seen_at DATETIME NOT NULL,
  result_updated_at DATETIME NULL,
  UNIQUE KEY uq_market_daily (market_id, result_date),
  KEY idx_market_daily_date (result_date),
  KEY idx_market_daily_name_date (market_name, result_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Store credited win amount on each bid for accurate P/L
SET @db := DATABASE();
SET @sql := (
  SELECT IF(
    (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'bids' AND COLUMN_NAME = 'win_amount') = 0,
    'ALTER TABLE bids ADD COLUMN win_amount DECIMAL(14,2) NOT NULL DEFAULT 0.00 AFTER points',
    'SELECT 1'
  )
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
