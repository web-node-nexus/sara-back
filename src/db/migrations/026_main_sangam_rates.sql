INSERT INTO game_rates
  (market_kind, game_id, game_name, heading, amount, rate, sort_order)
VALUES
  ('main', 'triple-pana', 'Triple Pana', 'Popular Games', 10.00, 7000.00, 5),
  ('main', 'half-sangam', 'Half Sangam', 'Popular Games', 10.00, 10000.00, 6),
  ('main', 'full-sangam', 'Full Sangam', 'Popular Games', 10.00, 100000.00, 7)
ON DUPLICATE KEY UPDATE
  game_name = VALUES(game_name),
  sort_order = VALUES(sort_order);
