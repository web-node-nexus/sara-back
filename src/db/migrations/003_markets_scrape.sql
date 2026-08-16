-- Add scrape result fields to markets table (safe re-run)
SET @db := DATABASE();

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@db AND TABLE_NAME='markets' AND COLUMN_NAME='result');
SET @sql := IF(@c=0, 'ALTER TABLE markets ADD COLUMN result VARCHAR(120) NULL DEFAULT NULL', 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@db AND TABLE_NAME='markets' AND COLUMN_NAME='result_updated_at');
SET @sql := IF(@c=0, 'ALTER TABLE markets ADD COLUMN result_updated_at DATETIME NULL DEFAULT NULL', 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@db AND TABLE_NAME='markets' AND COLUMN_NAME='scrape_timing');
SET @sql := IF(@c=0, 'ALTER TABLE markets ADD COLUMN scrape_timing VARCHAR(255) NULL DEFAULT NULL', 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- Expand markets to full scraped market list
INSERT INTO markets (id, name, open_time, close_time, is_active, sort_order) VALUES
  ('milan-morning',       'Milan Morning',        '06:00:00', '07:30:00', 1,  1),
  ('kalyan-morning',      'Kalyan Morning',        '09:30:00', '11:30:00', 1,  2),
  ('sridevi',             'Sridevi',               '11:30:00', '12:30:00', 1,  3),
  ('madhur-morning',      'Madhur Morning',        '11:00:00', '12:00:00', 1,  4),
  ('time-bazar',          'Time Bazar',            '01:00:00', '02:00:00', 1,  5),
  ('madhur-day',          'Madhur Day',            '01:30:00', '02:30:00', 1,  6),
  ('milan-day',           'Milan Day',             '03:00:00', '05:00:00', 1,  7),
  ('rajdhani-day',        'Rajdhani Day',          '03:00:00', '05:00:00', 1,  8),
  ('supreme-day',         'Supreme Day',           '03:00:00', '05:00:00', 1,  9),
  ('kalyan',              'Kalyan',                '03:45:00', '05:45:00', 1, 10),
  ('sridevi-night',       'Sridevi Night',         '07:00:00', '08:00:00', 1, 11),
  ('madhur-night',        'Madhur Night',          '07:00:00', '08:30:00', 1, 12),
  ('supreme-night',       'Supreme Night',         '09:00:00', '11:00:00', 1, 13),
  ('milan-night',         'Milan Night',           '09:00:00', '11:00:00', 1, 14),
  ('kalyan-night',        'Kalyan Night',          '09:30:00', '11:30:00', 1, 15),
  ('rajdhani-night',      'Rajdhani Night',        '09:30:00', '11:30:00', 1, 16),
  ('main-bazar',          'Main Bazar',            '09:30:00', '00:05:00', 1, 17),
  ('lucknow-morning',     'Lucknow Morning',       '08:30:00', '10:00:00', 1, 18),
  ('ratan-day',           'Ratan Day',             '03:00:00', '05:00:00', 1, 19),
  ('worli-mumbai-night',  'Worli Mumbai Night',    '09:30:00', '11:30:00', 1, 20),
  ('time-night',          'Time Night',            '09:30:00', '11:00:00', 1, 21),
  ('kalyan-evening',      'Kalyan Evening',        '06:00:00', '08:00:00', 1, 22)
ON DUPLICATE KEY UPDATE
  name        = VALUES(name),
  sort_order  = VALUES(sort_order),
  is_active   = 1;
