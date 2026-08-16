-- Deposit Call Center — agent re-deposit outreach tracking
CREATE TABLE IF NOT EXISTS deposit_call_status (
  user_id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
  status VARCHAR(32) NOT NULL DEFAULT 'not_called',
  remark VARCHAR(500) NULL,
  call_count INT UNSIGNED NOT NULL DEFAULT 0,
  last_called_at DATETIME NULL,
  last_called_by BIGINT UNSIGNED NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_dcs_status (status),
  KEY idx_dcs_updated (updated_at DESC),
  CONSTRAINT fk_dcs_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS deposit_call_history (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  status VARCHAR(32) NOT NULL,
  remark VARCHAR(500) NULL,
  agent_id BIGINT UNSIGNED NULL,
  agent_name VARCHAR(120) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_dch_user_created (user_id, created_at DESC),
  CONSTRAINT fk_dch_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
