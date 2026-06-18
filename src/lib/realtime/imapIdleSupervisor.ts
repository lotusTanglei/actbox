// src/lib/realtime/imapIdleSupervisor.ts
// 每账号 IMAP IDLE 长连接管理:idle 收 EXISTS 秒级触发;29min 打断重 SELECT 续命避开 30min 超时;
// 断线指数退避重连(1s/2s/4s…封顶 60s);连续失败超阈值降级(onDegraded,停止重连)。
// clock 可注入(测试)。plan-06 Task 2。

export interface Clock {
  now(): number
  setTimeout(fn: () => void, ms: number): unknown
  clearTimeout(h: unknown): void
}

export const realClock: Clock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h as NodeJS.Timeout),
}

export interface ImapFlowLike {
  connect(): Promise<void>
  mailboxOpen(path: string): Promise<unknown>
  idle(opts: { onMail?: () => void; onClose?: () => void; onError?: (e: Error) => void }): Promise<void>
  logout(): Promise<void>
}

export interface IdleOptions {
  accountId: number
  clientFactory: () => Promise<ImapFlowLike>
  folder: string
  onNewMail: (e: { accountId: number; folder: string }) => void
  onDegraded?: (e: { accountId: number; reason: string; attempts: number }) => void
  clock?: Clock
  keepaliveMs?: number
  maxFailures?: number
  maxBackoffMs?: number
}

export type IdleState = 'idle' | 'reconnecting' | 'degraded' | 'stopped'

export class ImapIdleSupervisor {
  state: IdleState = 'stopped'
  private client: ImapFlowLike | null = null
  private failures = 0
  private readonly clock: Clock
  private readonly keepaliveMs: number
  private readonly maxFailures: number
  private readonly maxBackoffMs: number
  private keepaliveHandle: unknown = null
  private reconnectHandle: unknown = null
  private readyResolve?: () => void

  constructor(private opts: IdleOptions) {
    this.clock = opts.clock ?? realClock
    this.keepaliveMs = opts.keepaliveMs ?? 29 * 60 * 1000
    this.maxFailures = opts.maxFailures ?? 5
    this.maxBackoffMs = opts.maxBackoffMs ?? 60_000
  }

  /** 启动:后台 runLoop,首次 idle 就绪(或首次降级)后返回。 */
  async start(): Promise<void> {
    this.state = 'reconnecting'
    const ready = new Promise<void>((r) => (this.readyResolve = r))
    void this.runLoop()
    await new Promise<void>((r) => setImmediate(r)) // 排空微任务直到 runLoop 到达阻塞点
    await ready
  }

  private async runLoop(): Promise<void> {
    while (this.state !== 'stopped' && this.state !== 'degraded') {
      try {
        this.client = await this.opts.clientFactory()
        await this.client.connect()
        await this.client.mailboxOpen(this.opts.folder)
        this.failures = 0
        this.state = 'idle'
        this.armKeepalive()
        this.resolveReady()
        await this.client.idle({
          onMail: () => this.opts.onNewMail({ accountId: this.opts.accountId, folder: this.opts.folder }),
        })
        this.disarmKeepalive()
        await this.client.logout().catch(() => {})
        // idle 正常返回(续命打断 / 连接断)→ 循环重连
      } catch (err) {
        this.disarmKeepalive()
        this.failures += 1
        if (this.failures >= this.maxFailures) {
          this.state = 'degraded'
          this.resolveReady()
          this.opts.onDegraded?.({
            accountId: this.opts.accountId,
            reason: (err as Error)?.message ?? String(err),
            attempts: this.failures,
          })
          return
        }
        this.resolveReady()
        this.state = 'reconnecting'
        const backoff = Math.min(this.maxBackoffMs, 1000 * 2 ** (this.failures - 1))
        await this.sleep(backoff)
      }
    }
  }

  private resolveReady(): void {
    if (this.readyResolve) {
      const r = this.readyResolve
      this.readyResolve = undefined
      r()
    }
  }

  private armKeepalive(): void {
    this.disarmKeepalive()
    this.keepaliveHandle = this.clock.setTimeout(() => {
      void this.keepalive()
    }, this.keepaliveMs)
  }

  private disarmKeepalive(): void {
    if (this.keepaliveHandle) {
      this.clock.clearTimeout(this.keepaliveHandle)
      this.keepaliveHandle = null
    }
  }

  /** 29min 续命:logout 当前 idle → idle() 返回 → runLoop 重新 connect+SELECT+idle。 */
  private async keepalive(): Promise<void> {
    try {
      await this.client?.logout()
    } catch {
      /* idle 返回后 runLoop 重连 */
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      this.reconnectHandle = this.clock.setTimeout(resolve, ms)
    })
  }

  async stop(): Promise<void> {
    this.state = 'stopped'
    this.disarmKeepalive()
    if (this.reconnectHandle) this.clock.clearTimeout(this.reconnectHandle)
    this.resolveReady()
    try {
      await this.client?.logout()
    } catch {
      /* ignore */
    }
  }
}
