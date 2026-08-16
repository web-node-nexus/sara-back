-- Pending call invites (API poll fallback when Firebase Auth/RTDB client fails)
CREATE TABLE IF NOT EXISTS call_invites (
  call_id VARCHAR(32) PRIMARY KEY,
  thread_id INT UNSIGNED NOT NULL,
  caller_id INT UNSIGNED NOT NULL,
  callee_id INT UNSIGNED NOT NULL,
  caller_name VARCHAR(120) NOT NULL DEFAULT 'Caller',
  status ENUM('ringing', 'accepted', 'rejected', 'ended') NOT NULL DEFAULT 'ringing',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_call_invites_callee_status (callee_id, status),
  INDEX idx_call_invites_created (created_at)
);
