-- Deposit / payment settings (extends app_settings single row)
SET @db := DATABASE();

SET @sql := (
  SELECT IF(
    (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'app_settings'
       AND COLUMN_NAME = 'auto_deposit_status') = 0,
    "ALTER TABLE app_settings
       ADD COLUMN auto_deposit_status TINYINT(1) NOT NULL DEFAULT 1 AFTER starline_auto_result,
       ADD COLUMN auto_deposit_text TEXT NULL AFTER auto_deposit_status,
       ADD COLUMN min_deposit DECIMAL(14,2) NOT NULL DEFAULT 200.00 AFTER auto_deposit_text,
       ADD COLUMN max_deposit DECIMAL(14,2) NOT NULL DEFAULT 100000.00 AFTER min_deposit,
       ADD COLUMN merchant_code VARCHAR(64) NULL AFTER max_deposit,
       ADD COLUMN merchant_name VARCHAR(120) NULL AFTER merchant_code,
       ADD COLUMN offline_payment_status TINYINT(1) NOT NULL DEFAULT 0 AFTER merchant_name,
       ADD COLUMN offline_upi_id VARCHAR(120) NULL AFTER offline_payment_status,
       ADD COLUMN offline_instructions TEXT NULL AFTER offline_upi_id,
       ADD COLUMN offline_qr_url TEXT NULL AFTER offline_instructions,
       ADD COLUMN offline_tips TEXT NULL AFTER offline_qr_url",
    'SELECT 1'
  )
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

UPDATE app_settings SET
  auto_deposit_text = COALESCE(
    NULLIF(auto_deposit_text, ''),
    'आप दिए गए किसी भी UPI आईडी (Google Pay, Paytm, QR Code) आदि पर राशि ट्रांसफर करें'
  ),
  merchant_code = COALESCE(NULLIF(merchant_code, ''), 'TARA 567'),
  merchant_name = COALESCE(NULLIF(merchant_name, ''), 'TARA 567'),
  offline_upi_id = COALESCE(
    NULLIF(offline_upi_id, ''),
    '0793748A0243740.bqr@kotak'
  ),
  offline_instructions = COALESCE(
    NULLIF(offline_instructions, ''),
    'दिए गए UPI आईडी पर राशि ट्रांसफर करें और रसीद व्हाट्सएप पर भेजें या'
  ),
  offline_qr_url = COALESCE(
    NULLIF(offline_qr_url, ''),
    'https://api.sara567official.site'
  ),
  offline_tips = COALESCE(
    NULLIF(offline_tips, ''),
    'लेन-देन में समस्या से बचने के लिए सही UPI आईडी दर्ज करें।'
  )
WHERE id = 1;
