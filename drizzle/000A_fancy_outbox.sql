CREATE TABLE IF NOT EXISTS outbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER,
  "to" TEXT NOT NULL,
  cc TEXT,
  bcc TEXT,
  subject TEXT,
  body_html TEXT,
  scheduled_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK(status IN ('queued','sending','sent','failed','bounced')),
  attempts INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()*1000),
  sent_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_outbox_scheduled ON outbox(status, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_outbox_account ON outbox(account_id);

CREATE TABLE IF NOT EXISTS templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER,
  name TEXT NOT NULL,
  body_html TEXT NOT NULL,
  variables TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()*1000)
);
