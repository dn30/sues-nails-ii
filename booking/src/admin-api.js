import { json, badRequest, slotsForDate } from "./api.js";
import {
  getSettings,
  putSettings,
  getHours,
  getDayCapacity,
  listStaff,
  getService,
  bookingsInWindow,
  newBookingCode,
} from "./db.js";
import { parseYmd, wallToUtc, ymdInTz, fmtTimeInTz, maxConcurrentSeats } from "./slots.js";

// ---- bookings ----

export async function adminListBookings(env, url) {
  const settings = await getSettings(env.DB);
  const tz = settings.timezone;
  const fromStr = url.searchParams.get("from") || ymdInTz(tz, Date.now());
  const toStr = url.searchParams.get("to") || ymdInTz(tz, Date.now() + 14 * 86400000);
  const includeCancelled = url.searchParams.get("include_cancelled") === "1";
  const from = parseYmd(fromStr);
  const to = parseYmd(toStr);
  if (!from || !to) return badRequest("from/to must be YYYY-MM-DD");

  const fromTs = wallToUtc(tz, from.y, from.m, from.d, 0);
  const toTs = wallToUtc(tz, to.y, to.m, to.d, 24 * 60);

  const { results } = await env.DB.prepare(
    `SELECT b.*, s.name AS service_name FROM bookings b
     JOIN services s ON s.id = b.service_id
     WHERE b.start_ts >= ? AND b.start_ts < ?
       ${includeCancelled ? "" : "AND b.status = 'confirmed'"}
     ORDER BY b.start_ts`
  )
    .bind(fromTs, toTs)
    .all();

  return json({
    bookings: results.map((b) => ({
      id: b.id,
      code: b.code,
      service: b.service_name,
      date: ymdInTz(tz, b.start_ts),
      time: fmtTimeInTz(tz, b.start_ts),
      start_ts: b.start_ts,
      party_size: b.party_size,
      customer_name: b.customer_name,
      customer_phone: b.customer_phone,
      customer_email: b.customer_email,
      notes: b.notes,
      assigned_to: b.assigned_to,
      status: b.status,
    })),
  });
}

// Slots for the admin booking form: no minimum notice, no max-days-ahead
// window, and inactive services are still bookable by staff.
export async function adminAvailability(env, url) {
  const serviceId = parseInt(url.searchParams.get("service_id"), 10);
  const dateStr = url.searchParams.get("date");
  if (!serviceId) return badRequest("service_id is required");
  if (!dateStr) return badRequest("date is required");

  const service = await getService(env.DB, serviceId);
  if (!service) return json({ error: "Service not found" }, 404);

  const settings = await getSettings(env.DB);
  const result = await slotsForDate(env.DB, service, dateStr, settings, Date.now(), { admin: true });
  if (result.error) return badRequest(result.error);
  return json({ service_id: serviceId, date: dateStr, ...result });
}

export async function adminCreateBooking(env, request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return badRequest("Invalid JSON body");
  }

  const serviceId = parseInt(body.service_id, 10);
  const partySize = Math.max(1, parseInt(body.party_size, 10) || 1);
  const name = String(body.name || "").trim();
  const phone = String(body.phone || "").trim();
  const email = String(body.email || "").trim();
  const notes = String(body.notes || "").trim().slice(0, 500);
  const assignedTo = String(body.assigned_to || "").trim();
  // force=true books the time even when it is full or outside open hours
  // (walk-ins, squeezing in a regular, etc). Capacity checks are skipped.
  const force = body.force === true || body.force === 1;

  if (!serviceId) return badRequest("service_id is required");
  if (!name) return badRequest("name is required");

  const service = await getService(env.DB, serviceId);
  if (!service) return json({ error: "Service not found" }, 404);

  const settings = await getSettings(env.DB);
  const now = Date.now();
  const tz = settings.timezone;

  // Start time: either start_ts (epoch ms, from a picked slot) or a salon-local
  // date (YYYY-MM-DD) + time (HH:MM) for custom/forced times.
  let startTs = Number(body.start_ts);
  if (!Number.isFinite(startTs) || startTs <= 0) {
    const date = parseYmd(body.date);
    const tm = /^(\d{1,2}):(\d{2})$/.exec(body.time || "");
    if (!date || !tm) return badRequest("Provide start_ts, or date (YYYY-MM-DD) and time (HH:MM)");
    startTs = wallToUtc(tz, date.y, date.m, date.d, parseInt(tm[1], 10) * 60 + parseInt(tm[2], 10));
  }
  const dateStr = ymdInTz(tz, startTs);

  let capacity = settings.capacity;
  if (!force) {
    const result = await slotsForDate(env.DB, service, dateStr, settings, now, { admin: true });
    if (result.error) return badRequest(result.error);
    capacity = result.capacity;
    if (partySize > capacity) return badRequest(`Party size cannot exceed ${capacity}`);
    const slot = (result.slots || []).find((s) => s.start_ts === startTs);
    if (!slot) {
      return json({ error: "That time is not available. Check 'book anyway' to override." }, 409);
    }
    if (slot.remaining < partySize) {
      return json(
        { error: `Only ${slot.remaining} seat(s) left at that time. Check 'book anyway' to override.` },
        409
      );
    }
  }

  const endTs = startTs + service.duration_min * 60000;
  const blockStart = startTs - service.buffer_before_min * 60000;
  const blockEnd = endTs + service.buffer_after_min * 60000;
  const code = newBookingCode();

  const inserted = await env.DB.prepare(
    `INSERT INTO bookings
       (code, service_id, start_ts, end_ts, block_start_ts, block_end_ts,
        party_size, customer_name, customer_phone, customer_email, notes, assigned_to, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`
  )
    .bind(code, serviceId, startTs, endTs, blockStart, blockEnd, partySize, name, phone, email, notes, assignedTo, now)
    .first();

  if (!force) {
    // Same race guard as the public endpoint: verify capacity after insert.
    const overlapping = await bookingsInWindow(env.DB, blockStart, blockEnd);
    const peak = maxConcurrentSeats(overlapping, blockStart, blockEnd);
    if (peak > capacity) {
      await env.DB.prepare("DELETE FROM bookings WHERE id = ?").bind(inserted.id).run();
      return json({ error: "That time was just booked by someone else. Please pick another." }, 409);
    }
  }

  return json(
    {
      booking: {
        id: inserted.id,
        code,
        service: service.name,
        date: dateStr,
        time: fmtTimeInTz(tz, startTs),
        party_size: partySize,
        assigned_to: assignedTo,
      },
    },
    201
  );
}

