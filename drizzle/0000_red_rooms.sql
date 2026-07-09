CREATE TABLE IF NOT EXISTS red_rooms (
  code TEXT PRIMARY KEY,
  game_json TEXT NOT NULL,
  claims_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
