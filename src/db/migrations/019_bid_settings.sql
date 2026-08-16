-- Bid settings (extends app_settings single row)
SET @db := DATABASE();

SET @sql := (
  SELECT IF(
    (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'app_settings'
       AND COLUMN_NAME = 'bid_status') = 0,
    "ALTER TABLE app_settings
       ADD COLUMN bid_status TINYINT(1) NOT NULL DEFAULT 1 AFTER withdraw_terms,
       ADD COLUMN min_bid DECIMAL(14,2) NOT NULL DEFAULT 5.00 AFTER bid_status,
       ADD COLUMN max_bid DECIMAL(14,2) NOT NULL DEFAULT 100000.00 AFTER min_bid",
    'SELECT 1'
  )
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
