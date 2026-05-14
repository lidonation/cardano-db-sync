CREATE TABLE IF NOT EXISTS responses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  submitted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  role TEXT,
  use_cases TEXT,
  team_size TEXT,
  frequency INTEGER,
  pain_ranking TEXT,
  satisfaction INTEGER,
  improvement_wish TEXT,
  user_agent TEXT,
  ip_hash TEXT
);

CREATE INDEX IF NOT EXISTS idx_role ON responses(role);
CREATE INDEX IF NOT EXISTS idx_submitted ON responses(submitted_at);
