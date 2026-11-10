-- Initial Cloudflare D1 schema (not deployed)
CREATE TABLE IF NOT EXISTS stations (id INTEGER PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL, rate_per_minute INTEGER NOT NULL CHECK(rate_per_minute>=0), enabled INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS customers (id INTEGER PRIMARY KEY AUTOINCREMENT, display_name TEXT NOT NULL, phone TEXT UNIQUE, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS sessions (id INTEGER PRIMARY KEY AUTOINCREMENT, station_id INTEGER NOT NULL REFERENCES stations(id), customer_id INTEGER REFERENCES customers(id), status TEXT NOT NULL CHECK(status IN ('active','paused','completed','void')), started_at TEXT NOT NULL, ended_at TEXT, billable_seconds INTEGER NOT NULL DEFAULT 0, amount_paise INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS session_events (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id INTEGER NOT NULL REFERENCES sessions(id), action TEXT NOT NULL, at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS payments (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id INTEGER NOT NULL REFERENCES sessions(id), amount_paise INTEGER NOT NULL, method TEXT NOT NULL, recorded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE UNIQUE INDEX IF NOT EXISTS one_open_session_per_station ON sessions(station_id) WHERE status IN ('active','paused');
