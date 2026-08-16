-- IMB withdraw payout fields + processing status (idempotent)

ALTER TABLE withdraw_requests
  MODIFY COLUMN status ENUM(
    'pending',
    'approved',
    'processing',
    'rejected',
    'paid'
  ) NOT NULL DEFAULT 'pending';

SET @db := DATABASE();

SET @sql := (
  SELECT IF(
    (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'withdraw_requests' AND COLUMN_NAME = 'upi_id') = 0,
    'ALTER TABLE withdraw_requests ADD COLUMN upi_id VARCHAR(120) NULL AFTER note',
    'SELECT 1'
  )
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := (
  SELECT IF(
    (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'withdraw_requests' AND COLUMN_NAME = 'account_name') = 0,
    'ALTER TABLE withdraw_requests ADD COLUMN account_name VARCHAR(120) NULL AFTER upi_id',
    'SELECT 1'
  )
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := (
  SELECT IF(
    (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'withdraw_requests' AND COLUMN_NAME = 'account_number') = 0,
    'ALTER TABLE withdraw_requests ADD COLUMN account_number VARCHAR(40) NULL AFTER account_name',
    'SELECT 1'
  )
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := (
  SELECT IF(
    (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'withdraw_requests' AND COLUMN_NAME = 'ifsc') = 0,
    'ALTER TABLE withdraw_requests ADD COLUMN ifsc VARCHAR(20) NULL AFTER account_number',
    'SELECT 1'
  )
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := (
  SELECT IF(
    (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'withdraw_requests' AND COLUMN_NAME = 'bank_name') = 0,
    'ALTER TABLE withdraw_requests ADD COLUMN bank_name VARCHAR(120) NULL AFTER ifsc',
    'SELECT 1'
  )
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := (
  SELECT IF(
    (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'withdraw_requests' AND COLUMN_NAME = 'client_ref_id') = 0,
    'ALTER TABLE withdraw_requests ADD COLUMN client_ref_id VARCHAR(64) NULL AFTER bank_name',
    'SELECT 1'
  )
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := (
  SELECT IF(
    (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'withdraw_requests' AND COLUMN_NAME = 'payout_txn_id') = 0,
    'ALTER TABLE withdraw_requests ADD COLUMN payout_txn_id VARCHAR(64) NULL AFTER client_ref_id',
    'SELECT 1'
  )
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := (
  SELECT IF(
    (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'withdraw_requests' AND COLUMN_NAME = 'payout_status') = 0,
    'ALTER TABLE withdraw_requests ADD COLUMN payout_status VARCHAR(40) NULL AFTER payout_txn_id',
    'SELECT 1'
  )
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := (
  SELECT IF(
    (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'payment_orders' AND COLUMN_NAME = 'phonepe_link') = 0,
    'ALTER TABLE payment_orders ADD COLUMN phonepe_link TEXT NULL AFTER qr_payload',
    'SELECT 1'
  )
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := (
  SELECT IF(
    (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'payment_orders' AND COLUMN_NAME = 'paytm_link') = 0,
    'ALTER TABLE payment_orders ADD COLUMN paytm_link TEXT NULL AFTER phonepe_link',
    'SELECT 1'
  )
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
