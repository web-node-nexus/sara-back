-- Admin notices: flash popup, marquee, notice board
CREATE TABLE IF NOT EXISTS notice_settings (
  id TINYINT UNSIGNED NOT NULL PRIMARY KEY DEFAULT 1,
  flash_title VARCHAR(255) NOT NULL DEFAULT '',
  flash_message TEXT NOT NULL,
  flash_enabled TINYINT(1) NOT NULL DEFAULT 0,
  marquee_title VARCHAR(255) NOT NULL DEFAULT '',
  marquee_description TEXT NOT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT IGNORE INTO notice_settings (id) VALUES (1);

UPDATE notice_settings SET
  flash_title = 'Play Big,Win Big👍',
  flash_message = 'Enjoy super fast withdrawal up 25 lakh with in 10 minutes only',
  flash_enabled = 1,
  marquee_title = 'Welcome To World Best Online',
  marquee_description = 'thanks'
WHERE id = 1;

CREATE TABLE IF NOT EXISTS notice_board (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  content TEXT NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_notice_board_sort (sort_order, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO notice_board (id, title, content, sort_order) VALUES
  (
    1,
    'Withdraw information',
    '😊 TARA 555 Matka is not responsible for any errors resulting from users entering incorrect bank details.\n\n👍 Before Requesting Withdraw Re-check Your Bank Details.\n\n👍 After Withdraw Request If There Is No Valid Wallet Balance The Request Will Be Auto Declined.',
    1
  ),
  (
    2,
    'Unfair - Bets',
    'If Admin Found Any Unfair-bets, Blocking Of Digits, Canning Or Match Fix Bets. Admin Has All Rights To Take Necessary Actions To Block The User.',
    2
  )
ON DUPLICATE KEY UPDATE
  title = VALUES(title),
  content = VALUES(content),
  sort_order = VALUES(sort_order);
