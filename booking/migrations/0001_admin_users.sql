-- Invite-only Google auth for the admin dashboard.
CREATE TABLE IF NOT EXISTS admin_users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL DEFAULT 'admin',
  status TEXT NOT NULL DEFAULT 'invited', -- invited | active | disabled
  google_sub TEXT,
  invite_token TEXT,
  invited_at INTEGER,
  invited_by TEXT NOT NULL DEFAULT '',
  accepted_at INTEGER,
  last_login_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_admin_users_status ON admin_users (status);

-- Bootstrap the salon owner so the first Google sign-in works without a prior invite email.
INSERT OR IGNORE INTO admin_users (email, role, status, invited_at, invited_by)
VALUES ('anhthynguyen78@gmail.com', 'admin', 'invited', strftime('%s','now') * 1000, 'system');
