-- Saved bank/UPI for players (admin can manage)
CREATE TABLE IF NOT EXISTS user_payment_methods (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  type ENUM('bank','upi') NOT NULL,
  label VARCHAR(120) NULL,
  bank_name VARCHAR(120) NULL,
  account_name VARCHAR(120) NULL,
  account_number VARCHAR(40) NULL,
  ifsc VARCHAR(20) NULL,
  upi_id VARCHAR(120) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_upm_user (user_id),
  CONSTRAINT fk_upm_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

SET @db := DATABASE();
SET @sql := (
  SELECT IF(
    (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'users' AND COLUMN_NAME = 'last_seen_at') = 0,
    'ALTER TABLE users ADD COLUMN last_seen_at DATETIME NULL AFTER created_at',
    'SELECT 1'
  )
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
