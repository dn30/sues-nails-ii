import {
  getSettings,
  getService,
  listServices,
  getHours,
  getDayCapacity,
  isClosed,
  bookingsInWindow,
  newBookingCode,
} from "./db.js";
import {
  computeSlots,
  parseYmd,
  wallToUtc,
  fmtTimeInTz,
  ymdInTz,
  dowOfDate,
  maxConcurrentSeats,
} from "./slots.js";

export function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      ...extraHeaders,
    },
  });
}

export function badRequest(message) {
  return json({ error: message }, 400);
}

// Seat capacity effective on a given local date (per-weekday override or global).
export function capacityForDate(settings, dayCapacity, date) {
  const dow = dowOfDate(date.y, date.m, date.d);
  return dayCapacity[dow] ?? settings.capacity;
}

// opts.admin relaxes customer-facing limits: no minimum notice and no
// max-days-ahead window (staff take phone bookings beyond the public window).
export async function slotsForDate(db, service, dateStr, settings, now, opts = {}) {
  const date = parseYmd(dateStr);
  if (!date) return { error: "Invalid date, expected YYYY-MM-DD" };

  const tz = settings.timezone;
  const todayStr = ymdInTz(tz, now);
  const maxTs = now + settings.max_days_ahead * 86400000;
  const maxStr = ymdInTz(tz, maxTs);
  if (dateStr < todayStr || (!opts.admin && dateStr > maxStr)) {
    return { slots: [], capacity: settings.capacity };
  }

  const [hours, closed, dayCapacity] = await Promise.all([
    getHours(db),
    isClosed(db, dateStr),
    getDayCapacity(db),
  ]);
  const capacity = capacityForDate(settings, dayCapacity, date);
  // Fetch bookings in a generous window around the local day (+/- 1 day handles tz edges).
  const dayStart = wallToUtc(tz, date.y, date.m, date.d, 0);
  const bookings = await bookingsInWindow(db, dayStart - 86400000, dayStart + 2 * 86400000);

  const slots = computeSlots({
    service,
    date,
    settings: { ...settings, capacity, min_notice_min: opts.admin ? 0 : settings.min_notice_min },
    hours,
    closed,
    bookings,
    now,
  });
  return {
    capacity,
    slots: slots.map((s) => ({
      start: new Date(s.start_ts).toISOString(),
      start_ts: s.start_ts,
      label: fmtTimeInTz(tz, s.start_ts),
      remaining: s.remaining,
    })),
  };
}

export async function handleListServices(env) {
  const services = await listServices(env.DB, { activeOnly: true });
  return json({
    services: services.map((s) => ({
      id: s.id,
      name: s.name,
      description: s.description,
      duration_min: s.duration_min,
      price_cents: s.price_cents,
    })),
  });
}

export async function handleAvailability(env, url) {
  const serviceId = parseInt(url.searchParams.get("service_id"), 10);
  const dateStr = url.searchParams.get("date");
  if (!serviceId) return badRequest("service_id is required");
  if (!dateStr) return badRequest("date is required");

  const service = await getService(env.DB, serviceId, { activeOnly: true });
  if (!service) return json({ error: "Service not found" }, 404);

  const settings = await getSettings(env.DB);
  const result = await slotsForDate(env.DB, service, dateStr, settings, Date.now());
  if (result.error) return badRequest(result.error);
  return json({ service_id: serviceId, date: dateStr, ...result });
}

export async function handleCreateBooking(env, request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return badRequest("Invalid JSON body");
  }

  const serviceId = parseInt(body.service_id, 10);
  const startTs = Date.parse(body.start);
  const partySize = Math.max(1, parseInt(body.party_size, 10) || 1);
  const name = String(body.name || "").trim();
  const phone = String(body.phone || "").trim();
  const email = String(body.email || "").trim();
  const notes = String(body.notes || "").trim().slice(0, 500);

  if (!serviceId) return badRequest("service_id is required");
  if (!Number.isFinite(startTs)) return badRequest("start must be an ISO datetime");
  if (!name) return badRequest("name is required");
  if (!phone) return badRequest("phone is required");

  const service = await getService(env.DB, serviceId, { activeOnly: true });
  if (!service) return json({ error: "Service not found" }, 404);

  const settings = await getSettings(env.DB);

  // The requested start must be one of the currently valid slots (right grid,
  // inside hours, not closed, enough seats).
  const now = Date.now();
  const dateStr = ymdInTz(settings.timezone, startTs);
  const result = await slotsForDate(env.DB, service, dateStr, settings, now);
  if (result.error) return badRequest(result.error);
  const capacity = result.capacity;
  if (partySize > capacity) {
    return badRequest(`Party size cannot exceed ${capacity}`);
  }
  const slot = (result.slots || []).find((s) => s.start_ts === startTs);
  if (!slot) return json({ error: "That time is not available" }, 409);
  if (slot.remaining < partySize) {
    return json({ error: `Only ${slot.remaining} seat(s) left at that time` }, 409);
  }

  const endTs = startTs + service.duration_min * 60000;
  const blockStart = startTs - service.buffer_before_min * 60000;
  const blockEnd = endTs + service.buffer_after_min * 60000;
  const code = newBookingCode();

  const inserted = await env.DB.prepare(
    `INSERT INTO bookings
       (code, service_id, start_ts, end_ts, block_start_ts, block_end_ts,
        party_size, customer_name, customer_phone, customer_email, notes, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`
  )
    .bind(code, serviceId, startTs, endTs, blockStart, blockEnd, partySize, name, phone, email, notes, now)
    .first();

  // Post-insert verification guards against a concurrent booking racing past the
  // pre-check (D1 is single-writer, so the last verifier sees all inserts).
  const overlapping = await bookingsInWindow(env.DB, blockStart, blockEnd);
  const peak = maxConcurrentSeats(overlapping, blockStart, blockEnd);
  if (peak > capacity) {
    await env.DB.prepare("DELETE FROM bookings WHERE id = ?").bind(inserted.id).run();
    return json({ error: "That time was just booked by someone else. Please pick another." }, 409);
  }

  return json(
    {
      booking: {
        code,
        service: service.name,
        start: new Date(startTs).toISOString(),
        label: `${dateStr} ${fmtTimeInTz(settings.timezone, startTs)}`,
        party_size: partySize,
        total_cents: service.price_cents * partySize,
      },
    },
    201
  );
}
