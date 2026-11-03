-- Admin staff screen permissions + superadmin flag

SET @db := DATABASE();

SET @sql := IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'users' AND COLUMN_NAME = 'is_superadmin') = 0,
  'ALTER TABLE users ADD COLUMN is_superadmin TINYINT(1) NOT NULL DEFAULT 0 AFTER role',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

UPDATE users SET is_superadmin = 1 WHERE id = 1 AND role = 'admin';

CREATE TABLE IF NOT EXISTS admin_user_screens (
  user_id BIGINT UNSIGNED NOT NULL,
  screen_key VARCHAR(64) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, screen_key),
  CONSTRAINT fk_admin_screens_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
