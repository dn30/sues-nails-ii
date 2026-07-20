-- Sue's Nails booking system schema (Cloudflare D1 / SQLite)

CREATE TABLE IF NOT EXISTS services (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  duration_min INTEGER NOT NULL,
  price_cents INTEGER NOT NULL DEFAULT 0,
  buffer_before_min INTEGER NOT NULL DEFAULT 0,
  buffer_after_min INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS staff (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE
);

-- Per-weekday seat capacity overrides; days without a row use the global
-- 'capacity' setting.
CREATE TABLE IF NOT EXISTS day_capacity (
  dow INTEGER PRIMARY KEY CHECK (dow BETWEEN 0 AND 6),
  capacity INTEGER NOT NULL CHECK (capacity >= 1)
);

-- Weekly opening hours. Multiple windows per day are allowed.
-- dow: 0=Sunday .. 6=Saturday. Times are minutes since local midnight.
CREATE TABLE IF NOT EXISTS hours (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  dow INTEGER NOT NULL CHECK (dow BETWEEN 0 AND 6),
  open_min INTEGER NOT NULL,
  close_min INTEGER NOT NULL,
  CHECK (open_min < close_min)
);

-- Full-day closures (holidays etc), date in salon-local YYYY-MM-DD.
CREATE TABLE IF NOT EXISTS closures (
  date TEXT PRIMARY KEY,
  reason TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS bookings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  service_id INTEGER NOT NULL REFERENCES services(id),
  start_ts INTEGER NOT NULL,        -- service start, UTC epoch ms
  end_ts INTEGER NOT NULL,          -- service end, UTC epoch ms
  block_start_ts INTEGER NOT NULL,  -- start minus before-buffer
  block_end_ts INTEGER NOT NULL,    -- end plus after-buffer
  party_size INTEGER NOT NULL DEFAULT 1,
  customer_name TEXT NOT NULL,
  customer_phone TEXT NOT NULL,
  customer_email TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  assigned_to TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'confirmed', -- confirmed | cancelled
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_bookings_window
  ON bookings (status, block_start_ts, block_end_ts);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

INSERT OR IGNORE INTO settings (key, value) VALUES
  ('timezone', 'America/Los_Angeles'),
  ('capacity', '3'),
  ('slot_interval_min', '30'),
  ('min_notice_min', '60'),
  ('max_days_ahead', '30');

INSERT OR IGNORE INTO staff (name) VALUES ('Sue');

-- Default hours (Mon-Sat 9:00-20:00, Sun 9:00-18:00), seeded only when empty.
INSERT INTO hours (dow, open_min, close_min)
SELECT column1, column2, column3 FROM (VALUES
  (0, 540, 1080),
  (1, 540, 1200),
  (2, 540, 1200),
  (3, 540, 1200),
  (4, 540, 1200),
  (5, 540, 1200),
  (6, 540, 1200)
) WHERE NOT EXISTS (SELECT 1 FROM hours);

-- Starter services matching the website, seeded only when empty.
-- Prices are placeholders; set real ones in the admin.
INSERT INTO services (name, description, duration_min, price_cents, buffer_before_min, buffer_after_min, sort_order)
SELECT column1, column2, column3, column4, column5, column6, column7 FROM (VALUES
  ('Manicure', 'Hand care, shaping, and polish.', 30, 2000, 0, 10, 1),
  ('Gel Manicure', 'High-shine, chip-resistant gel polish.', 45, 3500, 0, 10, 2),
  ('Pink & White', 'Classic French tips.', 60, 4500, 0, 10, 3),
  ('Acrylic Full Set', 'Durable, sculpted nails.', 75, 5500, 0, 15, 4),
  ('Spa Pedicure', 'Foot soak, exfoliation, and massage.', 50, 4000, 0, 15, 5),
  ('3D Nail Art', 'Custom designs with dimension and detail.', 90, 6500, 0, 15, 6)
) WHERE NOT EXISTS (SELECT 1 FROM services);
