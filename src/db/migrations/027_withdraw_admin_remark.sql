-- Admin remark on a withdrawal request (idempotent)

SET @db := DATABASE();
SET @sql := (
  SELECT IF(
    (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'withdraw_requests' AND COLUMN_NAME = 'admin_remark') = 0,
    'ALTER TABLE withdraw_requests ADD COLUMN admin_remark VARCHAR(255) NULL AFTER note',
    'SELECT 1'
  )
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
