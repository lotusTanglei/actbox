// src/lib/search/segmenter.ts
// jieba 中文分词封装(@node-rs/jieba,Rust napi 预编译二进制,免编译)。
// 写入侧(FTS 触发器)与查询侧复用:切词后空格连接。plan-07 Task 1。

import { Jieba } from '@node-rs/jieba'

let jieba: Jieba | null = null
function ensure(): Jieba {
  if (!jieba) jieba = new Jieba()
  return jieba
}

/** 把文本切词后用空格连接,供 FTS5 写入与查询复用。hmm=true 启用 HMM 词组识别。 */
export function segment(text: string): string {
  if (!text || !text.trim()) return ''
  const toks = ensure().cut(text, true)
  return toks.filter((t) => t && t.trim()).join(' ')
}

/** 查询专用:切词 + 折叠空白 + 小写(FTS MATCH 大小写不敏感,统一便于拼接操作符)。 */
export function tokenizeQuery(text: string): string {
  return segment(text)
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}
