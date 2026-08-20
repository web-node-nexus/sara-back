CREATE TABLE IF NOT EXISTS game_rates (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  market_kind ENUM('main', 'starline', 'jackpot') NOT NULL,
  game_id VARCHAR(64) NOT NULL,
  game_name VARCHAR(120) NOT NULL,
  heading VARCHAR(80) NOT NULL DEFAULT 'Popular Games',
  amount DECIMAL(14,2) NOT NULL DEFAULT 10.00,
  rate DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  sort_order INT NOT NULL DEFAULT 0,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_game_rates_kind_game (market_kind, game_id),
  KEY idx_game_rates_kind (market_kind, sort_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO game_rates
  (market_kind, game_id, game_name, heading, amount, rate, sort_order)
VALUES
  ('main', 'single-digit', 'Single Digit', 'Popular Games', 10.00, 96.00, 1),
  ('main', 'jodi', 'Jodi Digit', 'Popular Games', 10.00, 960.00, 2),
  ('main', 'single-pana', 'Single Pana', 'Popular Games', 10.00, 1500.00, 3),
  ('main', 'double-pana', 'Double Pana', 'Popular Games', 10.00, 3000.00, 4),
  ('main', 'triple-pana', 'Triple Pana', 'Popular Games', 10.00, 7000.00, 5),
  ('main', 'half-sangam', 'Half Sangam', 'Popular Games', 10.00, 10000.00, 6),
  ('main', 'full-sangam', 'Full Sangam', 'Popular Games', 10.00, 100000.00, 7),
  ('starline', 'single-digit', 'Single Digit', 'Popular Games', 10.00, 100.00, 1),
  ('starline', 'single-pana', 'Single Pana', 'Popular Games', 10.00, 1600.00, 2),
  ('starline', 'double-pana', 'Double Pana', 'Popular Games', 10.00, 3200.00, 3),
  ('starline', 'triple-pana', 'Triple Pana', 'Popular Games', 10.00, 10000.00, 4),
  ('jackpot', 'jodi', 'Jodi Digit', 'Popular Games', 10.00, 1000.00, 1)
ON DUPLICATE KEY UPDATE
  game_name = VALUES(game_name),
  sort_order = VALUES(sort_order);
