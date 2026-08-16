-- IMB realtime check_link for deposit status polling
SET @db := DATABASE();

SET @sql := (
  SELECT IF(
    (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'payment_orders' AND COLUMN_NAME = 'check_link') = 0,
    'ALTER TABLE payment_orders ADD COLUMN check_link TEXT NULL AFTER paytm_link',
    'SELECT 1'
  )
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
