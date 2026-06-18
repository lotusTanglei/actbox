// src/lib/search/segmenter.ts
// jieba 中文分词封装(@node-rs/jieba,Rust napi 预编译二进制,免编译)。
// 写入侧(FTS 触发器)与查询侧复用:切词后空格连接。plan-07 Task 1。

import { cut as jiebaCut } from '@node-rs/jieba'

let inited = false
function ensureInited() {
  if (inited) return
  jiebaCut('预热', false) // 首次调用加载默认词典
  inited = true
}

/** 把文本切词后用空格连接,供 FTS5 写入与查询复用。 */
export function segment(text: string): string {
  if (!text || !text.trim()) return ''
  ensureInited()
  const toks = jiebaCut(text, false) // false = 精确模式
  return toks.filter(Boolean).join(' ')
}

/** 查询专用:切词 + 折叠空白 + 小写(FTS MATCH 大小写不敏感,统一便于拼接操作符)。 */
export function tokenizeQuery(text: string): string {
  return segment(text)
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}
