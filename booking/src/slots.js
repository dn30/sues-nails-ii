// Timezone helpers and slot computation. Times are stored as UTC epoch ms;
// all schedule rules (hours, closures, slot grid) live in the salon's timezone.

function tzOffsetMs(tz, date) {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const p = Object.fromEntries(dtf.formatToParts(date).map((x) => [x.type, x.value]));
  const asUtc = Date.UTC(+p.year, p.month - 1, +p.day, p.hour === "24" ? 0 : +p.hour, +p.minute, +p.second);
  return asUtc - date.getTime();
}

// Convert a wall-clock time (y, m, d, minutes-since-midnight) in tz to UTC ms.
export function wallToUtc(tz, y, m, d, minutes) {
  let ts = Date.UTC(y, m - 1, d, 0, minutes);
  // Two passes handle DST transitions.
  for (let i = 0; i < 2; i++) {
    ts = Date.UTC(y, m - 1, d, 0, minutes) - tzOffsetMs(tz, new Date(ts));
  }
  return ts;
}

export function ymdInTz(tz, ts) {
  const dtf = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return dtf.format(new Date(ts)); // YYYY-MM-DD
}

export function fmtTimeInTz(tz, ts) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(ts));
}

export function parseYmd(dateStr) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr || "");
  if (!m) return null;
  const [y, mo, d] = [+m[1], +m[2], +m[3]];
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return { y, m: mo, d };
}

// Day of week (0=Sunday) of a calendar date, independent of timezone.
export function dowOfDate(y, m, d) {
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

// Peak concurrent seats within [winStart, winEnd) among the given bookings.
// Each booking occupies party_size seats over [block_start_ts, block_end_ts).
export function maxConcurrentSeats(bookings, winStart, winEnd) {
  const events = [];
  for (const b of bookings) {
    const s = Math.max(b.block_start_ts, winStart);
    const e = Math.min(b.block_end_ts, winEnd);
    if (s < e) {
      events.push([s, b.party_size]);
      events.push([e, -b.party_size]);
    }
  }
  events.sort((a, b) => a[0] - b[0] || a[1] - b[1]); // ends before starts at ties
  let cur = 0;
  let max = 0;
  for (const [, delta] of events) {
    cur += delta;
    if (cur > max) max = cur;
  }
  return max;
}

/**
 * Compute bookable slots for a service on a local calendar date.
 *
 * @param {object} args
 *   service:   { duration_min, buffer_before_min, buffer_after_min }
 *   date:      { y, m, d } salon-local calendar date
 *   settings:  { timezone, capacity, slot_interval_min, min_notice_min }
 *   hours:     [{ dow, open_min, close_min }] weekly windows
 *   closed:    boolean — the date is a closure
 *   bookings:  confirmed bookings overlapping the day (block windows, party_size)
 *   now:       current UTC ms
 * @returns [{ start_ts, end_ts, remaining }]
 */
export function computeSlots({ service, date, settings, hours, closed, bookings, now }) {
  if (closed) return [];
  const tz = settings.timezone;
  const interval = settings.slot_interval_min;
  const capacity = settings.capacity;
  const dow = dowOfDate(date.y, date.m, date.d);
  const windows = hours.filter((h) => h.dow === dow);
  const earliestStart = now + settings.min_notice_min * 60000;
  const slots = [];

  for (const w of windows) {
    for (let t = w.open_min; t + service.duration_min <= w.close_min; t += interval) {
      const startTs = wallToUtc(tz, date.y, date.m, date.d, t);
      if (startTs < earliestStart) continue;
      const endTs = startTs + service.duration_min * 60000;
      const blockStart = startTs - service.buffer_before_min * 60000;
      const blockEnd = endTs + service.buffer_after_min * 60000;
      const overlapping = bookings.filter(
        (b) => b.block_start_ts < blockEnd && b.block_end_ts > blockStart
      );
      const used = maxConcurrentSeats(overlapping, blockStart, blockEnd);
      const remaining = capacity - used;
      if (remaining >= 1) {
        slots.push({ start_ts: startTs, end_ts: endTs, remaining });
      }
    }
  }
  slots.sort((a, b) => a.start_ts - b.start_ts);
  return slots;
}
