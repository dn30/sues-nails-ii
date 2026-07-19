const SETTING_DEFAULTS = {
  timezone: "America/Los_Angeles",
  capacity: 3,
  slot_interval_min: 30,
  min_notice_min: 60,
  max_days_ahead: 30,
  staff: "",
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

export async function getHours(db) {
  const { results } = await db.prepare("SELECT dow, open_min, close_min FROM hours ORDER BY dow, open_min").all();
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