export async function adminPatchBooking(env, id, request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return badRequest("Invalid JSON body");
  }
  const existing = await env.DB.prepare("SELECT id FROM bookings WHERE id = ?").bind(id).first();
  if (!existing) return json({ error: "Booking not found" }, 404);

  const sets = [];
  const binds = [];
  if (typeof body.assigned_to === "string") {
    sets.push("assigned_to = ?");
    binds.push(body.assigned_to.trim());
  }
  if (body.status === "cancelled" || body.status === "confirmed") {
    sets.push("status = ?");
    binds.push(body.status);
  }
  if (typeof body.notes === "string") {
    sets.push("notes = ?");
    binds.push(body.notes.trim().slice(0, 500));
  }
  if (!sets.length) return badRequest("Nothing to update");
  binds.push(id);
  await env.DB.prepare(`UPDATE bookings SET ${sets.join(", ")} WHERE id = ?`).bind(...binds).run();
  return json({ ok: true });
}

// ---- services ----

export async function adminListServices(env) {
  const { results } = await env.DB.prepare("SELECT * FROM services ORDER BY sort_order, id").all();
  return json({ services: results });
}

function serviceFromBody(body) {
  const name = String(body.name || "").trim();
  const duration = parseInt(body.duration_min, 10);
  if (!name) return { error: "name is required" };
  if (!duration || duration < 5 || duration > 480) return { error: "duration_min must be 5-480" };
  // Price arrives in dollars (e.g. "35" or "35.50"); stored as cents.
  const priceDollars = parseFloat(body.price);
  const priceCents = Number.isFinite(priceDollars) ? Math.round(priceDollars * 100) : 0;
  if (priceCents < 0 || priceCents > 100000000) return { error: "price must be 0 or more" };
  return {
    name,
    description: String(body.description || "").trim(),
    duration_min: duration,
    price_cents: priceCents,
    buffer_before_min: Math.max(0, parseInt(body.buffer_before_min, 10) || 0),
    buffer_after_min: Math.max(0, parseInt(body.buffer_after_min, 10) || 0),
    active: body.active === 0 || body.active === false ? 0 : 1,
    sort_order: parseInt(body.sort_order, 10) || 0,
  };
}

export async function adminCreateService(env, request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return badRequest("Invalid JSON body");
  }
  const s = serviceFromBody(body);
  if (s.error) return badRequest(s.error);
  const row = await env.DB.prepare(
    `INSERT INTO services (name, description, duration_min, price_cents, buffer_before_min, buffer_after_min, active, sort_order)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`
  )
    .bind(s.name, s.description, s.duration_min, s.price_cents, s.buffer_before_min, s.buffer_after_min, s.active, s.sort_order)
    .first();
  return json({ service: row }, 201);
}

export async function adminUpdateService(env, id, request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return badRequest("Invalid JSON body");
  }
  const existing = await env.DB.prepare("SELECT id FROM services WHERE id = ?").bind(id).first();
  if (!existing) return json({ error: "Service not found" }, 404);
  const s = serviceFromBody(body);
  if (s.error) return badRequest(s.error);
  await env.DB.prepare(
    `UPDATE services SET name=?, description=?, duration_min=?, price_cents=?, buffer_before_min=?, buffer_after_min=?, active=?, sort_order=? WHERE id=?`
  )
    .bind(s.name, s.description, s.duration_min, s.price_cents, s.buffer_before_min, s.buffer_after_min, s.active, s.sort_order, id)
    .run();
  return json({ ok: true });
}

