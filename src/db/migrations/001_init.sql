-- SARA 567 MySQL schema — indexes oriented for <2s list queries
CREATE TABLE IF NOT EXISTS users (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  login_id VARCHAR(64) NOT NULL,
  phone VARCHAR(20) NULL,
  password_hash VARCHAR(255) NOT NULL,
  name VARCHAR(120) NOT NULL,
  role ENUM('player','provider','admin') NOT NULL DEFAULT 'player',
  status ENUM('active','blocked') NOT NULL DEFAULT 'active',
  provider_id BIGINT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_users_login (login_id),
  KEY idx_users_provider (provider_id),
  KEY idx_users_role_status (role, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  token_hash VARCHAR(128) NOT NULL,
  expires_at DATETIME NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_refresh_hash (token_hash),
  KEY idx_refresh_user (user_id),
  CONSTRAINT fk_refresh_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS wallets (
  user_id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
  balance DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  version INT UNSIGNED NOT NULL DEFAULT 0,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_wallet_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS wallet_ledger (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  type ENUM('deposit','withdraw','bid','win','adjust') NOT NULL,
  amount DECIMAL(14,2) NOT NULL,
  balance_after DECIMAL(14,2) NOT NULL,
  note VARCHAR(255) NULL,
  ref_type VARCHAR(40) NULL,
  ref_id VARCHAR(64) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_ledger_user_created (user_id, created_at DESC),
  KEY idx_ledger_ref (ref_type, ref_id),
  CONSTRAINT fk_ledger_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS payment_orders (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  amount DECIMAL(14,2) NOT NULL,
  status ENUM('pending','paid','failed','cancelled') NOT NULL DEFAULT 'pending',
  merchant_id VARCHAR(64) NOT NULL,
  imb_ref VARCHAR(128) NULL,
  pay_url TEXT NULL,
  qr_payload TEXT NULL,
  meta_json JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_imb_ref (imb_ref),
  KEY idx_pay_user_status (user_id, status, created_at DESC),
  CONSTRAINT fk_pay_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS markets (
  id VARCHAR(40) NOT NULL PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  open_time TIME NOT NULL,
  close_time TIME NOT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  sort_order INT NOT NULL DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS bids (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  market_id VARCHAR(40) NOT NULL,
  market_name VARCHAR(120) NOT NULL,
  game_id VARCHAR(64) NOT NULL,
  game_name VARCHAR(120) NOT NULL,
  number_value VARCHAR(32) NOT NULL,
  points DECIMAL(14,2) NOT NULL,
  session ENUM('open','close') NULL,
  status ENUM('pending','won','lost','cancelled') NOT NULL DEFAULT 'pending',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_bids_user_created (user_id, created_at DESC),
  KEY idx_bids_market_created (market_id, created_at DESC),
  CONSTRAINT fk_bids_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS chat_threads (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  provider_id BIGINT UNSIGNED NOT NULL,
  unread_for_provider INT UNSIGNED NOT NULL DEFAULT 0,
  last_message_preview VARCHAR(255) NULL,
  last_message_at DATETIME NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_threads_provider_updated (provider_id, updated_at DESC),
  KEY idx_threads_user (user_id),
  CONSTRAINT fk_thread_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_thread_provider FOREIGN KEY (provider_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS chat_messages (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  thread_id BIGINT UNSIGNED NOT NULL,
  sender_role ENUM('user','provider') NOT NULL,
  sender_id BIGINT UNSIGNED NOT NULL,
  text VARCHAR(2000) NOT NULL DEFAULT '',
  attachment_kind ENUM('image','file','audio') NULL,
  attachment_name VARCHAR(255) NULL,
  attachment_uri TEXT NULL,
  attachment_duration_ms INT UNSIGNED NULL,
  status ENUM('sent','delivered','read') NOT NULL DEFAULT 'sent',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_messages_thread_id (thread_id, id),
  CONSTRAINT fk_msg_thread FOREIGN KEY (thread_id) REFERENCES chat_threads(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS withdraw_requests (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  amount DECIMAL(14,2) NOT NULL,
  status ENUM('pending','approved','rejected','paid') NOT NULL DEFAULT 'pending',
  note VARCHAR(255) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_withdraw_status (status, created_at DESC),
  KEY idx_withdraw_user (user_id, created_at DESC),
  CONSTRAINT fk_withdraw_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT IGNORE INTO markets (id, name, open_time, close_time, sort_order) VALUES
('kalyan', 'Kalyan', '15:00:00', '21:00:00', 1),
('milan-day', 'Milan Day', '10:00:00', '16:00:00', 2),
('milan-night', 'Milan Night', '19:00:00', '23:00:00', 3),
('rajdhani-day', 'Rajdhani Day', '12:00:00', '17:00:00', 4),
('time-bazar', 'Time Bazar', '13:00:00', '18:00:00', 5);
