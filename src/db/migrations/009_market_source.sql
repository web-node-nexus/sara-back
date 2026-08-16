-- Markets source: scrape | admin | seed (admin create later)
SET @db := DATABASE();

SET @sql := (
  SELECT IF(
    (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'markets' AND COLUMN_NAME = 'source') = 0,
    "ALTER TABLE markets ADD COLUMN source ENUM('scrape','admin','seed') NOT NULL DEFAULT 'seed' AFTER is_active",
    'SELECT 1'
  )
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
