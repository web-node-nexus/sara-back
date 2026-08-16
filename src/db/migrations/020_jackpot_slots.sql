-- Jackpot slots — hourly :30 markets; ON/OFF via admin
CREATE TABLE IF NOT EXISTS jackpot_slots (
  id VARCHAR(40) NOT NULL PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  time_label VARCHAR(32) NOT NULL,
  close_minutes SMALLINT UNSIGNED NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO jackpot_slots (id, name, time_label, close_minutes, sort_order) VALUES
  ('jackpot-1030', '10:30 AM JACKPOT', '10:30 AM', 630, 1),
  ('jackpot-1130', '11:30 AM JACKPOT', '11:30 AM', 690, 2),
  ('jackpot-1230', '12:30 PM JACKPOT', '12:30 PM', 750, 3),
  ('jackpot-1330', '01:30 PM JACKPOT', '01:30 PM', 810, 4),
  ('jackpot-1430', '02:30 PM JACKPOT', '02:30 PM', 870, 5),
  ('jackpot-1530', '03:30 PM JACKPOT', '03:30 PM', 930, 6),
  ('jackpot-1630', '04:30 PM JACKPOT', '04:30 PM', 990, 7),
  ('jackpot-1730', '05:30 PM JACKPOT', '05:30 PM', 1050, 8),
  ('jackpot-1830', '06:30 PM JACKPOT', '06:30 PM', 1110, 9),
  ('jackpot-1930', '07:30 PM JACKPOT', '07:30 PM', 1170, 10)
ON DUPLICATE KEY UPDATE
  name = VALUES(name),
  time_label = VALUES(time_label),
  close_minutes = VALUES(close_minutes),
  sort_order = VALUES(sort_order);
