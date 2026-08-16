-- Admin notification toggles + history + per-user inbox
CREATE TABLE IF NOT EXISTS notification_settings (
  id TINYINT UNSIGNED NOT NULL PRIMARY KEY DEFAULT 1,
  notify_result TINYINT(1) NOT NULL DEFAULT 1,
  notify_call TINYINT(1) NOT NULL DEFAULT 1,
  notify_message TINYINT(1) NOT NULL DEFAULT 1,
  notify_bid TINYINT(1) NOT NULL DEFAULT 1,
  notify_withdraw TINYINT(1) NOT NULL DEFAULT 1,
  notify_deposit TINYINT(1) NOT NULL DEFAULT 1,
  notify_win TINYINT(1) NOT NULL DEFAULT 1,
  notify_starline TINYINT(1) NOT NULL DEFAULT 1,
  notify_jackpot TINYINT(1) NOT NULL DEFAULT 1,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT IGNORE INTO notification_settings (id) VALUES (1);

CREATE TABLE IF NOT EXISTS notification_history (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  message TEXT NOT NULL,
  target_type ENUM('user', 'all') NOT NULL DEFAULT 'all',
  target_user_id BIGINT UNSIGNED NULL,
  target_label VARCHAR(120) NOT NULL DEFAULT 'All Users',
  recipient_count INT UNSIGNED NOT NULL DEFAULT 0,
  sent_count INT UNSIGNED NOT NULL DEFAULT 0,
  kind VARCHAR(32) NOT NULL DEFAULT 'admin',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_notification_history_created (created_at DESC),
  KEY idx_notification_history_target (target_user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS user_notifications (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  history_id BIGINT UNSIGNED NULL,
  title VARCHAR(255) NOT NULL,
  message TEXT NOT NULL,
  kind VARCHAR(32) NOT NULL DEFAULT 'admin',
  is_read TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_user_notifications_user (user_id, is_read, id DESC),
  CONSTRAINT fk_user_notifications_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
