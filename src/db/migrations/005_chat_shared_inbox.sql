-- Shared support inbox: provider_id nullable until a provider claims the chat
ALTER TABLE chat_threads
  MODIFY COLUMN provider_id BIGINT UNSIGNED NULL;

-- Track who claimed / is handling the thread (same as provider_id when claimed)
SET @db := DATABASE();
SET @c := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'chat_threads' AND COLUMN_NAME = 'claimed_provider_id'
);
SET @sql := IF(
  @c = 0,
  'ALTER TABLE chat_threads ADD COLUMN claimed_provider_id BIGINT UNSIGNED NULL AFTER provider_id',
  'SELECT 1'
);
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- One open/support thread per player (user_id unique among support threads)
-- Soft unique via app logic; add helpful index
SET @i := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'chat_threads' AND INDEX_NAME = 'idx_threads_user'
);
SET @sql := IF(
  @i = 0,
  'CREATE INDEX idx_threads_user ON chat_threads (user_id, updated_at DESC)',
  'SELECT 1'
);
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
