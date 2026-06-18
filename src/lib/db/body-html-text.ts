// src/lib/db/body-html-text.ts
// body_html → 去标签纯文本,供 messages.body_html_text 列与 FTS 索引。
// 轻量正则实现(不引 jsdom;渲染侧净化 DOMPurify 属子项目 11)。plan-07 Task 2。

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  copy: '©',
  reg: '®',
}

function decodeEntities(s: string): string {
  return s
    .replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (full, body: string) => {
      if (body[0] === '#') {
        const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10)
        return Number.isNaN(code) ? full : String.fromCodePoint(code)
      }
      return body in NAMED_ENTITIES ? NAMED_ENTITIES[body] : full
    })
}

/** HTML → 纯文本:去 script/style 块、去标签、解码实体、折叠空白。 */
export function htmlToText(html: string): string {
  if (!html || typeof html !== 'string') return ''
  let s = html
  s = s.replace(/<style[\s\S]*?<\/style>/gi, ' ')
  s = s.replace(/<script[\s\S]*?<\/script>/gi, ' ')
  s = s.replace(/<[^>]+>/g, ' ') // 去标签
  s = decodeEntities(s)
  return s.replace(/\s+/g, ' ').trim()
}
