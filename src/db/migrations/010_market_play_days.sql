-- Admin markets: play days (Mon..Sun CSV). NULL / empty = all days.
SET @db := DATABASE();

SET @sql := (
  SELECT IF(
    (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'markets' AND COLUMN_NAME = 'play_days') = 0,
    "ALTER TABLE markets ADD COLUMN play_days VARCHAR(120) NULL DEFAULT NULL AFTER sort_order",
    'SELECT 1'
  )
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
