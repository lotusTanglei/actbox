// src/__tests__/security/sanitize.test.ts
import { describe, it, expect, afterEach } from 'vitest'
import { sanitizeEmailHtml, __resetPurifyForTest } from '@/lib/security/sanitize'

const stillHas = (out: string, needle: string) => out.toLowerCase().includes(needle.toLowerCase())

describe('sanitizeEmailHtml — XSS', () => {
  afterEach(() => { __resetPurifyForTest() })

  it('剥离 <script>', () => {
    expect(sanitizeEmailHtml('<p>hi</p><script>alert(1)</script>')).toBe('<p>hi</p>')
    expect(stillHas(sanitizeEmailHtml('<script>alert(document.cookie)</script>'), 'script')).toBe(false)
  })
  it('剥离 <img onerror>', () => {
    const out = sanitizeEmailHtml('<img src=x onerror="alert(1)">')
    expect(stillHas(out, 'onerror')).toBe(false)
  })
  it('剥离 <svg onload>', () => {
    expect(stillHas(sanitizeEmailHtml('<svg onload=alert(1)>'), 'onload')).toBe(false)
  })
  it('剥离 <iframe>', () => {
    expect(stillHas(sanitizeEmailHtml('<iframe src="javascript:alert(1)"></iframe>'), 'iframe')).toBe(false)
  })
  it('剥离 javascript: 链接', () => {
    expect(stillHas(sanitizeEmailHtml('<a href="javascript:alert(1)">click</a>'), 'javascript:')).toBe(false)
  })
  it('保留合法 <a href="https://...">', () => {
    const out = sanitizeEmailHtml('<a href="https://example.com">link</a>')
    expect(out).toContain('href="https://example.com"')
  })
  it('剥离 vbscript:', () => {
    expect(stillHas(sanitizeEmailHtml('<a href="vbscript:msgbox(1)">x</a>'), 'vbscript:')).toBe(false)
  })
  it('剥离 <object>/<embed>', () => {
    expect(stillHas(sanitizeEmailHtml('<object data="evil.swf"></object>'), 'object')).toBe(false)
    expect(stillHas(sanitizeEmailHtml('<embed src="evil.swf">'), 'embed')).toBe(false)
  })
  it('剥离 <form>/<base>', () => {
    expect(stillHas(sanitizeEmailHtml('<form action="http://evil"><input name=pw></form>'), 'form')).toBe(false)
    expect(stillHas(sanitizeEmailHtml('<base href="http://evil/">'), 'base')).toBe(false)
  })
  it('剥离 style 中 expression()', () => {
    expect(stillHas(sanitizeEmailHtml('<div style="background:url(javascript:alert(1))">x</div>'), 'javascript:')).toBe(false)
  })
  it('保留正常 inline style', () => {
    expect(sanitizeEmailHtml('<p style="color:red;font-weight:bold">x</p>')).toContain('color')
  })
  it('混合攻击向量', () => {
    const out = sanitizeEmailHtml('<p>Hello</p><img src=x onerror=alert(1)><script>steal()</script>')
    expect(out).toContain('Hello')
    expect(stillHas(out, 'onerror')).toBe(false)
    expect(stillHas(out, 'script')).toBe(false)
  })
  it('HTML 实体编码 javascript:', () => {
    expect(stillHas(sanitizeEmailHtml('<a href="&#106;avascript:alert(1)">x</a>'), 'javascript:')).toBe(false)
  })
  it('嵌套构造 <scr<script>ipt>', () => {
    expect(stillHas(sanitizeEmailHtml('<scr<script>ipt>alert(1)</script>'), '<script')).toBe(false)
  })
  it('空/非字符串 → 空串', () => {
    expect(sanitizeEmailHtml('')).toBe('')
    expect(sanitizeEmailHtml(null as any)).toBe('')
  })
  it('纯文本不变', () => {
    expect(sanitizeEmailHtml('Just plain text body.')).toBe('Just plain text body.')
  })
  it('保留邮件常见标签', () => {
    const out = sanitizeEmailHtml('<table><tr><td>A</td></tr></table><ul><li>1</li></ul><strong>bold</strong><img src="cid:inline">')
    expect(out).toContain('<table>')
    expect(out).toContain('<strong>bold</strong>')
    expect(stillHas(out, 'onerror')).toBe(false)
  })
  it('data:image 图片放行, data:text/html 链接禁用', () => {
    expect(sanitizeEmailHtml('<img src="data:image/png;base64,AAA">')).toContain('data:image/png')
    expect(stillHas(sanitizeEmailHtml('<a href="data:text/html,<script>alert(1)</script>">x</a>'), 'data:text/html')).toBe(false)
  })
})
