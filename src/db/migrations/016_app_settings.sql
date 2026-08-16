-- Admin profile + app settings (single row)
CREATE TABLE IF NOT EXISTS app_settings (
  id TINYINT UNSIGNED NOT NULL PRIMARY KEY DEFAULT 1,
  call_number VARCHAR(20) NULL,
  whatsapp_number VARCHAR(24) NULL,
  telegram_link VARCHAR(255) NULL,
  website VARCHAR(255) NULL,
  welcome_bonus DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  game_status TINYINT(1) NOT NULL DEFAULT 1,
  auto_approve TINYINT(1) NOT NULL DEFAULT 1,
  auto_result TINYINT(1) NOT NULL DEFAULT 1,
  disawar_auto_result TINYINT(1) NOT NULL DEFAULT 1,
  starline_auto_result TINYINT(1) NOT NULL DEFAULT 1,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT IGNORE INTO app_settings (id) VALUES (1);
