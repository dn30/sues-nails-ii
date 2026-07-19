#!/usr/bin/env bash
# Functional tests against a local `wrangler dev` instance on :8787.
set -u
BASE="http://localhost:8787"
AUTH="admin:change-me"
DATE=$(TZ=America/Los_Angeles date -d "+2 days" +%F)
PASS=0; FAIL=0

check() { # check <desc> <expected> <actual>
  if [ "$2" = "$3" ]; then PASS=$((PASS+1)); echo "PASS: $1";
  else FAIL=$((FAIL+1)); echo "FAIL: $1 (expected: $2, got: $3)"; fi
}

jqget() { python3 -c "import json,sys; d=json.load(sys.stdin); print(eval(sys.argv[1]))" "$1" 2>/dev/null; }

echo "== Testing against $BASE on date $DATE =="

# 1. Services list
n=$(curl -s "$BASE/api/services" | jqget "len(d['services'])")
check "6 active services listed" "6" "$n"

# 2. Availability: first slot 9:00 AM, remaining 3
avail=$(curl -s "$BASE/api/availability?service_id=1&date=$DATE")
check "first slot is 9:00 AM" "9:00 AM" "$(echo "$avail" | jqget "d['slots'][0]['label']")"
check "capacity 3 seats remaining" "3" "$(echo "$avail" | jqget "d['slots'][0]['remaining']")"
START=$(echo "$avail" | jqget "d['slots'][0]['start']")

# 3. Group booking (2 seats)
r=$(curl -s -X POST "$BASE/api/bookings" -H 'Content-Type: application/json' \
  -d "{\"service_id\":1,\"start\":\"$START\",\"party_size\":2,\"name\":\"Alice\",\"phone\":\"909-555-0001\"}")
check "group booking of 2 created" "Manicure" "$(echo "$r" | jqget "d['booking']['service']")"

# 4. Remaining drops to 1
rem=$(curl -s "$BASE/api/availability?service_id=1&date=$DATE" | jqget "d['slots'][0]['remaining']")
check "remaining drops to 1 after group booking" "1" "$rem"

# 5. Third seat books fine
r=$(curl -s -X POST "$BASE/api/bookings" -H 'Content-Type: application/json' \
  -d "{\"service_id\":1,\"start\":\"$START\",\"party_size\":1,\"name\":\"Bob\",\"phone\":\"909-555-0002\"}")
check "last seat books" "Manicure" "$(echo "$r" | jqget "d['booking']['service']")"

# 6. Slot now full: not offered (9:30 also hidden by the 10-min after-buffer),
#    and direct attempt rejected
first=$(curl -s "$BASE/api/availability?service_id=1&date=$DATE" | jqget "d['slots'][0]['label']")
check "full slot and buffered neighbor no longer offered" "10:00 AM" "$first"
code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/bookings" -H 'Content-Type: application/json' \
  -d "{\"service_id\":1,\"start\":\"$START\",\"party_size\":1,\"name\":\"Carol\",\"phone\":\"909-555-0003\"}")
check "booking a full slot returns 409" "409" "$code"

# 7. Party size above capacity rejected
code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/bookings" -H 'Content-Type: application/json' \
  -d "{\"service_id\":1,\"start\":\"$START\",\"party_size\":9,\"name\":\"Dan\",\"phone\":\"909-555-0004\"}")
check "party size above capacity returns 400" "400" "$code"

