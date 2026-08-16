-- Withdrawal settings (extends app_settings single row)
SET @db := DATABASE();

SET @sql := (
  SELECT IF(
    (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'app_settings'
       AND COLUMN_NAME = 'withdraw_status') = 0,
    "ALTER TABLE app_settings
       ADD COLUMN withdraw_status TINYINT(1) NOT NULL DEFAULT 1 AFTER offline_tips,
       ADD COLUMN withdraw_allowed_per_day INT UNSIGNED NOT NULL DEFAULT 1 AFTER withdraw_status,
       ADD COLUMN withdraw_min_amount DECIMAL(14,2) NOT NULL DEFAULT 1000.00 AFTER withdraw_allowed_per_day,
       ADD COLUMN withdraw_max_amount DECIMAL(14,2) NOT NULL DEFAULT 100000.00 AFTER withdraw_min_amount,
       ADD COLUMN withdraw_open_time TIME NOT NULL DEFAULT '10:00:00' AFTER withdraw_max_amount,
       ADD COLUMN withdraw_close_time TIME NOT NULL DEFAULT '18:00:00' AFTER withdraw_open_time,
       ADD COLUMN withdraw_instruction TEXT NULL AFTER withdraw_close_time,
       ADD COLUMN withdraw_close_text VARCHAR(255) NULL AFTER withdraw_instruction,
       ADD COLUMN withdraw_upi_status TINYINT(1) NOT NULL DEFAULT 1 AFTER withdraw_close_text,
       ADD COLUMN withdraw_payment_methods JSON NULL AFTER withdraw_upi_status,
       ADD COLUMN withdraw_terms TEXT NULL AFTER withdraw_payment_methods",
    'SELECT 1'
  )
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

UPDATE app_settings SET
  withdraw_instruction = COALESCE(
    NULLIF(withdraw_instruction, ''),
    'आपका पैसा हमारे पास सुरक्षित है और आपको जल्द ही मिल जाएगा। विड्रॉ की प्रक्रिया पूरी होने में 10-45 मिनट लग सकते हैं।'
  ),
  withdraw_close_text = COALESCE(
    NULLIF(withdraw_close_text, ''),
    'Cannot withdraw at this time'
  ),
  withdraw_payment_methods = COALESCE(
    withdraw_payment_methods,
    JSON_OBJECT('bank', true, 'upi', true, 'gpay', true, 'phonepe', true, 'paytm', true)
  ),
  withdraw_terms = COALESCE(
    NULLIF(withdraw_terms, ''),
    CONCAT(
      '☆ Minimum Withdraw Is 1000/- Rs. Maximum Withdraw Is 25 lakh. Per Day.\n',
      '☆ Can Withdraw Money 1 Time.\n',
      '♤ 10 Am To 6 Pm withdrawal available\n',
      '☆ Withdraw Process Time Minimum 10Minute Maximum 45 Minute.\n',
      '☆ Withdraw Is Available On 6 Days Of Week.\n',
      '☆ Please Confirm That Bank Details You Have Entered Are Correct, If You Entered Wrong Bank Details Is Not Our Responsibility, After Submitting The Withdraw Request, If There Is No Valid Balance In Your Wallet, Then The Request Will Be Automatically Declined.'
    )
  )
WHERE id = 1;
