// src/lib/security/spam.ts — 垃圾邮件评分(SpamAssassin 规则子集)。plan-11 Task 3。
export interface SpamContext { from: string; subject: string; bodyText: string; bodyHtml: string; date: string | null; messageId: string | null; hasAttachment: boolean; receivedHeader?: string }
export interface SpamVerdict { score: number; isSpam: boolean; reasons: string[]; threshold: number }
export const DEFAULT_SPAM_THRESHOLD = 5.0

interface Rule { id: string; score: number; test: (ctx: SpamContext) => boolean }

const FREE_WORDS = ['免费','中奖','中奖通知','领取','free','prize','lottery','viagra','casino','彩票','代开发票']
const URGENCY_WORDS = ['立即点击','限时','马上','act now','urgent','click here now','verify now','suspended']

const RULES: Rule[] = [
  { id: 'SUBJ_ALL_CAPS', score: 2.0, test: c => { const s=(c.subject||'').trim(); return s.length>5 && s===s.toUpperCase() && /[A-Z]/.test(s) && !/[一-龥]/.test(s) }},
  { id: 'FREE_WORD', score: 2.5, test: c => { const hay=`${c.subject} ${c.bodyText} ${c.bodyHtml}`.toLowerCase(); return FREE_WORDS.some(w => hay.includes(w.toLowerCase())) }},
  { id: 'URGENCY_WORDS', score: 1.5, test: c => { const hay=`${c.subject} ${c.bodyText}`.toLowerCase(); return URGENCY_WORDS.some(w => hay.includes(w.toLowerCase())) }},
  { id: 'RDNS_NONE', score: 1.2, test: c => { const h=c.receivedHeader||''; return h.length===0 || (!/[a-z0-9-]+\.[a-z]{2,}/i.test(h) && /\d+\.\d+\.\d+\.\d+/.test(h)) }},
  { id: 'FROM_LOCALPART_NUMERIC', score: 1.0, test: c => { const m=(c.from||'').match(/^<?([^\s@<>]+)@/); return !!m && /^\d+$/.test(m[1]) }},
  { id: 'MISSING_DATE', score: 1.0, test: c => !c.date },
  { id: 'MISSING_MESSAGE_ID', score: 1.0, test: c => !c.messageId },
  { id: 'HTML_FORM', score: 2.0, test: c => /<form\b/i.test(c.bodyHtml||'') },
  { id: 'HTML_SHORT_LEN', score: 1.5, test: c => { const bh=(c.bodyHtml||'').replace(/<[^>]+>/g,'').trim(); return bh.length<50 && /<a\s/i.test(c.bodyHtml||'') }},
  { id: 'SUBJ_HAS_EXCESS_MARK', score: 1.0, test: c => /[!?]{3,}/.test(c.subject||'') },
  { id: 'HIGH_SPAM_KEYWORDS_BUNDLE', score: 3.0, test: c => { const hay=`${c.subject} ${c.bodyText}`.toLowerCase(); return FREE_WORDS.filter(w => hay.includes(w.toLowerCase())).length>=3 }},
]

export function scoreSpam(ctx: SpamContext, opts: { threshold?: number; whitelistSenders?: string[]; extraSpamWords?: string[] } = {}): SpamVerdict {
  const threshold = opts.threshold ?? DEFAULT_SPAM_THRESHOLD
  // 白名单豁免
  if (opts.whitelistSenders?.length) {
    const from = ctx.from.toLowerCase()
    if (opts.whitelistSenders.some(e => from.includes(e.toLowerCase()))) return { score: 0, isSpam: false, reasons: [], threshold }
  }
  const extraWords = opts.extraSpamWords ?? []
  let score = 0; const reasons: string[] = []
  for (const r of RULES) {
    try {
      if (r.test(ctx)) { score += r.score; reasons.push(r.id) }
    } catch { /* 单条规则异常不中断 */ }
  }
  // 额外学习词
  if (extraWords.length) {
    const hay = `${ctx.subject} ${ctx.bodyText}`.toLowerCase()
    for (const w of extraWords) { if (hay.includes(w.toLowerCase())) { score += 1.0; reasons.push(`LEARNED:${w}`) } }
  }
  return { score, isSpam: score >= threshold, reasons, threshold }
}
