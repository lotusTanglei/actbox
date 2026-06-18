// src/lib/realtime/startSupervisors.ts
// Next 进程内:对每活跃 idle 账号起 ImapIdleSupervisor(IDLE 长连接),
// EXISTS → pullIncremental 入库 + 发事件;降级 → markDegraded + 事件(由 fallbackPoller 接管)。
// 幂等(已起的账号跳过)。本地自托管,不可 Serverless。plan-06 Task 8。

import { getDb, getRawDb } from '@/lib/db'
import { accounts } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { ImapFlow } from 'imapflow'
import { ImapIdleSupervisor, type ImapFlowLike } from './imapIdleSupervisor'
import { getAdapter } from '@/lib/adapter/mail/adapterRegistry'
import { pullIncremental } from './incrementalSync'
import { markDegraded } from './health'
import { eventBus } from '@/lib/events/eventBus'

const supervisors = new Map<number, ImapIdleSupervisor>()
let fallbackStarted = false

function makeImapFlow(acc: {
  imap_host: string | null
  imap_port: number | null
  user: string
  auth_code: string
}): ImapFlowLike {
  return new ImapFlow({
    host: acc.imap_host || 'localhost',
    port: acc.imap_port || 993,
    secure: true,
    auth: { user: acc.user, pass: acc.auth_code },
    logger: false,
  }) as unknown as ImapFlowLike
}

function startOne(acc: { id: number; imap_host: string | null; imap_port: number | null; user: string; auth_code: string }): void {
  const accountId = acc.id
  const adapter = getAdapter(accountId, { db: getDb() })
  const sup = new ImapIdleSupervisor({
    accountId,
    clientFactory: async () => makeImapFlow(acc),
    folder: 'INBOX',
    onNewMail: ({ folder }) => {
      // better-sqlite3 同步阻塞 → 让出事件循环
      setImmediate(() => {
        if (!adapter) return
        pullIncremental(getRawDb(), { accountId, folder, adapter, publish: (e) => eventBus.publish(e) }).catch(
          (err) => console.error('[idle] pull failed', accountId, err instanceof Error ? err.message : err),
        )
      })
    },
    onDegraded: ({ reason }) => {
      markDegraded(getRawDb(), { accountId, error: reason })
      eventBus.publish({ type: 'status', payload: { accountId, status: 'error', error: reason } })
    },
  })
  supervisors.set(accountId, sup)
  sup.start().catch((e) => console.error('[idle] start failed', accountId, e instanceof Error ? e.message : e))
}

/** 启动所有活跃 idle 账号的 supervisor(幂等)+ 降级轮询。 */
export function startSupervisors(): void {
  const db = getDb()
  const accs = db.select().from(accounts).where(eq(accounts.isActive, true)).all()
  for (const acc of accs) {
    if (acc.syncMode && acc.syncMode !== 'idle') continue // poll 模式由 fallbackPoller 管
    if (supervisors.has(acc.id)) continue
    startOne({
      id: acc.id,
      imap_host: acc.imapHost,
      imap_port: acc.imapPort,
      user: acc.user,
      auth_code: acc.authCode,
    })
  }
  if (!fallbackStarted) {
    import('./fallbackPoller').then(({ startFallbackPoller }) => startFallbackPoller(30))
    fallbackStarted = true
  }
}

export function stopSupervisors(): void {
  for (const [, sup] of supervisors) {
    sup.stop().catch(() => {})
  }
  supervisors.clear()
}

export function isSupervisorRunning(accountId: number): boolean {
  return supervisors.has(accountId)
}
