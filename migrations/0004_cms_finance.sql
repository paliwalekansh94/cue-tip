-- Cue Tip CMS 3.0: append-only financial records and customer directory.
-- Apply after migrations 0001-0003. All monetary values are integer paise.
CREATE TABLE IF NOT EXISTS cms_customers (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 name TEXT NOT NULL,
 phone TEXT NOT NULL DEFAULT '',
 created_at INTEGER NOT NULL,
 UNIQUE(phone)
);
CREATE TABLE IF NOT EXISTS cms_transactions (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 external_key TEXT UNIQUE,
 entry_type TEXT NOT NULL CHECK(entry_type IN ('revenue','expense')),
 category TEXT NOT NULL,
 description TEXT NOT NULL DEFAULT '',
 amount_paise INTEGER NOT NULL CHECK(amount_paise > 0),
 payment_method TEXT NOT NULL CHECK(payment_method IN ('cash','upi','card','bank','other')),
 occurred_at INTEGER NOT NULL,
 customer_id INTEGER REFERENCES cms_customers(id),
 station_id INTEGER REFERENCES stations(id),
 source TEXT NOT NULL CHECK(source IN ('manual','import','session')),
 staff_id INTEGER NOT NULL REFERENCES staff_users(id),
 created_at INTEGER NOT NULL,
 voided_at INTEGER,
 voided_by INTEGER REFERENCES staff_users(id),
 void_reason TEXT
);
CREATE INDEX IF NOT EXISTS cms_tx_time ON cms_transactions(occurred_at);
CREATE INDEX IF NOT EXISTS cms_tx_type ON cms_transactions(entry_type,category,occurred_at);
CREATE INDEX IF NOT EXISTS cms_tx_customer ON cms_transactions(customer_id);
CREATE TABLE IF NOT EXISTS cms_import_batches (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 label TEXT NOT NULL,
 imported_by INTEGER NOT NULL REFERENCES staff_users(id),
 created_at INTEGER NOT NULL,
 accepted INTEGER NOT NULL,
 rejected INTEGER NOT NULL
);
