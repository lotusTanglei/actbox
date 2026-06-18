// src/lib/security/sanitize.ts — DOMPurify email HTML sanitization (XSS)。plan-11 Task 1。
import DOMPurify from 'dompurify'

let purifyInstance: DOMPurify.DOMPurifyI | null = null

function getPurify(): DOMPurify.DOMPurifyI {
  if (purifyInstance) return purifyInstance
  let win: any
  if (typeof window !== 'undefined') {
    win = window
  } else {
    const { JSDOM } = require('jsdom') as typeof import('jsdom')
    win = new JSDOM('', { url: 'http://localhost/' }).window
  }
  const purify = DOMPurify(win)
  purify.addHook('afterSanitizeAttributes', (node: any) => {
    if (node.tagName === 'A' || node.tagName === 'AREA') {
      const href = (node.getAttribute('href') || '').trim().toLowerCase()
      if (href.startsWith('javascript:') || href.startsWith('vbscript:') || href.startsWith('data:text/html')) node.removeAttribute('href')
    }
    for (const attr of Array.from(node.attributes || [])) { if (/^on/i.test(attr.name)) node.removeAttribute(attr.name) }
    const style = node.getAttribute('style')
    if (style && /(expression\s*\(|javascript:|vbscript:)/i.test(style)) node.removeAttribute('style')
  })
  purifyInstance = purify
  return purify
}

const SANITIZE_CONFIG: DOMPurify.Config = {
  ALLOWED_TAGS: ['a','p','br','img','table','thead','tbody','tr','td','th','ul','ol','li','span','div','h1','h2','h3','h4','h5','h6','strong','em','b','i','u','blockquote','pre','hr','font','center','colgroup','col','caption','sub','sup','dl','dt','dd'],
  ALLOWED_ATTR: ['href','src','alt','title','width','height','style','align','valign','bgcolor','color','colspan','rowspan','target','rel','class','id','cid'],
  ALLOW_DATA_ATTR: false,
  FORBID_TAGS: ['script','iframe','object','embed','form','base','meta','link','style','input','button','svg'],
  FORBID_ATTR: ['onerror','onload','onclick','onmouseover','onfocus','onblur','onchange','onsubmit'],
  ALLOWED_URI_REGEXP: /^(?:(?:https?|ftp|mailto|cid|data:image\/|tel):|[^a-z]|^[a-z]+(?!script))/i,
}

export function sanitizeEmailHtml(html: unknown): string {
  if (typeof html !== 'string' || html.length === 0) return ''
  return getPurify().sanitize(html, SANITIZE_CONFIG)
}

export function __resetPurifyForTest(): void { purifyInstance = null }