export async function adminDeleteService(env, id) {
  const used = await env.DB.prepare("SELECT COUNT(*) AS n FROM bookings WHERE service_id = ?").bind(id).first();
  if (used.n > 0) {
    // Keep history intact; deactivate instead.
    await env.DB.prepare("UPDATE services SET active = 0 WHERE id = ?").bind(id).run();
    return json({ ok: true, deactivated: true });
  }
  await env.DB.prepare("DELETE FROM services WHERE id = ?").bind(id).run();
  return json({ ok: true, deleted: true });
}

// ---- staff ----

export async function adminListStaff(env) {
  return json({ staff: await listStaff(env.DB) });
}

export async function adminCreateStaff(env, request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return badRequest("Invalid JSON body");
  }
  const name = String(body.name || "").trim();
  if (!name) return badRequest("name is required");
  await env.DB.prepare("INSERT OR IGNORE INTO staff (name) VALUES (?)").bind(name).run();
  return json({ staff: await listStaff(env.DB) }, 201);
}

export async function adminDeleteStaff(env, id) {
  // Past bookings keep the name as plain text, so deleting staff is safe.
  await env.DB.prepare("DELETE FROM staff WHERE id = ?").bind(id).run();
  return json({ ok: true });
}

// ---- hours / day capacity / closures / settings ----

export async function adminGetHours(env) {
  const [hours, dayCapacity] = await Promise.all([getHours(env.DB), getDayCapacity(env.DB)]);
  return json({ hours, day_capacity: dayCapacity });
}

export async function adminPutHours(env, request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return badRequest("Invalid JSON body");
  }
  const rows = Array.isArray(body.hours) ? body.hours : null;
  if (!rows) return badRequest("hours must be an array");
  for (const r of rows) {
    const dow = parseInt(r.dow, 10);
    const open = parseInt(r.open_min, 10);
    const close = parseInt(r.close_min, 10);
    if (!(dow >= 0 && dow <= 6) || !(open >= 0) || !(close <= 1440) || !(open < close)) {
      return badRequest("Each row needs dow 0-6 and 0 <= open_min < close_min <= 1440");
    }
  }
  // Optional day_capacity map: {"0": 2, "6": 4}; missing/empty values clear the override.
  const capEntries = [];
  if (body.day_capacity && typeof body.day_capacity === "object") {
    for (const [k, v] of Object.entries(body.day_capacity)) {
      const dow = parseInt(k, 10);
      if (!(dow >= 0 && dow <= 6)) return badRequest("day_capacity keys must be dow 0-6");
      if (v === null || v === "" || v === undefined) continue;
      const cap = parseInt(v, 10);
      if (!cap || cap < 1 || cap > 50) return badRequest("day_capacity values must be 1-50");
      capEntries.push([dow, cap]);
    }
  }
  const stmts = [env.DB.prepare("DELETE FROM hours")];
  for (const r of rows) {
    stmts.push(
      env.DB.prepare("INSERT INTO hours (dow, open_min, close_min) VALUES (?, ?, ?)").bind(
        parseInt(r.dow, 10),
        parseInt(r.open_min, 10),
        parseInt(r.close_min, 10)
      )
    );
  }
  if (body.day_capacity && typeof body.day_capacity === "object") {
    stmts.push(env.DB.prepare("DELETE FROM day_capacity"));
    for (const [dow, cap] of capEntries) {
      stmts.push(env.DB.prepare("INSERT INTO day_capacity (dow, capacity) VALUES (?, ?)").bind(dow, cap));
    }
  }
  await env.DB.batch(stmts);
  return json({ ok: true });
}

export async function adminListClosures(env) {
  const { results } = await env.DB.prepare("SELECT date, reason FROM closures ORDER BY date").all();
  return json({ closures: results });
}

export async function adminCreateClosure(env, request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return badRequest("Invalid JSON body");
  }
  if (!parseYmd(body.date)) return badRequest("date must be YYYY-MM-DD");
  await env.DB.prepare(
    "INSERT INTO closures (date, reason) VALUES (?, ?) ON CONFLICT(date) DO UPDATE SET reason = excluded.reason"
  )
    .bind(body.date, String(body.reason || "").trim())
    .run();
  return json({ ok: true }, 201);
}

export async function adminDeleteClosure(env, dateStr) {
  await env.DB.prepare("DELETE FROM closures WHERE date = ?").bind(dateStr).run();
  return json({ ok: true });
}

export async function adminGetSettings(env) {
  return json({ settings: await getSettings(env.DB) });
}

export async function adminPutSettings(env, request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return badRequest("Invalid JSON body");
  }
  const capacity = parseInt(body.capacity, 10);
  if (body.capacity !== undefined && (!capacity || capacity < 1 || capacity > 50)) {
    return badRequest("capacity must be 1-50");
  }
  await putSettings(env.DB, body);
  return json({ settings: await getSettings(env.DB) });
}
