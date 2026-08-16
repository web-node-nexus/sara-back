-- Firebase push notification device tokens
CREATE TABLE IF NOT EXISTS device_tokens (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  token VARCHAR(512) NOT NULL,
  platform ENUM('ios', 'android', 'web') NOT NULL DEFAULT 'android',
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_device_token (token),
  KEY idx_device_user (user_id, is_active),
  CONSTRAINT fk_device_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Unread count for player (provider already had unread_for_provider)
-- Safe for re-runs: ignore if column already exists
SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'chat_threads'
    AND COLUMN_NAME = 'unread_for_user'
);
SET @sql := IF(
  @col_exists = 0,
  'ALTER TABLE chat_threads ADD COLUMN unread_for_user INT UNSIGNED NOT NULL DEFAULT 0 AFTER unread_for_provider',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
