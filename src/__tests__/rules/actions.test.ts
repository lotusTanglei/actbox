// src/__tests__/rules/actions.test.ts
import { describe, it, expect, vi } from 'vitest'
import Database from 'better-sqlite3'
import { applyActions, runRulesForMessage } from '@/lib/rules/actions'
import type { RuleMessageContext, RuleAction, Rule } from '@/lib/rules/types'

function memDb() {
  const db = new Database(':memory:')
  db.exec(`CREATE TABLE messages (id INTEGER PRIMARY KEY, message_id TEXT, account_id INTEGER, subject TEXT, sender TEXT, body TEXT, body_html TEXT, folder TEXT, imap_uid INTEGER, is_read INTEGER DEFAULT 0, todo_count INTEGER DEFAULT 0)`)
  db.exec(`CREATE TABLE labels (id INTEGER PRIMARY KEY, account_id INTEGER, name TEXT, color TEXT)`)
  db.exec(`CREATE TABLE message_labels (message_id INTEGER, label_id INTEGER, PRIMARY KEY(message_id, label_id))`)
  db.exec(`CREATE TABLE rules (id INTEGER PRIMARY KEY, account_id INTEGER, name TEXT, enabled INTEGER DEFAULT 1, conditions TEXT, actions TEXT, "order" INTEGER DEFAULT 0, kind TEXT DEFAULT 'normal')`)
  db.exec(`CREATE TABLE todos (id INTEGER PRIMARY KEY, title TEXT, source_message_id TEXT, source_subject TEXT, source_from TEXT)`)
  return db
}

const baseCtx = (over: Partial<RuleMessageContext> = {}): RuleMessageContext => ({
  messageId: 1, accountId: 1, from: 'a@x.com', to: 'me@x.com', cc: '',
  subject: 's', body: 'b', hasAttachment: false, sizeKb: 10, labelIds: [], ...over,
})

describe('applyActions', () => {
  it('markRead → applyAction', async () => {
    const db = memDb()
    db.exec(`INSERT INTO messages (id, message_id, account_id, subject, folder, imap_uid) VALUES (1,'<m>',1,'s','INBOX',10)`)
    const applyAction = vi.fn().mockResolvedValue(undefined)
    await applyActions(db, { context: baseCtx(), actions: [{ type: 'markRead' }], applyAction })
    expect(applyAction).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: 'markRead', messageIds: [1], value: true }))
  })
  it('move → targetFolder', async () => {
    const db = memDb()
    db.exec(`INSERT INTO messages (id, message_id, account_id, subject, folder, imap_uid) VALUES (1,'<m>',1,'s','INBOX',10)`)
    const applyAction = vi.fn().mockResolvedValue(undefined)
    await applyActions(db, { context: baseCtx(), actions: [{ type: 'move', targetFolder: 'Archive' }], applyAction })
    expect(applyAction).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: 'move', messageIds: [1], targetFolder: 'Archive' }))
  })
  it('delete → applyAction delete', async () => {
    const db = memDb()
    db.exec(`INSERT INTO messages (id, message_id, account_id, subject, folder, imap_uid) VALUES (1,'<m>',1,'s','INBOX',10)`)
    const applyAction = vi.fn().mockResolvedValue(undefined)
    await applyActions(db, { context: baseCtx(), actions: [{ type: 'delete' }], applyAction })
    expect(applyAction).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: 'delete', messageIds: [1] }))
  })
  it('label → 本地 attachLabels', async () => {
    const db = memDb()
    db.exec(`INSERT INTO messages (id, message_id, account_id, subject) VALUES (1,'<m>',1,'s'); INSERT INTO labels (id, account_id, name, color) VALUES (5,1,'A','#fff')`)
    const applyAction = vi.fn()
    await applyActions(db, { context: baseCtx(), actions: [{ type: 'label', labelIds: [5] }], applyAction })
    expect(applyAction).not.toHaveBeenCalled()
    expect((db.prepare('SELECT count(*) c FROM message_labels WHERE message_id=1 AND label_id=5').get() as any).c).toBe(1)
  })
  it('返回已执行动作清单', async () => {
    const db = memDb()
    db.exec(`INSERT INTO messages (id, message_id, account_id, subject, folder, imap_uid) VALUES (1,'<m>',1,'s','INBOX',10)`)
    const applied = await applyActions(db, { context: baseCtx(), actions: [{ type: 'markRead' }, { type: 'star' }], applyAction: vi.fn() })
    expect(applied.map(a => a.type)).toEqual(['markRead', 'star'])
  })
})

