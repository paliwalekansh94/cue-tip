-- Cue Tip v0.3 D1 migration. Apply to an EMPTY D1 database.
PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS stations (
 id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE,
 kind TEXT NOT NULL CHECK(kind IN ('Snooker','Pool','Gaming')),
 base_rate_paise INTEGER NOT NULL CHECK(base_rate_paise>=0),
 extra_player_paise INTEGER NOT NULL DEFAULT 0 CHECK(extra_player_paise>=0),
 enabled INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS players (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 name TEXT NOT NULL COLLATE NOCASE UNIQUE,
 created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE TABLE IF NOT EXISTS sessions (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 station_id INTEGER NOT NULL REFERENCES stations(id),
 status TEXT NOT NULL CHECK(status IN ('active','paused','completed','void')),
 started_at INTEGER NOT NULL,
 ended_at INTEGER,
 player_count INTEGER NOT NULL CHECK(player_count BETWEEN 1 AND 20),
 paused_at INTEGER,
 accumulated_paused_ms INTEGER NOT NULL DEFAULT 0,
 play_amount_paise INTEGER,
 snack_amount_paise INTEGER,
 created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE UNIQUE INDEX IF NOT EXISTS sessions_one_open_per_station
 ON sessions(station_id) WHERE status IN ('active','paused');
CREATE TABLE IF NOT EXISTS session_segments (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 session_id INTEGER NOT NULL REFERENCES sessions(id),
 started_at INTEGER NOT NULL,
 ended_at INTEGER,
 player_count INTEGER NOT NULL,
 rate_paise_per_min INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS session_pauses (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 session_id INTEGER NOT NULL REFERENCES sessions(id),
 started_at INTEGER NOT NULL,
 ended_at INTEGER
);
CREATE TABLE IF NOT EXISTS menu_items (
 id INTEGER PRIMARY KEY,
 name TEXT NOT NULL UNIQUE,
 price_paise INTEGER NOT NULL CHECK(price_paise>=0),
 active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS snack_order_items (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 session_id INTEGER NOT NULL REFERENCES sessions(id),
 menu_item_id INTEGER NOT NULL REFERENCES menu_items(id),
 item_name TEXT NOT NULL,
 unit_price_paise INTEGER NOT NULL,
 quantity INTEGER NOT NULL CHECK(quantity>0),
 ordered_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE TABLE IF NOT EXISTS matches (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 winner_player_id INTEGER NOT NULL REFERENCES players(id),
 loser_player_id INTEGER NOT NULL REFERENCES players(id),
 played_at INTEGER NOT NULL DEFAULT (unixepoch()),
 CHECK(winner_player_id<>loser_player_id)
);
CREATE TABLE IF NOT EXISTS audit_log (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 event TEXT NOT NULL,
 entity_id INTEGER,
 at INTEGER NOT NULL DEFAULT (unixepoch())
);
INSERT OR IGNORE INTO stations(id,name,kind,base_rate_paise,extra_player_paise) VALUES
 (1,'Snooker Table 1','Snooker',600,100),
 (2,'Snooker Table 2','Snooker',600,100),
 (3,'Pool Table 1','Pool',500,100),
 (4,'PS5 Station 1','Gaming',500,0);
INSERT OR IGNORE INTO menu_items(id,name,price_paise) VALUES
 (1,'Cold Drink',4000),(2,'French Fries',12000),(3,'Maggi',8000),
 (4,'Water Bottle',2000),(5,'Sandwich',10000);
