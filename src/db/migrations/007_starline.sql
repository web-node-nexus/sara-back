-- Starline slots — daily open-only markets; result auto +5 min after close
CREATE TABLE IF NOT EXISTS starline_slots (
  id VARCHAR(40) NOT NULL PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  time_label VARCHAR(32) NOT NULL,
  close_minutes SMALLINT UNSIGNED NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS starline_results (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  slot_id VARCHAR(40) NOT NULL,
  result_date DATE NOT NULL,
  open_digit TINYINT UNSIGNED NOT NULL,
  result_display VARCHAR(32) NOT NULL,
  declared_at DATETIME NOT NULL,
  UNIQUE KEY uq_starline_slot_date (slot_id, result_date),
  KEY idx_starline_results_date (result_date),
  CONSTRAINT fk_starline_result_slot FOREIGN KEY (slot_id) REFERENCES starline_slots(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO starline_slots (id, name, time_label, close_minutes, sort_order) VALUES
  ('starline-1000', '10:00 AM STARLINE', '10:00 AM', 600, 1),
  ('starline-1100', '11:00 AM STARLINE', '11:00 AM', 660, 2),
  ('starline-1130', '11:30 AM STARLINE', '11:30 AM', 690, 3),
  ('starline-1200', '12:00 PM STARLINE', '12:00 PM', 720, 4),
  ('starline-1300', '01:00 PM STARLINE', '01:00 PM', 780, 5),
  ('starline-1400', '02:00 PM STARLINE', '02:00 PM', 840, 6),
  ('starline-1500', '03:00 PM STARLINE', '03:00 PM', 900, 7),
  ('starline-1600', '04:00 PM STARLINE', '04:00 PM', 960, 8),
  ('starline-1700', '05:00 PM STARLINE', '05:00 PM', 1020, 9),
  ('starline-1800', '06:00 PM STARLINE', '06:00 PM', 1080, 10),
  ('starline-1900', '07:00 PM STARLINE', '07:00 PM', 1140, 11),
  ('starline-2000', '08:00 PM STARLINE', '08:00 PM', 1200, 12),
  ('starline-2100', '09:00 PM STARLINE', '09:00 PM', 1260, 13)
ON DUPLICATE KEY UPDATE
  name = VALUES(name),
  time_label = VALUES(time_label),
  close_minutes = VALUES(close_minutes),
  sort_order = VALUES(sort_order);
