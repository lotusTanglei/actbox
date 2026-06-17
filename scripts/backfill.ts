// scripts/backfill.ts — body 全文回填 CLI。
//   npm run db:backfill              实际回填
//   npm run db:backfill -- --dry-run 仅预览候选数
//
// 真实 fetchSource（按 accountId 经 IMAP MailAdapter 重拉源邮件）依赖 plan-02。
// plan-02 落地前，本 CLI 的 fetchSource 返回 null —— 仅统计疑似截断候选、不重拉。

import Database from 'better-sqlite3'
import fs from 'fs'
import { runBackfill } from '../src/lib/db/backfill-runner'

const dbPath = process.env.ACTBOX_DB || './data/actbox.db'
const dryRun = process.argv.includes('--dry-run')

fs.mkdirSync('./data', { recursive: true })
const db = new Database(dbPath)

// plan-02 MailAdapter 就绪后接入真实重拉；此前返回 null，仅统计候选。
const fetchSource = async (_accountId: number | null, _messageId: string) => null

runBackfill({ db, fetchSource, dryRun }).then((stats) => {
  console.log('[backfill]', JSON.stringify(stats), dryRun ? '(dry-run)' : '')
  if (stats.total > 0) {
    console.log('[backfill] 注：真实重拉需 plan-02 MailAdapter；当前仅统计候选。')
  }
  db.close()
})
