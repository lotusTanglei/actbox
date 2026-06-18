// src/lib/folders/classify.ts
// 服务器文件夹 path → 系统类型识别。
// 优先级:IMAP `\SpecialUse` 标志 > 文件夹名(中英) > custom。

export type FolderType = 'inbox' | 'sent' | 'drafts' | 'trash' | 'spam' | 'archive' | 'custom'

/** IMAP `\SpecialUse` 标志集合(如 `new Set(['\\Sent'])`),或 null */
export type SpecUse = Set<string> | null

/** 名字表(已转大写匹配,子串命中即可) */
const NAME_MAP: [string[], FolderType][] = [
  [['INBOX'], 'inbox'],
  [['SENT', '已发送', '发件箱'], 'sent'],
  [['TRASH', 'DELETED', '已删除', '废纸篓', '垃圾桶'], 'trash'],
  [['SPAM', 'JUNK', '垃圾邮件', '广告邮件'], 'spam'],
  [['DRAFTS', 'DRAFT', '草稿', '草稿箱'], 'drafts'],
  [['ARCHIVE', 'ALL MAIL', 'ALL', '归档'], 'archive'],
]

export function classifyFolder(path: string, specialUse: SpecUse): FolderType {
  // 1. \SpecialUse 标志优先
  if (specialUse) {
    if (specialUse.has('\\Inbox')) return 'inbox'
    if (specialUse.has('\\Sent')) return 'sent'
    if (specialUse.has('\\Trash')) return 'trash'
    if (specialUse.has('\\Junk') || specialUse.has('\\Spam')) return 'spam'
    if (specialUse.has('\\Drafts')) return 'drafts'
    if (specialUse.has('\\Archive') || specialUse.has('\\All')) return 'archive'
  }

  // 2. 文件夹名(不区分大小写,子串匹配)
  const p = (path || '').toUpperCase()
  for (const [names, type] of NAME_MAP) {
    if (names.some((n) => p === n.toUpperCase() || p.includes(n.toUpperCase()))) {
      return type
    }
  }

  return 'custom'
}
