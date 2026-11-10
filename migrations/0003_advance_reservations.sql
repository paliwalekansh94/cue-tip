-- Staff-only advance reservations. Apply once in Cloudflare D1 after 0002_staff_auth.sql.
CREATE TABLE IF NOT EXISTS reservations (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 station_id INTEGER NOT NULL REFERENCES stations(id),
 customer_name TEXT NOT NULL,
 customer_phone TEXT,
 party_size INTEGER NOT NULL CHECK(party_size BETWEEN 1 AND 20),
 starts_at INTEGER NOT NULL,
 ends_at INTEGER NOT NULL,
 status TEXT NOT NULL DEFAULT 'confirmed' CHECK(status IN ('confirmed','cancelled','completed')),
 notes TEXT NOT NULL DEFAULT '',
 created_by INTEGER NOT NULL REFERENCES staff_users(id),
 created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS reservations_station_time ON reservations(station_id,starts_at,ends_at);
-- Each 5-minute slot can be owned by only one reservation per station.
CREATE TABLE IF NOT EXISTS reservation_slots (
 station_id INTEGER NOT NULL REFERENCES stations(id),
 slot_start INTEGER NOT NULL,
 reservation_id INTEGER NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,
 PRIMARY KEY(station_id,slot_start)
);
CREATE INDEX IF NOT EXISTS reservation_slots_reservation ON reservation_slots(reservation_id);
