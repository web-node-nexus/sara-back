-- OTP + auth hardening
CREATE TABLE IF NOT EXISTS otp_codes (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  phone VARCHAR(20) NOT NULL,
  purpose ENUM('signup','forgot') NOT NULL,
  code_hash VARCHAR(128) NOT NULL,
  expires_at DATETIME NOT NULL,
  attempts TINYINT UNSIGNED NOT NULL DEFAULT 0,
  consumed TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_otp_phone_purpose (phone, purpose, consumed, expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS otp_tickets (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  phone VARCHAR(20) NOT NULL,
  purpose ENUM('signup','forgot') NOT NULL,
  ticket_hash VARCHAR(128) NOT NULL,
  expires_at DATETIME NOT NULL,
  consumed TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_ticket_hash (ticket_hash),
  KEY idx_ticket_phone (phone, purpose)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Media attachments for chat
CREATE TABLE IF NOT EXISTS media_files (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  kind ENUM('image','file','audio') NOT NULL,
  original_name VARCHAR(255) NOT NULL,
  mime VARCHAR(120) NULL,
  size_bytes INT UNSIGNED NULL,
  storage_path VARCHAR(500) NOT NULL,
  public_url VARCHAR(500) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_media_user (user_id, created_at DESC),
  CONSTRAINT fk_media_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE UNIQUE INDEX uq_users_phone ON users (phone);

-- Align markets with player app IDs
DELETE FROM markets;
INSERT INTO markets (id, name, open_time, close_time, is_active, sort_order) VALUES
('kalyan-morning', 'Kalyan Morning', '09:00:00', '20:00:00', 1, 1),
('milan-day', 'Milan Day', '10:30:00', '19:30:00', 1, 2),
('kalyan-evening', 'Kalyan Evening', '18:00:00', '21:30:00', 1, 3),
('rajdhani-night', 'Rajdhani Night', '20:15:00', '23:45:00', 1, 4),
('time-bazar', 'Time Bazar', '08:00:00', '10:00:00', 1, 5);
