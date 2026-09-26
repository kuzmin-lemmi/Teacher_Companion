CREATE TABLE IF NOT EXISTS drafts (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  payload TEXT NOT NULL CHECK (json_valid(payload)),
  saved_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reason TEXT NOT NULL,
  app_version TEXT NOT NULL,
  payload TEXT NOT NULL CHECK (json_valid(payload)),
  created_at TEXT NOT NULL
);