describe('runRulesForMessage', () => {
  it('白名单命中 → 跳过 normal', async () => {
    const db = memDb()
    db.exec(`INSERT INTO messages (id, message_id, account_id, subject, folder, imap_uid) VALUES (1,'<m>',1,'s','INBOX',10)`)
    db.exec(`INSERT INTO rules (id, account_id, name, enabled, conditions, actions, "order", kind) VALUES (1,1,'wl',1,'{"combinator":"and","conditions":[{"field":"from","operator":"contains","value":"a@"}]}','[]',0,'whitelist'),(2,1,'mv',1,'{"combinator":"and","conditions":[]}','[{"type":"move","targetFolder":"Archive"}]',1,'normal')`)
    const applyAction = vi.fn()
    const res = await runRulesForMessage(db, { context: baseCtx(), getAdapter: () => ({}), applyAction })
    expect(applyAction).not.toHaveBeenCalled()
    expect(res.matchedRuleId).toBeNull()
  })
  it('黑名单命中 → delete', async () => {
    const db = memDb()
    db.exec(`INSERT INTO messages (id, message_id, account_id, subject, sender, folder, imap_uid) VALUES (1,'<m>',1,'s','spam@x.com','INBOX',10)`)
    db.exec(`INSERT INTO rules (id, account_id, name, enabled, conditions, actions, "order", kind) VALUES (1,1,'bl',1,'{"combinator":"and","conditions":[{"field":"from","operator":"contains","value":"spam@"}]}','[{"type":"delete"}]',0,'blacklist')`)
    const applyAction = vi.fn().mockResolvedValue(undefined)
    const res = await runRulesForMessage(db, { context: baseCtx({ from: 'spam@x.com' }), getAdapter: () => ({}), applyAction })
    expect(applyAction).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: 'delete' }))
    expect(res.matchedRuleId).toBe(1)
  })
  it('normal first-match-wins', async () => {
    const db = memDb()
    db.exec(`INSERT INTO messages (id, message_id, account_id, subject, folder, imap_uid) VALUES (1,'<m>',1,'s','INBOX',10)`)
    db.exec(`INSERT INTO rules (id, account_id, name, enabled, conditions, actions, "order", kind) VALUES (1,1,'r1',1,'{"combinator":"and","conditions":[]}','[{"type":"move","targetFolder":"A"}]',0,'normal'),(2,1,'r2',1,'{"combinator":"and","conditions":[]}','[{"type":"move","targetFolder":"B"}]',1,'normal')`)
    const applyAction = vi.fn().mockResolvedValue(undefined)
    const res = await runRulesForMessage(db, { context: baseCtx(), getAdapter: () => ({}), applyAction })
    expect(applyAction).toHaveBeenCalledTimes(1)
    expect(applyAction).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ targetFolder: 'A' }))
    expect(res.matchedRuleId).toBe(1)
  })
  it('禁用的规则不参与', async () => {
    const db = memDb()
    db.exec(`INSERT INTO messages (id, message_id, account_id, subject, folder, imap_uid) VALUES (1,'<m>',1,'s','INBOX',10)`)
    db.exec(`INSERT INTO rules (id, account_id, name, enabled, conditions, actions, "order", kind) VALUES (1,1,'off',0,'{"combinator":"and","conditions":[]}','[{"type":"move","targetFolder":"A"}]',0,'normal')`)
    const applyAction = vi.fn()
    const res = await runRulesForMessage(db, { context: baseCtx(), getAdapter: () => ({}), applyAction })
    expect(applyAction).not.toHaveBeenCalled()
    expect(res.matchedRuleId).toBeNull()
  })
  it('无规则 → 不抛不执行', async () => {
    const db = memDb()
    db.exec(`INSERT INTO messages (id, message_id, account_id, subject) VALUES (1,'<m>',1,'s')`)
    const applyAction = vi.fn()
    const res = await runRulesForMessage(db, { context: baseCtx(), getAdapter: () => ({}), applyAction })
    expect(res.matchedRuleId).toBeNull()
    expect(applyAction).not.toHaveBeenCalled()
  })
})
