-- Multi-service appointments: one booking can include several services.
CREATE TABLE IF NOT EXISTS booking_services (
  booking_id INTEGER NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  service_id INTEGER NOT NULL REFERENCES services(id),
  sort_order INTEGER NOT NULL DEFAULT 0,
  duration_min INTEGER NOT NULL,
  price_cents INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (booking_id, service_id)
);

CREATE INDEX IF NOT EXISTS idx_booking_services_service
  ON booking_services (service_id);

-- Backfill existing single-service bookings.
INSERT OR IGNORE INTO booking_services (booking_id, service_id, sort_order, duration_min, price_cents)
SELECT b.id, b.service_id, 0, s.duration_min, s.price_cents
FROM bookings b
JOIN services s ON s.id = b.service_id;
