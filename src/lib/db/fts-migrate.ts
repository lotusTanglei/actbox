// src/lib/db/fts-migrate.ts
// FTS5 外部内容虚表 + 触发器(手写 DDL,不进 drizzle journal)+ segment() UDF + 存量分词回填。
// 触发器列名与 messages 真实列严格一致(subject/sender/to/body/body_html_text)。plan-07 Task 3。

import type Database from 'better-sqlite3'
import { segment } from '@/lib/search/segmenter'

const FTS_DDL = `
-- 常规 FTS5 表(非外部内容:外部内容表直接 INSERT 会 corrupt vtab)。
-- rowid = messages.id;三组触发器在 insert/delete 两端都用 segment() 分词,
-- 保证 FTS5 'delete' 命令的 term 与建索引时一致。
CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
  subject, sender, "to", body, body_html_text, tokenize='unicode61'
);

CREATE TRIGGER IF NOT EXISTS messages_fts_ai AFTER INSERT ON messages BEGIN
  INSERT INTO messages_fts(rowid, subject, sender, "to", body, body_html_text)
  VALUES (NEW.id, segment(NEW.subject), segment(NEW.sender), segment(NEW."to"), segment(NEW.body), segment(NEW.body_html_text));
END;

CREATE TRIGGER IF NOT EXISTS messages_fts_ad AFTER DELETE ON messages BEGIN
  DELETE FROM messages_fts WHERE rowid = OLD.id;
END;

CREATE TRIGGER IF NOT EXISTS messages_fts_au AFTER UPDATE ON messages BEGIN
  DELETE FROM messages_fts WHERE rowid = OLD.id;
  INSERT INTO messages_fts(rowid, subject, sender, "to", body, body_html_text)
  VALUES (NEW.id, segment(NEW.subject), segment(NEW.sender), segment(NEW."to"), segment(NEW.body), segment(NEW.body_html_text));
END;
`

/** 注册 SQLite 自定义标量函数 segment(),供触发器调用做中文预分词。幂等。
 *  注意:不可加 directOnly(会禁止在触发器内调用,触发器是 indirect 上下文)。 */
export function registerSegmentFunction(db: Database.Database): void {
  try {
    db.function('segment', { deterministic: true }, (s: unknown) => {
      if (s == null) return null
      const seg = segment(String(s))
      return seg === '' ? null : seg
    })
  } catch {
    /* 已注册 */
  }
}

/** 幂等执行 FTS5 虚表 + 触发器 DDL,并对存量 messages 用 segment() 分词回填。 */
export function runFtsMigrate(db: Database.Database): void {
  registerSegmentFunction(db)
  db.exec(FTS_DDL)

  const ftsCount = (db.prepare('SELECT count(*) AS c FROM messages_fts').get() as { c: number }).c
  const msgCount = (db.prepare('SELECT count(*) AS c FROM messages').get() as { c: number }).c
  // FTS 为空但有存量 messages → 用 segment() 分词回填(不能 'rebuild',会跳过分词致中文不命中)
  if (ftsCount === 0 && msgCount > 0) {
    type Row = {
      id: number
      subject: string | null
      sender: string | null
      to: string | null
      body: string | null
      body_html_text: string | null
    }
    const rows = db
      .prepare('SELECT id, subject, sender, "to", body, body_html_text FROM messages')
      .all() as unknown as Row[]
    const seg = (v: string | null) => (v == null ? null : segment(v) || null)
    const ins = db.prepare(
      `INSERT INTO messages_fts(rowid, subject, sender, "to", body, body_html_text) VALUES (?,?,?,?,?,?)`,
    )
    const tx = db.transaction((rs: Row[]) => {
      for (const r of rs) {
        ins.run(r.id, seg(r.subject), seg(r.sender), seg(r.to), seg(r.body), seg(r.body_html_text))
      }
    })
    tx(rows)
  }
}
