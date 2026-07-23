const SETTING_DEFAULTS = {
  timezone: "America/Los_Angeles",
  capacity: 3,
  slot_interval_min: 30,
  min_notice_min: 60,
  max_days_ahead: 30,
};

const NUMERIC_SETTINGS = ["capacity", "slot_interval_min", "min_notice_min", "max_days_ahead"];

export async function getSettings(db) {
  const { results } = await db.prepare("SELECT key, value FROM settings").all();
  const s = { ...SETTING_DEFAULTS };
  for (const row of results) s[row.key] = row.value;
  for (const k of NUMERIC_SETTINGS) s[k] = Math.max(1, parseInt(s[k], 10) || SETTING_DEFAULTS[k]);
  return s;
}

export async function putSettings(db, updates) {
  const allowed = Object.keys(SETTING_DEFAULTS);
  const stmts = [];
  for (const [k, v] of Object.entries(updates)) {
    if (!allowed.includes(k)) continue;
    stmts.push(
      db
        .prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
        .bind(k, String(v))
    );
  }
  if (stmts.length) await db.batch(stmts);
}

export async function getService(db, id, { activeOnly = false } = {}) {
  const sql = `SELECT * FROM services WHERE id = ?${activeOnly ? " AND active = 1" : ""}`;
  return db.prepare(sql).bind(id).first();
}

export async function listServices(db, { activeOnly = false } = {}) {
  const sql = `SELECT * FROM services${activeOnly ? " WHERE active = 1" : ""} ORDER BY sort_order, id`;
  const { results } = await db.prepare(sql).all();
  return results;
}

export async function getServicesByIds(db, ids, { activeOnly = false } = {}) {
  const unique = [...new Set(ids.map((n) => parseInt(n, 10)).filter((n) => n > 0))];
  if (!unique.length) return [];
  const placeholders = unique.map(() => "?").join(",");
  const sql = `SELECT * FROM services WHERE id IN (${placeholders})${activeOnly ? " AND active = 1" : ""}`;
  const { results } = await db.prepare(sql).bind(...unique).all();
  const byId = new Map(results.map((s) => [s.id, s]));
  // Preserve request order; drop missing ids.
  return unique.map((id) => byId.get(id)).filter(Boolean);
}

/** Collapse selected services into one appointment block for slot math. */
export function composeAppointment(services) {
  if (!services.length) return null;
  const duration_min = services.reduce((sum, s) => sum + s.duration_min, 0);
  const price_cents = services.reduce((sum, s) => sum + (s.price_cents || 0), 0);
  return {
    duration_min,
    price_cents,
    // Gap before first service / after last service.
    buffer_before_min: services[0].buffer_before_min || 0,
    buffer_after_min: services[services.length - 1].buffer_after_min || 0,
    names: services.map((s) => s.name),
    label: services.map((s) => s.name).join(" + "),
    primary_id: services[0].id,
    services,
  };
}

export async function servicesForBookings(db, bookingIds) {
  if (!bookingIds.length) return {};
  const placeholders = bookingIds.map(() => "?").join(",");
  const { results } = await db
    .prepare(
      `SELECT bs.booking_id, bs.service_id, bs.sort_order, bs.duration_min, bs.price_cents, s.name
       FROM booking_services bs
       JOIN services s ON s.id = bs.service_id
       WHERE bs.booking_id IN (${placeholders})
       ORDER BY bs.booking_id, bs.sort_order, bs.service_id`
    )
    .bind(...bookingIds)
    .all();
  const map = {};
  for (const row of results) {
    if (!map[row.booking_id]) map[row.booking_id] = [];
    map[row.booking_id].push(row);
  }
  return map;
}

export async function getHours(db) {
  const { results } = await db.prepare("SELECT dow, open_min, close_min FROM hours ORDER BY dow, open_min").all();
  return results;
}

// Map of dow -> seat capacity override (days without a row use settings.capacity).
export async function getDayCapacity(db) {
  const { results } = await db.prepare("SELECT dow, capacity FROM day_capacity").all();
  const map = {};
  for (const r of results) map[r.dow] = r.capacity;
  return map;
}

export async function listStaff(db) {
  const { results } = await db.prepare("SELECT id, name FROM staff ORDER BY name").all();
  return results;
}

export async function isClosed(db, dateStr) {
  const row = await db.prepare("SELECT date FROM closures WHERE date = ?").bind(dateStr).first();
  return !!row;
}

// Confirmed bookings whose block window intersects [fromTs, toTs).
export async function bookingsInWindow(db, fromTs, toTs) {
  const { results } = await db
    .prepare(
      "SELECT id, service_id, start_ts, end_ts, block_start_ts, block_end_ts, party_size FROM bookings WHERE status = 'confirmed' AND block_start_ts < ? AND block_end_ts > ?"
    )
    .bind(toTs, fromTs)
    .all();
  return results;
}

export function newBookingCode() {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let code = "SN-";
  const bytes = crypto.getRandomValues(new Uint8Array(5));
  for (const b of bytes) code += alphabet[b % alphabet.length];
  return code;
}