# 8. Off-grid time rejected
odd=$(python3 -c "
from datetime import datetime, timedelta
d = datetime.fromisoformat('$START'.replace('Z','+00:00')) + timedelta(minutes=7)
print(d.strftime('%Y-%m-%dT%H:%M:%S.000Z'))")
code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/bookings" -H 'Content-Type: application/json' \
  -d "{\"service_id\":1,\"start\":\"$odd\",\"party_size\":1,\"name\":\"Eve\",\"phone\":\"909-555-0005\"}")
check "off-grid start time returns 409" "409" "$code"

# 9. Admin auth
code=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/admin/bookings")
check "admin without auth returns 401" "401" "$code"
code=$(curl -s -o /dev/null -w '%{http_code}' -u "admin:wrong" "$BASE/api/admin/bookings")
check "admin with wrong password returns 401" "401" "$code"
code=$(curl -s -o /dev/null -w '%{http_code}' -u "$AUTH" "$BASE/api/admin/bookings")
check "admin with correct password returns 200" "200" "$code"

# 10. Admin: assign staff, then cancel a booking frees a seat
bid=$(curl -s -u "$AUTH" "$BASE/api/admin/bookings?from=$DATE&to=$DATE" | jqget "d['bookings'][0]['id']")
r=$(curl -s -u "$AUTH" -X PATCH "$BASE/api/admin/bookings/$bid" -H 'Content-Type: application/json' -d '{"assigned_to":"Sue"}')
check "assign booking to staff" "True" "$(echo "$r" | jqget "d['ok']")"
r=$(curl -s -u "$AUTH" -X PATCH "$BASE/api/admin/bookings/$bid" -H 'Content-Type: application/json' -d '{"status":"cancelled"}')
first=$(curl -s "$BASE/api/availability?service_id=1&date=$DATE" | jqget "d['slots'][0]['label']")
check "cancelling frees the 9:00 slot again" "9:00 AM" "$first"

# 11. Buffers with capacity 1: manicure blocks 9:00-9:40, so 9:30 gel is gone but 10:00 remains
curl -s -u "$AUTH" -X PUT "$BASE/api/admin/settings" -H 'Content-Type: application/json' -d '{"capacity":1}' > /dev/null
DATE2=$(TZ=America/Los_Angeles date -d "+3 days" +%F)
avail=$(curl -s "$BASE/api/availability?service_id=1&date=$DATE2")
START2=$(echo "$avail" | jqget "d['slots'][0]['start']")
curl -s -X POST "$BASE/api/bookings" -H 'Content-Type: application/json' \
  -d "{\"service_id\":1,\"start\":\"$START2\",\"party_size\":1,\"name\":\"Fay\",\"phone\":\"909-555-0006\"}" > /dev/null
labels=$(curl -s "$BASE/api/availability?service_id=2&date=$DATE2" | jqget "','.join(s['label'] for s in d['slots'][:2])")
check "after-buffer blocks 9:30 next-service slot (capacity 1)" "10:00 AM,10:30 AM" "$labels"
curl -s -u "$AUTH" -X PUT "$BASE/api/admin/settings" -H 'Content-Type: application/json' -d '{"capacity":3}' > /dev/null

# 12. Closure removes all slots
DATE3=$(TZ=America/Los_Angeles date -d "+4 days" +%F)
curl -s -u "$AUTH" -X POST "$BASE/api/admin/closures" -H 'Content-Type: application/json' -d "{\"date\":\"$DATE3\",\"reason\":\"test holiday\"}" > /dev/null
n=$(curl -s "$BASE/api/availability?service_id=1&date=$DATE3" | jqget "len(d['slots'])")
check "closure date has zero slots" "0" "$n"
curl -s -u "$AUTH" -X DELETE "$BASE/api/admin/closures/$DATE3" > /dev/null
n=$(curl -s "$BASE/api/availability?service_id=1&date=$DATE3" | jqget "len(d['slots']) > 0")
check "removing closure restores slots" "True" "$n"

# 13. Service CRUD
r=$(curl -s -u "$AUTH" -X POST "$BASE/api/admin/services" -H 'Content-Type: application/json' \
  -d '{"name":"Test Wax","duration_min":20,"buffer_after_min":5}')
sid=$(echo "$r" | jqget "d['service']['id']")
check "create service" "Test Wax" "$(echo "$r" | jqget "d['service']['name']")"
r=$(curl -s -u "$AUTH" -X PUT "$BASE/api/admin/services/$sid" -H 'Content-Type: application/json' \
  -d '{"name":"Test Wax 2","duration_min":25}')
check "update service" "True" "$(echo "$r" | jqget "d['ok']")"
r=$(curl -s -u "$AUTH" -X DELETE "$BASE/api/admin/services/$sid")
check "delete unused service" "True" "$(echo "$r" | jqget "d['deleted']")"

# 14. Sunday hours end earlier: last manicure slot 5:30 PM (close 6 PM)
SUN=$(TZ=America/Los_Angeles python3 -c "
from datetime import date, timedelta
d = date.today() + timedelta(days=2)
while d.weekday() != 6: d += timedelta(days=1)
print(d)")
last=$(curl -s "$BASE/api/availability?service_id=1&date=$SUN" | jqget "d['slots'][-1]['label']")
check "Sunday last 30-min slot is 5:30 PM" "5:30 PM" "$last"

echo
echo "== $PASS passed, $FAIL failed =="
exit $FAIL
