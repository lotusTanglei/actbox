// src/__tests__/adapter/imapAdapter.folders.test.ts
// ImapAdapter 文件夹/动作契约: listFolders 读 specialUse 映射;move/delete 对象形式 UID 调用.

import { describe, it, expect, vi } from 'vitest'
import { ImapAdapter } from '@/lib/adapter/mail/imapAdapter'

function cfg() {
  return { id: 1, email: 'a@b', user: 'a@b', authCode: 'x', imapHost: 'h', imapPort: 993, smtpHost: 'h', smtpPort: 465 }
}

describe('ImapAdapter 文件夹/动作契约', () => {
  it('listFolders 读 specialUse 并映射 type', async () => {
    const list = vi.fn().mockResolvedValue([
      { path: 'INBOX', specialUse: '\\Inbox', name: 'INBOX' },
      { path: 'Sent', specialUse: '\\Sent', name: 'Sent' },
      { path: 'X', specialUse: null, name: 'X' },
    ])
    const client = { connect: vi.fn(), list, logout: vi.fn() } as any
    const a = new ImapAdapter(cfg(), { clientFactory: async () => client })
    const folders = await a.listFolders()
    expect(folders.map((f) => [f.path, f.type])).toEqual([
      ['INBOX', 'inbox'],
      ['Sent', 'sent'],
      ['X', 'custom'],
    ])
  })

  it('move 用 UID + 对象形式(source/destination)', async () => {
    const messageMove = vi.fn().mockResolvedValue(undefined)
    const client = { connect: vi.fn(), mailboxOpen: vi.fn(), messageMove, logout: vi.fn() } as any
    const a = new ImapAdapter(cfg(), { clientFactory: async () => client })
    await a.move(99, 'INBOX', 'Archive')
    expect(messageMove).toHaveBeenCalledWith(
      expect.objectContaining({ uid: true, range: '99', source: 'INBOX', destination: 'Archive' }),
    )
  })

  it('delete 用 UID + \\Deleted', async () => {
    const del = vi.fn()
    const expunge = vi.fn()
    const client = {
      connect: vi.fn(),
      mailboxOpen: vi.fn(),
      messageFlagsAdd: del,
      messageFlagsAddExpunge: expunge,
      logout: vi.fn(),
    } as any
    const a = new ImapAdapter(cfg(), { clientFactory: async () => client })
    await a.delete(99, 'Trash')
    expect(del).toHaveBeenCalledWith(expect.objectContaining({ uid: true, range: '99', add: ['\\Deleted'] }))
  })
})
