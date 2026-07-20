# Sue's Nails — Booking System

A lightweight, modular appointment booking system that runs entirely on Cloudflare's
free tier: one Worker (API + embeddable widget + admin UI) and one D1 (SQLite) database.
No frameworks, no build step, no other services.

## What it does

- **Services with different durations and prices**, plus per-service before/after **buffers**
- **Real-time availability**: customers only ever see bookable slots
- **Group bookings**: multiple customers can share a slot until it is full; the widget
  shows the combined price and issues one confirmation code for the group
- **Overbooking prevention**: capacity is enforced at read time *and* atomically at
  write time (post-insert verification; D1 is single-writer, so the last verifier
  sees all competing inserts)
- **Seat-based capacity**: a default "seats" setting says how many customers the salon
  can serve at once, with **per-weekday overrides** (e.g. more seats on Saturdays).
  Set it to 1 for a strict single-seat schedule
- **Host availability**: weekly opening hours (multiple windows per day) plus
  full-day closures for holidays
- **Manual round robin**: each booking has an "assigned to" field the admin sets from
  the employee list managed in the Staff tab — no automated distribution
- **Embeddable widget**: two lines of HTML on any site
- **Admin at `/admin`**: HTTP Basic Auth deep link, invisible from the customer site —
  manage bookings, services, hours, closures, and settings
- Timezone-aware (default `America/Los_Angeles`); times stored as UTC epoch ms

Out of scope for this MVP (by design): payments, email/SMS notifications,
customer-facing cancellation. The schema keeps everything needed to add them later.

## Repository layout

```
booking/
├── wrangler.toml          Worker + D1 config
├── schema.sql             Tables + seed data (idempotent)
├── test-api.sh            Functional test suite (needs `wrangler dev` running)
└── src/
    ├── index.js           Router / entry point
    ├── api.js             Public API (services, availability, create booking)
    ├── admin-api.js       Admin API + Basic Auth
    ├── db.js              Query helpers + settings
    ├── slots.js           Slot computation, capacity sweep, timezone math
    ├── widget.client.js   Embeddable widget (served at /widget.js)
    ├── admin.page.html    Admin single-page UI (served at /admin)
    └── demo.page.html     Demo embed page (served at / and /demo)
```

## Deploy (one time)

Requires a Cloudflare API token with Workers + D1 permissions
(the "Edit Cloudflare Workers" template works).

```bash
cd booking

# 1. Create the production database and copy the printed database_id
#    into wrangler.toml (replacing REPLACE_WITH_D1_DATABASE_ID)
npx wrangler d1 create sues-nails-booking

# 2. Create tables and seed defaults (hours, starter services, settings)
npx wrangler d1 execute sues-nails-booking --remote --file=schema.sql

# 3. Set the admin / soft-launch password (username is in wrangler.toml)
npx wrangler secret put ADMIN_PASSWORD

# 4. Ship it
npx wrangler deploy
```

Soft-launch URLs after deploy:

- Booking (password-gated): `https://sues-nails-booking.<subdomain>.workers.dev/booking`
- Admin (same login): `https://sues-nails-booking.<subdomain>.workers.dev/admin`

Leave `window.BOOKING_API` empty on the main site until you're ready to go public.

## Plug it into the website

The main site is already wired. In `index.html` (repo root), set:

```js
window.BOOKING_API = "https://sues-nails-booking.<your-subdomain>.workers.dev";
```

That single line reveals the "Book Online" nav link and the booking section.
Any other site can embed the widget with:

```html
<div id="sues-booking"></div>
<script src="https://WORKER-URL/widget.js" data-target="#sues-booking" defer></script>
```

The widget infers the API base from its own script URL — no further configuration.

## Admin & soft-launch booking

Open these deep links (nothing on the public website links to them):

- `https://WORKER-URL/booking` — customer booking widget (soft launch)
- `https://WORKER-URL/admin` — admin panel

Both use HTTP Basic Auth with the same credentials:

- **Username:** the exact email in `wrangler.toml` → `[vars].ADMIN_USERNAME`
- **Password:** the `ADMIN_PASSWORD` Worker secret

```bash
npx wrangler secret put ADMIN_PASSWORD
```

Until you set `window.BOOKING_API` on the main site, the public Sue's Nails
pages have no booking nav or section.

- **Bookings** — upcoming bookings by date range; assign staff, cancel/restore
- **Services** — create/edit name, description, price, duration, buffers, order, active flag
- **Staff** — add/remove employees; they appear in the "assigned to" dropdown
- **Hours & Closures** — weekly windows per day (add several or none), per-day seat
  counts, holiday dates
- **Settings** — default seats (capacity), slot grid, minimum notice, booking window,
  timezone

## Local development

```bash
cd booking
cp .dev.vars.example .dev.vars           # set ADMIN_USERNAME + ADMIN_PASSWORD
npx wrangler d1 execute sues-nails-booking --local --file=schema.sql
npx wrangler dev                         # http://localhost:8787/booking
./test-api.sh                            # functional tests against the dev server
```

## API reference

Public (CORS `*`):

| Method | Path | Description |
| --- | --- | --- |
| GET | `/api/services` | Active services |
| GET | `/api/availability?service_id=&date=YYYY-MM-DD` | Bookable slots with seats remaining |
| POST | `/api/bookings` | `{service_id, start, party_size, name, phone, email?, notes?}` → confirmation code |

Admin (Basic Auth):

| Method | Path | Description |
| --- | --- | --- |
| GET | `/api/admin/bookings?from=&to=&include_cancelled=1` | List bookings |
| PATCH | `/api/admin/bookings/:id` | `{assigned_to?, status?, notes?}` |
| GET/POST | `/api/admin/services` · PUT/DELETE `/api/admin/services/:id` | Service CRUD incl. price (delete deactivates if booked) |
| GET/POST | `/api/admin/staff` · DELETE `/api/admin/staff/:id` | Employee list for booking assignment |
| GET/PUT | `/api/admin/hours` | Weekly hour windows + per-day seat capacity (replace-all) |
| GET/POST | `/api/admin/closures` · DELETE `/api/admin/closures/:date` | Holiday closures |
| GET/PUT | `/api/admin/settings` | default capacity, slot grid, notice, window, timezone |

## How capacity works

Every booking occupies `party_size` seats for its *blocked window*
(start − before-buffer → end + after-buffer). A slot is offered when the peak
concurrent seat usage across its blocked window, computed with an event sweep,
leaves at least one seat under that day's capacity (the per-weekday override
if set, otherwise the default from Settings). Group bookings simply take
more seats of the same slot. With capacity 1 this degrades to a classic
one-at-a-time calendar where buffers fully separate appointments.

## Costs

Cloudflare free tier covers: 100k Worker requests/day, 5M D1 reads/day, 100k D1
writes/day, 5 GB storage. A single salon's booking volume is orders of magnitude
below all of these, so the expected monthly cost is $0.
