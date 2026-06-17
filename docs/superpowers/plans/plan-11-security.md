# 子项目 11 — 安全(收敛版)Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: 用 superpowers:subagent-driven-development（concurrency=1，串行）或 executing-plans 逐任务实现。步骤用 `- [ ]` 勾选跟踪。

**Goal:** 给本地单用户的 webmail 补齐收敛版必要安全：收件 HTML 经 DOMPurify 净化防 XSS、轻量垃圾邮件评分过滤(自动隔离到垃圾箱 + 标记/取消/反馈训练)、钓鱼/恶意链接警告 + SPF/DKIM/DMARC 头校验标识、组织外部发件人显式标识、附件接收侧可插拔病毒扫描钩子。

**Architecture:** 方案 B（详见 spec §0/§2.4/子项目 11/NFR/风险登记册）。本地单机、单进程、单 SQLite(WAL)、**单用户**——明确不做多用户 auth/2FA/远程会话/多设备登录态（见 Out of scope）。安全分层为四个**纯函数模块 + 一个钩子接口**，全部可脱离 DB/IMAP 单测：

1. **HTML 净化（防 XSS）**：`sanitizeEmailHtml(html): string` 用 DOMPurify（jsdom 提供 window）剥离 `<script>`/危险事件属性（`onerror`/`onclick`…）/`javascript:` URL/`<iframe>`/`<object>`/`<embed>` 等攻击面。净化在**两处**接入：① 入库时（同步流水线 `db.insert(messages)` 前对 `body_html` 净化存净版，spec §2.4 要求渲染前净化，入库即净化保证「哪怕绕过 UI 直查库也安全」）② 渲染兜底（`EmailBody.tsx` 的 iframe `srcDoc` 入口再过一遍 `sanitizeEmailHtml`，纵深防御）；并把 iframe 的 `sandbox` 收紧为不含 `allow-scripts`（现状 `allow-same-origin` 单独本就安全，但显式化不依赖 sandbox 唯一防线）。净化纯函数返回处理后的 HTML 字符串，不改原库行结构。
2. **垃圾评分**：`scoreSpam(ctx): SpamVerdict` 是纯函数——给一个由邮件元数据（from/subject/body/headers/有无附件）组成的 `SpamContext`，按 SpamAssassin 规则子集（FREE/PRIZE/大写主题/可疑词/`Content-Type` 异常/RDNS 未通过等）累加分数，返回 `{ score, isSpam, reasons }`；阈值可配（默认 5.0 命中）。同步流水线入库后调 `scoreSpam`，命中则经子项目 3 的 `applyAction` 移到 `Spam` 文件夹（type=spam）+ 置 `is_spam=1`。垃圾箱视图复用 plan-03 folders 体系；标记/取消垃圾/举报反馈训练调垃圾规则权重。
3. **钓鱼/认证头**：`parseAuthHeaders(headers): AuthResult` 解析 `Authentication-Results` / `Received` / `DKIM-Signature` 头，输出 `{ spf, dkim, dmarc }` 各为 `pass|fail|none|softfail` + 原文片段；`isPhishing(links)` 用纯函数扫链接（`<a href>` 是否含 IP/可疑 Punycode/同形异义域名/与显示文本不一致）。结果写入 messages 本地列 `auth_result`(JSON) 并在详情页显示徽标（pass 绿 / fail 红 / none 灰）；可疑链接点击前警告。
4. **外部发件人标识**：`isExternalSender(from, accountEmail): boolean` 纯函数比对域名，外部域邮件详情页显式横幅「⚠️ 这是一封来自组织外部的邮件」防社工。
5. **附件扫描钩子**：`AttachmentScanner` 接口（`scan(file): ScanResult`）可插拔；本地默认实现 `noopScanner`（不接真实 AV，返回 clean）。子项目 4 附件落盘后调钩子，`malicious` 则隔离（移 `Quarantine` + 标记）并记日志——预留接口供后续接 ClamAV/Clamd。

**Tech Stack:** Next.js 16 / React 19 / TypeScript / DOMPurify + jsdom / Drizzle ORM + better-sqlite3(WAL) / vitest。

**执行前置：** 在 git worktree 或干净 main 上执行；每任务结束 `git add` + `git commit` + `git push`。本子项目依赖子项目 1（drizzle 迁移框架 + messages `account_id/folder/imap_uid` 列 + **§2.4 已要求 DOMPurify**）、子项目 2（`accounts` 表 + `getAdapter`）、子项目 3（`folders` 表 type=spam + `applyAction` 的 `move` UID 回写 + 还原）、子项目 4（附件落盘链路——扫描钩子挂在落盘后）。阶段 3 执行——每任务先写失败测试再实现（TDD 先红后绿）。route handler 测试对 `getDb()` 的注入约定参考 plan-08 messages-batch.test.ts（本计划用 `vi.mock('@/lib/db')` 注入内存库）。

---

## 文件结构

- Create: `src/lib/security/sanitize.ts` — `sanitizeEmailHtml` 纯函数（DOMPurify）+ DOMPurify 实例工厂（Task 1）
- Create: `src/lib/security/spam.ts` — `scoreSpam` 纯函数 + SpamAssassin 规则子集（Task 3）
- Create: `src/lib/security/auth-headers.ts` — `parseAuthHeaders`(SPF/DKIM/DMARC) + `isPhishing`/`extractLinks` 纯函数（Task 4）
- Create: `src/lib/security/external.ts` — `isExternalSender` 纯函数（Task 5）
- Create: `src/lib/security/scanner.ts` — `AttachmentScanner` 接口 + `noopScanner` + 注册表（Task 6）
- Create: `src/lib/security/spam-repo.ts` — 标记/取消垃圾 + 举报反馈训练 + 白名单学习（Task 8）
- Create: `src/lib/security/pipeline.ts` — `applySecurityToIngestedMessage` 流水线入口（净化已入库存量列；评分→隔离；认证头解析；外部标识；Task 7）
- Modify: `src/lib/db/schema.ts` — messages 增 `is_spam`/`auth_result`/`is_external`/`spam_reasons` 列（Task 2）
- Modify: `src/lib/adapter/mail/receiver.ts`、`src/lib/scheduler/index.ts`、`src/app/api/fetch/route.ts` — 入库净化 + 接 pipeline（Task 7 Step 5）
- Modify: `src/components/EmailBody.tsx` — iframe srcDoc 再净化 + sandbox 收紧（Task 1 Step 5）
- Create: `src/app/api/messages/[id]/spam/route.ts` — POST 标记/取消垃圾 + 举报训练（Task 9）
- Create: `src/app/api/messages/[id]/links/route.ts` — GET 可疑链接扫描结果（Task 9）
- Modify: `src/app/mails/[id]/page.tsx` — 认证徽标 + 外部横幅 + 钓鱼链接警告（Task 10）
- Modify: `src/app/mails/page.tsx`（或 plan-03 folders 视图）— 垃圾箱视图 + 还原入口（Task 11）
- Test: `src/__tests__/security/sanitize.test.ts`、`src/__tests__/security/spam.test.ts`、`src/__tests__/security/auth-headers.test.ts`、`src/__tests__/security/external.test.ts`、`src/__tests__/security/scanner.test.ts`、`src/__tests__/security/pipeline.test.ts`、`src/__tests__/security/spam-repo.test.ts`、`src/__tests__/api/messages-spam.test.ts`、`src/__tests__/api/messages-links.test.ts`、`src/__tests__/db/migration.test.ts`（补 messages 新列）
- Create: `src/__tests__/helpers/memDb.ts` — 内存 better-sqlite3 + 建全列表（若 plan-08 已建则复用）

---

## 任务

### Task 1: sanitizeEmailHtml 纯函数（DOMPurify 防 XSS）

**Files:**
- Create: `src/lib/security/sanitize.ts`
- Create: `src/__tests__/security/sanitize.test.ts`
- Modify: `src/components/EmailBody.tsx`

**关键设计：** DOMPurify 需要 `window` 对象——Node 侧用 `jsdom` 的 `JSDOM` 构造 `window`，惰性创建一次复用（启动开销大）。`sanitizeEmailHtml` 是纯函数：入参 HTML 字符串，出参净化后 HTML 字符串，无副作用、不碰 DB/网络。配置：禁用全部 on* 事件属性、`<script>`、`<iframe>`、`<object>`、`<embed>`、`<form>`、`<base>`、`javascript:`/`data:`（图片 data: 可放行，链接 data: 禁）、`vbscript:`；放行白名单标签（a/p/br/img/table/ul/ol/li/span/div/h1-6/strong/em/blockquote/pre/hr）+ 样式属性。空/非字符串输入返回空串。**iframe sandbox 收紧**：当前 `sandbox="allow-same-origin"` 缺 `allow-scripts`（脚本本不能跑），但显式化不依赖它作唯一防线——保留 `allow-same-origin`（iframe 自适应高度需要读 contentDocument），同时 srcDoc 再净化，纵深防御。

- [ ] **Step 1: 装依赖** `npm install dompurify jsdom && npm install -D @types/dompurify`

- [ ] **Step 2: 写失败测试（XSS 攻击向量表）**

```ts
import { describe, it, expect } from 'vitest'
import { sanitizeEmailHtml } from '@/lib/security/sanitize'

describe('sanitizeEmailHtml — XSS 攻击向量净化', () => {
  // 工具:提取净化后是否仍含危险串
  const stillHas = (out: string, needle: string) => out.toLowerCase().includes(needle.toLowerCase())

  it('剥离 <script> 块与内联脚本', () => {
    expect(sanitizeEmailHtml('<p>hi</p><script>alert(1)</script>')).toBe('<p>hi</p>')
    expect(stillHas(sanitizeEmailHtml('<script>alert(document.cookie)</script>'), 'script')).toBe(false)
  })
  it('剥离 <img onerror>', () => {
    const out = sanitizeEmailHtml('<img src=x onerror="alert(1)">')
    expect(stillHas(out, 'onerror')).toBe(false)
    expect(stillHas(out, 'alert')).toBe(false)
  })
  it('剥离 <svg onload>', () => {
    const out = sanitizeEmailHtml('<svg onload=alert(1)>')
    expect(stillHas(out, 'onload')).toBe(false)
  })
  it('剥离 <iframe> 嵌入', () => {
    const out = sanitizeEmailHtml('<iframe src="javascript:alert(1)"></iframe>')
    expect(stillHas(out, 'iframe')).toBe(false)
  })
  it('剥离 javascript: 链接', () => {
    const out = sanitizeEmailHtml('<a href="javascript:alert(1)">click</a>')
    expect(stillHas(out, 'javascript:')).toBe(false)
  })
  it('保留合法 <a href="https://...">', () => {
    const out = sanitizeEmailHtml('<a href="https://example.com">link</a>')
    expect(out).toContain('href="https://example.com"')
    expect(out).toContain('link</a>')
  })
  it('剥离 vbscript: 链接', () => {
    expect(stillHas(sanitizeEmailHtml('<a href="vbscript:msgbox(1)">x</a>'), 'vbscript:')).toBe(false)
  })
  it('剥离 <object data=>/<embed>', () => {
    expect(stillHas(sanitizeEmailHtml('<object data="evil.swf"></object>'), 'object')).toBe(false)
    expect(stillHas(sanitizeEmailHtml('<embed src="evil.swf">'), 'embed')).toBe(false)
  })
  it('剥离 <form>/<base>', () => {
    expect(stillHas(sanitizeEmailHtml('<form action="http://evil"><input name=pw></form>'), 'form')).toBe(false)
    expect(stillHas(sanitizeEmailHtml('<base href="http://evil/">'), 'base')).toBe(false)
  })
  it('剥离内联 style 中的 expression()/url(javascript:)', () => {
    const out = sanitizeEmailHtml('<div style="background:url(javascript:alert(1))">x</div>')
    expect(stillHas(out, 'javascript:')).toBe(false)
    expect(stillHas(out, 'expression(')).toBe(false)
  })
  it('保留正常 inline style（color/font-weight）', () => {
    const out = sanitizeEmailHtml('<p style="color:red;font-weight:bold">x</p>')
    expect(out).toContain('color')
  })
  it('混合攻击向量(<img src=x onerror> + <script>)', () => {
    const html = '<p>Hello</p><img src=x onerror=alert(1)><script>steal()</script>'
    const out = sanitizeEmailHtml(html)
    expect(out).toContain('Hello')
    expect(stillHas(out, 'onerror')).toBe(false)
    expect(stillHas(out, 'script')).toBe(false)
  })
  it('HTML 实体编码的 javascript: 仍被识别', () => {
    // &#106;avascript: = javascript: — DOMPurify 解实体后判断
    expect(stillHas(sanitizeEmailHtml('<a href="&#106;avascript:alert(1)">x</a>'), 'javascript:')).toBe(false)
  })
  it('嵌套构造 <scr<script>ipt>', () => {
    const out = sanitizeEmailHtml('<scr<script>ipt>alert(1)</script>')
    expect(stillHas(out, '<script')).toBe(false)
  })
  it('空/非字符串输入返回空串', () => {
    expect(sanitizeEmailHtml('')).toBe('')
    expect(sanitizeEmailHtml(null as any)).toBe('')
    expect(sanitizeEmailHtml(undefined as any)).toBe('')
  })
  it('纯文本邮件不变(无标签)', () => {
    expect(sanitizeEmailHtml('Just plain text body.')).toBe('Just plain text body.')
  })
  it('保留邮件常见标签(table/img/ul/strong)', () => {
    const html = '<table><tr><td>A</td></tr></table><ul><li>1</li></ul><strong>bold</strong><img src="cid:inline">'
    const out = sanitizeEmailHtml(html)
    expect(out).toContain('<table>')
    expect(out).toContain('<ul>')
    expect(out).toContain('<strong>bold</strong>')
    expect(out).toContain('<img')
    expect(stillHas(out, 'onerror')).toBe(false)
  })
  it('data: URL 图片放行, data: 链接禁用', () => {
    expect(sanitizeEmailHtml('<img src="data:image/png;base64,AAA">')).toContain('data:image/png')
    expect(stillHas(sanitizeEmailHtml('<a href="data:text/html,<script>alert(1)</script>">x</a>'), 'data:text/html')).toBe(false)
  })
})
```

- [ ] **Step 3: 运行确认失败**：`npx vitest run src/__tests__/security/sanitize.test.ts` → FAIL（模块不存在）。

- [ ] **Step 4: 实现**

```ts
// src/lib/security/sanitize.ts
import DOMPurify from 'dompurify'
import { JSDOM } from 'jsdom'

// 惰性单例:jsdom 启动开销大,进程内只建一次
let purifyInstance: DOMPurify.DOMPurifyI | null = null
function getPurify(): DOMPurify.DOMPurifyI {
  if (purifyInstance) return purifyInstance
  const dom = new JSDOM('', { url: 'http://localhost/' })
  const purify = DOMPurify(dom.window as any)
  // 全局钩子:二次保险,禁掉任何残留 javascript:/vbscript: 协议与 expression()
  purify.addHook('afterSanitizeAttributes', (node: any) => {
    if (node.tagName === 'A' || node.tagName === 'AREA') {
      const href = (node.getAttribute('href') || '').trim().toLowerCase()
      if (href.startsWith('javascript:') || href.startsWith('vbscript:') || href.startsWith('data:text/html')) {
        node.removeAttribute('href')
      }
    }
    // 剥离所有 on* 事件属性(DOMPurify 默认已剥,显式兜底)
    for (const attr of Array.from(node.attributes || [])) {
      if (/^on/i.test(attr.name)) node.removeAttribute(attr.name)
    }
    // style 里的 expression()/javascript:
    const style = node.getAttribute('style')
    if (style && /(expression\s*\(|javascript:|vbscript:)/i.test(style)) {
      node.removeAttribute('style')
    }
  })
  purifyInstance = purify
  return purify
}

const SANITIZE_CONFIG: DOMPurify.Config = {
  ALLOWED_TAGS: [
    'a', 'p', 'br', 'img', 'table', 'thead', 'tbody', 'tr', 'td', 'th',
    'ul', 'ol', 'li', 'span', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'strong', 'em', 'b', 'i', 'u', 'blockquote', 'pre', 'hr', 'font', 'center',
    'colgroup', 'col', 'caption', 'sub', 'sup', 'dl', 'dt', 'dd',
  ],
  ALLOWED_ATTR: ['href', 'src', 'alt', 'title', 'width', 'height', 'style', 'align',
    'valign', 'bgcolor', 'color', 'colspan', 'rowspan', 'target', 'rel', 'class', 'id', 'cid'],
  // data: 图片放行(邮件内联截图),其余 data: 由 afterSanitizeAttributes 钩子拦截
  ALLOW_DATA_ATTR: false,
  FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form', 'base', 'meta', 'link', 'style', 'input', 'button', 'svg'],
  FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover', 'onfocus', 'onblur', 'onchange', 'onsubmit'],
  ALLOWED_URI_REGEXP: /^(?:(?:https?|ftp|mailto|cid|data:image\/|tel):|[^a-z]|^[a-z]+(?!script))/i,
}

/**
 * 净化收件 HTML 防 XSS。纯函数:入 HTML 字符串,出净化后 HTML 字符串。
 * 非字符串/空 → 空串。入库前与渲染前两处接入(纵深防御)。
 */
export function sanitizeEmailHtml(html: unknown): string {
  if (typeof html !== 'string' || html.length === 0) return ''
  return getPurify().sanitize(html, SANITIZE_CONFIG)
}

/** 重新初始化(测试隔离用) */
export function __resetPurifyForTest(): void {
  purifyInstance = null
}
```

- [ ] **Step 5: 运行确认通过** → PASS。

- [ ] **Step 6: 接入 EmailBody.tsx（渲染兜底 + sandbox 显式化）**

```tsx
// src/components/EmailBody.tsx —— 修改 html 分支:
import { sanitizeEmailHtml } from '@/lib/security/sanitize'

// 在 render 内(iframe 分支):
if (html) {
  const safe = sanitizeEmailHtml(html)   // 渲染前再净化(纵深防御,入库已净)
  return (
    <iframe
      ref={iframeRef}
      srcDoc={safe}
      title="邮件正文"
      // 不含 allow-scripts:脚本永远不跑;sandbox 仅作第二道隔离线
      sandbox="allow-same-origin"
      onLoad={handleLoad}
      className="w-full rounded-lg border-0 bg-white"
      style={{ height, colorScheme: 'light' }}
    />
  )
}
```

> 注：`sanitizeEmailHtml` 在浏览器端 EmailBody 调用时也跑 DOMPurify——但 EmailBody 是 `'use client'` 组件，浏览器有原生 `window`，而 `sanitize.ts` import 了 `jsdom`（仅 Node 侧）。**解决**：把 jsdom 初始化包进 `try/catch`/`typeof window` 分支——若已有全局 `window`（浏览器）直接用，否则用 jsdom。更新 `getPurify`：

```ts
function getPurify(): DOMPurify.DOMPurifyI {
  if (purifyInstance) return purifyInstance
  const w: any = (typeof window !== 'undefined' && window) ? window : (new JSDOM('', { url: 'http://localhost/' }).window)
  const purify = DOMPurify(w)
  // ...addHook 同上
  purifyInstance = purify
  return purify
}
```

  并确保 jsdom 仅在服务端被 `require`（Next 不会把服务端 jsdom 打进 client bundle，因 DOMPurify 按需引用）。手测：渲染一封含 `<script>` 的邮件确认不弹窗、正文正常。

- [ ] **Step 7: Commit**

```bash
git add src/lib/security/sanitize.ts src/__tests__/security/sanitize.test.ts src/components/EmailBody.tsx package.json package-lock.json
git commit -m "feat(security): DOMPurify email HTML sanitization (XSS) + iframe render guard"
git push
```

---

### Task 2: messages 增安全列（is_spam / auth_result / is_external / spam_reasons）

**Files:**
- Modify: `src/lib/db/schema.ts`
- Test: `src/__tests__/db/migration.test.ts`

- [ ] **Step 1: 在 schema.ts messages 表增列**

```ts
// 追加到 messages 表定义(全部 nullable 带 DEFAULT,存量行不破坏):
isSpam: integer('is_spam', { mode: 'boolean' }).notNull().default(false),
authResult: text('auth_result'),              // JSON: { spf, dkim, dmarc } 各 pass|fail|none|softfail
isExternal: integer('is_external', { mode: 'boolean' }).notNull().default(false),
spamReasons: text('spam_reasons'),            // JSON: string[] 命中规则
spamScore: real('spam_score').notNull().default(0),
```

> 若 messages 表用 drizzle `sqliteTable` 且 drizzle-kit 已就绪（plan-01），则 `npm run db:generate` 产出 ALTER 迁移；存量库由 plan-01 的 align-baseline 补列。

- [ ] **Step 2: 生成迁移** `npm run db:generate`。

- [ ] **Step 3: 补 migration 测试**：在 `src/__tests__/db/migration.test.ts` 加断言 `PRAGMA table_info(messages)` 含 `is_spam`/`auth_result`/`is_external`/`spam_reasons`/`spam_score` 列。`npx vitest run src/__tests__/db/migration.test.ts` → PASS。

- [ ] **Step 4: Commit**

```bash
git add src/lib/db/schema.ts drizzle/ src/__tests__/db/migration.test.ts
git commit -m "feat(db): messages security columns (is_spam/auth_result/is_external/spam_reasons/score)"
git push
```

---

### Task 3: scoreSpam 纯函数（垃圾邮件评分，SpamAssassin 规则子集）

**Files:**
- Create: `src/lib/security/spam.ts`
- Create: `src/__tests__/security/spam.test.ts`

**关键设计：** `scoreSpam(ctx: SpamContext): SpamVerdict` 纯函数。`SpamContext` 只含可序列化的邮件特征（不依赖 DOM/DB）。规则表是 `Rule[]`，每条 `{ id, score, test(ctx) }`，逐条求和，命中规则 id 记进 `reasons`。阈值 `SPAM_THRESHOLD`（默认 5.0，可经 settings 调）。规则子集（参考 SpamAssassin 常见规则，本地可跑）：
- `SUBJ_ALL_CAPS`（主题全大写且长度>5）+2.0
- `FREE_WORD`（主题/正文含「免费/中奖/中奖通知/free/prize/lottery/viagra/casino」）+2.5
- `URGENCY_WORDS`（「立即点击/限时/act now/urgent/click here now」）+1.5
- `RDNS_NONE`（headers `Received` 里无完整反向域名 / 无 `from` 域名）+1.2
- `FROM_LOCALPART_NUMERIC`（发件人 local-part 纯数字）+1.0
- `MISSING_DATE` / `MISSING_MESSAGE_ID` 各 +1.0
- `HTML_FORM`（含 `<form`）+2.0
- `HTML_SHORT_LEN`（HTML body 极短 + 有链接，典型钓鱼）+1.5
- `SUBJ_HAS_EXCESS_MARK`（主题连续 !!!/??? 多个）+1.0
- `HIGH_SPAM_KEYWORDS_BUNDLE`（同时命中 ≥3 个垃圾词）+3.0
返回 `{ score, isSpam: score >= threshold, reasons, threshold }`。

- [ ] **Step 1: 写失败测试**

```ts
import { describe, it, expect } from 'vitest'
import { scoreSpam } from '@/lib/security/spam'
import type { SpamContext } from '@/lib/security/spam'

const ctx = (over: Partial<SpamContext> = {}): SpamContext => ({
  from: 'friend@example.com',
  subject: 'Hello',
  bodyText: 'How are you?',
  bodyHtml: '<p>How are you?</p>',
  date: new Date('2026-06-01').toISOString(),
  messageId: '<abc@example.com>',
  hasAttachment: false,
  receivedHeader: 'from mail.example.com (mail.example.com [1.2.3.4])',
  ...over,
})

describe('scoreSpam', () => {
  it('正常邮件:低分(0–2)不判垃圾', () => {
    const v = scoreSpam(ctx())
    expect(v.isSpam).toBe(false)
    expect(v.score).toBeLessThan(5)
  })
  it('SUBJ_ALL_CAPS + FREE_WORD 命中', () => {
    const v = scoreSpam(ctx({ subject: 'FREE VIAGRA NOW' }))
    expect(v.isSpam).toBe(true)
    expect(v.reasons).toContain('FREE_WORD')
    expect(v.reasons).toContain('SUBJ_ALL_CAPS')
  })
  it('主题全大写但短(<6)不触发 SUBJ_ALL_CAPS', () => {
    const v = scoreSpam(ctx({ subject: 'HI' }))
    expect(v.reasons).not.toContain('SUBJ_ALL_CAPS')
  })
  it('中文免费/中奖词命中', () => {
    const v = scoreSpam(ctx({ subject: '恭喜中奖通知', bodyText: '免费领取' }))
    expect(v.reasons).toContain('FREE_WORD')
    expect(v.isSpam).toBe(true)
  })
  it('URGENCY_WORDS 命中', () => {
    const v = scoreSpam(ctx({ bodyText: '请立即点击确认 act now' }))
    expect(v.reasons).toContain('URGENCY_WORDS')
  })
  it('RDNS_NONE:Received 头缺域名', () => {
    const v = scoreSpam(ctx({ receivedHeader: 'from [1.2.3.4]' }))
    expect(v.reasons).toContain('RDNS_NONE')
  })
  it('FROM_LOCALPART_NUMERIC', () => {
    const v = scoreSpam(ctx({ from: '12345678@suspicious.tk' }))
    expect(v.reasons).toContain('FROM_LOCALPART_NUMERIC')
  })
  it('MISSING_DATE / MISSING_MESSAGE_ID', () => {
    const v = scoreSpam(ctx({ date: null as any, messageId: null as any }))
    expect(v.reasons).toContain('MISSING_DATE')
    expect(v.reasons).toContain('MISSING_MESSAGE_ID')
  })
  it('HTML_FORM 命中(钓鱼表单)', () => {
    const v = scoreSpam(ctx({ bodyHtml: '<form action="http://x">密码</form>' }))
    expect(v.reasons).toContain('HTML_FORM')
  })
  it('SUBJ_HAS_EXCESS_MARK(连续!!!)', () => {
    const v = scoreSpam(ctx({ subject: 'Win money!!!' }))
    expect(v.reasons).toContain('SUBJ_HAS_EXCESS_MARK')
  })
  it('阈值可配(自定义 threshold)', () => {
    const v = scoreSpam(ctx({ subject: 'FREE' }), { threshold: 10 })
    expect(v.score).toBeGreaterThanOrEqual(2.5)
    expect(v.isSpam).toBe(false) // 提高阈值后不判
  })
  it('返回 score/reasons/isSpam/threshold 完整结构', () => {
    const v = scoreSpam(ctx())
    expect(v).toHaveProperty('score')
    expect(v).toHaveProperty('isSpam')
    expect(v).toHaveProperty('reasons')
    expect(Array.isArray(v.reasons)).toBe(true)
    expect(v).toHaveProperty('threshold')
  })
})
```

- [ ] **Step 2: 运行确认失败** → FAIL。

- [ ] **Step 3: 实现**

```ts
// src/lib/security/spam.ts
export interface SpamContext {
  from: string
  subject: string
  bodyText: string
  bodyHtml: string
  date: string | null
  messageId: string | null
  hasAttachment: boolean
  /** 原始 Received 头(取第一条 hop) */
  receivedHeader?: string
}

export interface SpamVerdict {
  score: number
  isSpam: boolean
  reasons: string[]
  threshold: number
}

export const DEFAULT_SPAM_THRESHOLD = 5.0

interface Rule {
  id: string
  score: number
  test: (ctx: SpamContext) => boolean
}

const FREE_WORDS = ['免费', '中奖', '中奖通知', '领取', 'free', 'prize', 'lottery', 'viagra', 'casino', '彩票', '代开发票']
const URGENCY_WORDS = ['立即点击', '限时', '马上', 'act now', 'urgent', 'click here now', 'verify now', 'suspended']

const RULES: Rule[] = [
  { id: 'SUBJ_ALL_CAPS', score: 2.0, test: (c) => {
    const s = (c.subject || '').trim()
    return s.length > 5 && s === s.toUpperCase() && /[A-Z]/.test(s) && !/[一-龥]/.test(s)
  }},
  { id: 'FREE_WORD', score: 2.5, test: (c) => {
    const hay = `${c.subject} ${c.bodyText} ${c.bodyHtml}`.toLowerCase()
    return FREE_WORDS.some((w) => hay.includes(w.toLowerCase()))
  }},
  { id: 'URGENCY_WORDS', score: 1.5, test: (c) => {
    const hay = `${c.subject} ${c.bodyText}`.toLowerCase()
    return URGENCY_WORDS.some((w) => hay.includes(w.toLowerCase()))
  }},
  { id: 'RDNS_NONE', score: 1.2, test: (c) => {
    const h = c.receivedHeader || ''
    // 无完整反向域名(只有 IP 或空)视为可疑
    return h.length === 0 || (!/[a-z0-9-]+\.[a-z]{2,}/i.test(h) && /\d+\.\d+\.\d+\.\d+/.test(h))
  }},
  { id: 'FROM_LOCALPART_NUMERIC', score: 1.0, test: (c) => {
    const m = (c.from || '').match(/^<?([^\s@<>]+)@/)
    return !!m && /^\d+$/.test(m[1])
  }},
  { id: 'MISSING_DATE', score: 1.0, test: (c) => !c.date },
  { id: 'MISSING_MESSAGE_ID', score: 1.0, test: (c) => !c.messageId },
  { id: 'HTML_FORM', score: 2.0, test: (c) => /<form\b/i.test(c.bodyHtml || '') },
  { id: 'HTML_SHORT_LEN', score: 1.5, test: (c) => {
    const bh = (c.bodyHtml || '').replace(/<[^>]+>/g, '').trim()
    return bh.length < 50 && /<a\s/i.test(c.bodyHtml || '')
  }},
  { id: 'SUBJ_HAS_EXCESS_MARK', score: 1.0, test: (c) => /[!?]{3,}/.test(c.subject || '') },
  { id: 'HIGH_SPAM_KEYWORDS_BUNDLE', score: 3.0, test: (c) => {
    const hay = `${c.subject} ${c.bodyText}`.toLowerCase()
    return FREE_WORDS.filter((w) => hay.includes(w.toLowerCase())).length >= 3
  }},
]

/**
 * 垃圾邮件评分。纯函数,无副作用。命中规则累加分数,超阈值即判垃圾。
 */
export function scoreSpam(ctx: SpamContext, opts: { threshold?: number } = {}): SpamVerdict {
  const threshold = opts.threshold ?? DEFAULT_SPAM_THRESHOLD
  let score = 0
  const reasons: string[] = []
  for (const r of RULES) {
    try {
      if (r.test(ctx)) {
        score += r.score
        reasons.push(r.id)
      }
    } catch {
      // 单条规则异常不影响整体评分
    }
  }
  return { score, isSpam: score >= threshold, reasons, threshold }
}
```

- [ ] **Step 4: 运行确认通过** → PASS。

- [ ] **Step 5: Commit**

```bash
git add src/lib/security/spam.ts src/__tests__/security/spam.test.ts
git commit -m "feat(security): spam scoring (SpamAssassin rule subset) pure function"
git push
```

---

### Task 4: parseAuthHeaders（SPF/DKIM/DMARC）+ isPhishing 链接扫描

**Files:**
- Create: `src/lib/security/auth-headers.ts`
- Create: `src/__tests__/security/auth-headers.test.ts`

**关键设计：**
- `parseAuthHeaders(headers: Record<string,string>): AuthResult` 纯函数。优先解析 `Authentication-Results` 头（服务商已聚合 SPF/DKIM/DMARC），正则抽 `spf=pass|fail|softfail|none`、`dkim=...`、`dmarc=...`；无该头则退化为从 `Received` 头估 SPF（有无 `from` 域名）。返回 `{ spf, dkim, dmarc, raw }`，每项为 `'pass'|'fail'|'softfail'|'none'`。
- `extractLinks(html): LinkInfo[]` 从 bodyHtml 抽所有 `<a href>` + 显示文本。
- `isPhishing(links: LinkInfo[]): PhishingWarning[]` 纯函数检测：① href 是裸 IP（`http://1.2.3.4`）② href 用 Punycode `xn--`（可疑同形域名）③ href 域名与显示文本域名不一致（文本写 `google.com` 实链 `evil.com`）④ href 用 IP 或短链。返回警告清单（link + reason）。

- [ ] **Step 1: 写失败测试**

```ts
import { describe, it, expect } from 'vitest'
import { parseAuthHeaders, extractLinks, isPhishing } from '@/lib/security/auth-headers'

describe('parseAuthHeaders', () => {
  it('解析 Authentication-Results: 全 pass', () => {
    const h = { 'authentication-results': 'mx.google.com; spf=pass (domain: x.com) dkim=pass dmarc=pass' }
    const r = parseAuthHeaders(h)
    expect(r.spf).toBe('pass')
    expect(r.dkim).toBe('pass')
    expect(r.dmarc).toBe('pass')
  })
  it('spf=fail / dkim=fail / dmarc=fail', () => {
    const h = { 'authentication-results': 'spf=fail dkim=fail header.i=@evil dmarc=fail' }
    const r = parseAuthHeaders(h)
    expect(r.spf).toBe('fail')
    expect(r.dkim).toBe('fail')
    expect(r.dmarc).toBe('fail')
  })
  it('softfail', () => {
    const r = parseAuthHeaders({ 'authentication-results': 'spf=softfail dkim=none dmarc=none' })
    expect(r.spf).toBe('softfail')
    expect(r.dkim).toBe('none')
    expect(r.dmarc).toBe('none')
  })
  it('无 Authentication-Results → 全 none', () => {
    const r = parseAuthHeaders({ received: 'from x' })
    expect(r.spf).toBe('none')
    expect(r.dkim).toBe('none')
    expect(r.dmarc).toBe('none')
  })
  it('含 raw 原文片段', () => {
    const r = parseAuthHeaders({ 'authentication-results': 'spf=pass dkim=pass' })
    expect(typeof r.raw).toBe('string')
    expect(r.raw).toContain('spf=pass')
  })
})

describe('extractLinks + isPhishing', () => {
  it('extractLinks 抽 href + 文本', () => {
    const links = extractLinks('<a href="https://example.com">click</a>')
    expect(links).toHaveLength(1)
    expect(links[0].href).toBe('https://example.com')
    expect(links[0].text).toBe('click')
  })
  it('裸 IP 链接警告', () => {
    const w = isPhishing(extractLinks('<a href="http://1.2.3.4/login">bank</a>'))
    expect(w.some((x) => x.reason === 'BARE_IP')).toBe(true)
  })
  it('Punycode(xn--) 警告', () => {
    const w = isPhishing(extractLinks('<a href="http://xn--google-foo.com">google</a>'))
    expect(w.some((x) => x.reason === 'PUNYCODE')).toBe(true)
  })
  it('显示文本域名与实际 href 不一致 警告', () => {
    const html = '<a href="http://evil.com">https://google.com</a>'
    const w = isPhishing(extractLinks(html))
    expect(w.some((x) => x.reason === 'MISMATCHED_URL')).toBe(true)
  })
  it('正常链接无警告', () => {
    const w = isPhishing(extractLinks('<a href="https://example.com/path">example.com</a>'))
    expect(w).toHaveLength(0)
  })
  it('无链接 → 空数组', () => {
    expect(isPhishing(extractLinks('<p>no links</p>'))).toEqual([])
  })
})
```

- [ ] **Step 2: 运行确认失败** → FAIL。

- [ ] **Step 3: 实现**

```ts
// src/lib/security/auth-headers.ts
export type AuthStatus = 'pass' | 'fail' | 'softfail' | 'none'

export interface AuthResult {
  spf: AuthStatus
  dkim: AuthStatus
  dmarc: AuthStatus
  raw: string
}

export interface LinkInfo {
  href: string
  text: string
}

export interface PhishingWarning {
  href: string
  reason: 'BARE_IP' | 'PUNYCODE' | 'MISMATCHED_URL' | 'SHORT_LINK'
}

function lookup(value: unknown, headers: Record<string, string>, key: string): AuthStatus {
  const v = headers['authentication-results'] || headers['Authentication-Results'] || ''
  const re = new RegExp(`${key}\\s*=\\s*(pass|fail|softfail|none|temperror|permerror|neutral)`, 'i')
  const m = v.match(re)
  if (!m) return 'none'
  const s = m[1].toLowerCase()
  if (s === 'pass') return 'pass'
  if (s === 'fail' || s === 'permerror') return 'fail'
  if (s === 'softfail' || s === 'neutral' || s === 'temperror') return 'softfail'
  return 'none'
}

/**
 * 解析 SPF/DKIM/DMARC 认证结果(纯函数)。优先读 Authentication-Results 头。
 */
export function parseAuthHeaders(headers: Record<string, string>): AuthResult {
  const raw = headers['authentication-results'] || headers['Authentication-Results'] || headers['Received-SPF'] || ''
  return {
    spf: lookup(null, headers, 'spf'),
    dkim: lookup(null, headers, 'dkim'),
    dmarc: lookup(null, headers, 'dmarc'),
    raw,
  }
}

/** 从 bodyHtml 抽 <a href> + 显示文本 */
export function extractLinks(html: string): LinkInfo[] {
  if (!html) return []
  const out: LinkInfo[] = []
  const re = /<a\s+[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) !== null) {
    out.push({ href: m[1], text: (m[2] || '').replace(/<[^>]+>/g, '').trim() })
  }
  return out
}

function hostOf(url: string): string {
  try { return new URL(url).hostname.toLowerCase() } catch { return '' }
}

/** 钓鱼/恶意链接扫描(纯函数) */
export function isPhishing(links: LinkInfo[]): PhishingWarning[] {
  const warnings: PhishingWarning[] = []
  for (const l of links) {
    const host = hostOf(l.href)
    if (/\b\d{1,3}(\.\d{1,3}){3}\b/.test(host)) {
      warnings.push({ href: l.href, reason: 'BARE_IP' })
    }
    if (host.includes('xn--')) {
      warnings.push({ href: l.href, reason: 'PUNYCODE' })
    }
    // 显示文本像 URL 但与实际域名不一致
    const textHost = hostOf(l.text.startsWith('http') ? l.text : `http://${l.text}`)
    if (textHost && host && textHost !== host) {
      warnings.push({ href: l.href, reason: 'MISMATCHED_URL' })
    }
    // 短链(无路径的知名短链域)
    if (/bit\.ly|t\.co|tinyurl|goo\.gl/i.test(host)) {
      warnings.push({ href: l.href, reason: 'SHORT_LINK' })
    }
  }
  return warnings
}
```

- [ ] **Step 4: 运行确认通过** → PASS。

- [ ] **Step 5: Commit**

```bash
git add src/lib/security/auth-headers.ts src/__tests__/security/auth-headers.test.ts
git commit -m "feat(security): SPF/DKIM/DMARC auth-header parser + phishing link scanner"
git push
```

---

### Task 5: isExternalSender 纯函数（组织外部发件人标识）

**Files:**
- Create: `src/lib/security/external.ts`
- Create: `src/__tests__/security/external.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
import { describe, it, expect } from 'vitest'
import { isExternalSender, domainOf } from '@/lib/security/external'

describe('isExternalSender', () => {
  it('同域 → 非外部', () => {
    expect(isExternalSender('Alice <alice@company.com>', 'me@company.com')).toBe(false)
  })
  it('不同域 → 外部', () => {
    expect(isExternalSender('spoofer@evil.com', 'me@company.com')).toBe(true)
  })
  it('发件人无域名 → 视为外部(可疑)', () => {
    expect(isExternalSender('nobody', 'me@company.com')).toBe(true)
  })
  it('支持多账号同组织域列表', () => {
    expect(isExternalSender('a@corp.com', 'me@company.com', ['company.com', 'corp.com'])).toBe(false)
  })
  it('大小写不敏感', () => {
    expect(isExternalSender('A@COMPANY.COM', 'me@company.com')).toBe(false)
  })
})

describe('domainOf', () => {
  it('提取 email 域', () => {
    expect(domainOf('Alice <alice@example.com>')).toBe('example.com')
  })
  it('裸 email', () => {
    expect(domainOf('bob@x.com')).toBe('x.com')
  })
  it('无 email → 空串', () => {
    expect(domainOf('no email here')).toBe('')
  })
})
```

- [ ] **Step 2: 运行确认失败** → FAIL。

- [ ] **Step 3: 实现**

```ts
// src/lib/security/external.ts
export function domainOf(from: string): string {
  const m = (from || '').match(/([^\s@<>]+)@([^\s@<>]+)/i)
  return m ? m[2].toLowerCase() : ''
}

/**
 * 判断发件人是否来自组织外部。纯函数。
 * @param from 发件人字段
 * @param accountEmail 当前账号(取其域)
 * @param orgDomains 可选:组织内全部可信域(多账号同组织场景)
 */
export function isExternalSender(from: string, accountEmail: string, orgDomains?: string[]): boolean {
  const senderDomain = domainOf(from)
  if (!senderDomain) return true // 无域名 → 可疑,视为外部
  const myDomain = domainOf(accountEmail)
  const trusted = new Set([myDomain, ...(orgDomains || [])].filter(Boolean))
  return !trusted.has(senderDomain)
}
```

- [ ] **Step 4: 运行确认通过** → PASS。

- [ ] **Step 5: Commit**

```bash
git add src/lib/security/external.ts src/__tests__/security/external.test.ts
git commit -m "feat(security): external sender detection (anti social-engineering)"
git push
```

---

### Task 6: AttachmentScanner 接口 + noopScanner（附件接收侧可插拔扫描钩子）

**Files:**
- Create: `src/lib/security/scanner.ts`
- Create: `src/__tests__/security/scanner.test.ts`

**关键设计：** `AttachmentScanner` 接口定义 `scan(input: ScanInput): Promise<ScanResult>`，`ScanInput = { filePath, filename, mimeType, sha256 }`，`ScanResult = { status: 'clean'|'suspicious'|'malicious'|'error', engine, detail? }`。注册表 `registerScanner(scanner)` / `getScanners()` 支持多引擎串联。默认 `noopScanner` 返回 `clean`（本地不接真实 AV，预留接口供后续接 ClamAV/clamd）。`scanAttachment` 串行跑所有注册 scanner，任一 `malicious` 即停。

- [ ] **Step 1: 写失败测试**

```ts
import { describe, it, expect } from 'vitest'
import { noopScanner, scanAttachment, registerScanner, resetScanners } from '@/lib/security/scanner'

describe('AttachmentScanner', () => {
  it('noopScanner 总是 clean', async () => {
    const r = await noopScanner.scan({ filePath: '/tmp/x.bin', filename: 'x.exe', mimeType: 'application/x-msdownload', sha256: 'abc' })
    expect(r.status).toBe('clean')
    expect(r.engine).toBe('noop')
  })
  it('scanAttachment 无注册扫描器 → clean', async () => {
    resetScanners()
    const r = await scanAttachment({ filePath: '/tmp/x', filename: 'x', mimeType: 'text/plain', sha256: '1' })
    expect(r.status).toBe('clean')
  })
  it('注册 malicious 扫描器 → 返回 malicious 并停止', async () => {
    resetScanners()
    registerScanner({ name: 'evil', scan: async () => ({ status: 'malicious', engine: 'evil', detail: 'EICAR' }) })
    const r = await scanAttachment({ filePath: '/tmp/x', filename: 'x.exe', mimeType: 'app', sha256: '1' })
    expect(r.status).toBe('malicious')
    expect(r.detail).toBe('EICAR')
  })
  it('clean + suspicious 串联 → 取最严重', async () => {
    resetScanners()
    registerScanner({ name: 'a', scan: async () => ({ status: 'clean', engine: 'a' }) })
    registerScanner({ name: 'b', scan: async () => ({ status: 'suspicious', engine: 'b', detail: 'macro' }) })
    const r = await scanAttachment({ filePath: '/tmp/x', filename: 'x.doc', mimeType: 'app', sha256: '1' })
    expect(r.status).toBe('suspicious')
  })
  it('扫描器抛异常 → error 不中断其他引擎', async () => {
    resetScanners()
    registerScanner({ name: 'boom', scan: async () => { throw new Error('AV down') } })
    registerScanner({ name: 'ok', scan: async () => ({ status: 'clean', engine: 'ok' }) })
    const r = await scanAttachment({ filePath: '/tmp/x', filename: 'x', mimeType: 't', sha256: '1' })
    // boom 报错被吞,ok 跑完,无 malicious → clean
    expect(['clean', 'error']).toContain(r.status)
  })
})
```

- [ ] **Step 2: 运行确认失败** → FAIL。

- [ ] **Step 3: 实现**

```ts
// src/lib/security/scanner.ts
export interface ScanInput {
  filePath: string
  filename: string
  mimeType: string
  sha256: string
}

export type ScanStatus = 'clean' | 'suspicious' | 'malicious' | 'error'

export interface ScanResult {
  status: ScanStatus
  engine: string
  detail?: string
}

export interface AttachmentScanner {
  name: string
  scan(input: ScanInput): Promise<ScanResult>
}

/** 本地默认:不接真实 AV,返回 clean。预留接口供后续接 ClamAV/clamd。 */
export const noopScanner: AttachmentScanner = {
  name: 'noop',
  async scan() {
    return { status: 'clean', engine: 'noop' }
  },
}

const registry: AttachmentScanner[] = [noopScanner]

export function registerScanner(scanner: AttachmentScanner): void {
  registry.push(scanner)
}

export function resetScanners(): void {
  registry.length = 0
  registry.push(noopScanner)
}

export function getScanners(): readonly AttachmentScanner[] {
  return registry
}

const SEVERITY: Record<ScanStatus, number> = { clean: 0, suspicious: 1, error: 2, malicious: 3 }

/**
 * 对单个附件跑所有已注册扫描器(串行)。取最严重结果。
 * malicious 立即短路返回。单引擎抛异常被吞(记 error),不影响其他引擎。
 */
export async function scanAttachment(input: ScanInput): Promise<ScanResult> {
  let worst: ScanResult = { status: 'clean', engine: 'none' }
  for (const s of registry) {
    try {
      const r = await s.scan(input)
      if (SEVERITY[r.status] > SEVERITY[worst.status]) worst = r
      if (r.status === 'malicious') return r
    } catch {
      // 引擎故障不中断;若目前最差 < error 则记 error
      if (SEVERITY[worst.status] < SEVERITY['error']) {
        worst = { status: 'error', engine: s.name, detail: 'scanner threw' }
      }
    }
  }
  return worst
}
```

- [ ] **Step 4: 运行确认通过** → PASS。

- [ ] **Step 5: Commit**

```bash
git add src/lib/security/scanner.ts src/__tests__/security/scanner.test.ts
git commit -m "feat(security): pluggable attachment virus-scan hook (noop default, ClamAV-ready)"
git push
```

---

### Task 7: applySecurityToIngestedMessage 流水线入口（净化 + 评分隔离 + 认证头 + 外部标识 + 入库接线）

**Files:**
- Create: `src/lib/security/pipeline.ts`
- Create: `src/__tests__/security/pipeline.test.ts`
- Modify: `src/lib/adapter/mail/receiver.ts`、`src/lib/scheduler/index.ts`、`src/app/api/fetch/route.ts`

**关键设计：** `applySecurityToIngestedMessage(db, { messageRow, headers, accountEmail, moveSpamToFolder })` 是流水线入口：
1. **净化**：已在入库前对 `body_html` 调 `sanitizeEmailHtml`（receiver 侧）；本函数对存量/未净化的兜底再净化一次并 UPDATE（若已净则幂等）。
2. **评分**：组装 `SpamContext` 调 `scoreSpam`；命中则 UPDATE `is_spam=1/spam_score/spam_reasons` 并经 `moveSpamToFolder`(注入的 applyAction) 移到 `Spam` 文件夹；不命中也写 `spam_score`/`spam_reasons`(空)。
3. **认证头**：`parseAuthHeaders(headers)` → UPDATE `auth_result`(JSON)。
4. **外部标识**：`isExternalSender(from, accountEmail)` → UPDATE `is_external`。
返回 `{ spam: SpamVerdict, auth: AuthResult, isExternal: boolean, sanitized: boolean }`。
入库接线：receiver 解析后、`db.insert` 前 `body_html = sanitizeEmailHtml(raw)`；`db.insert` 成功后调 `applySecurityToIngestedMessage`。

- [ ] **Step 1: 写失败测试**

```ts
import { describe, it, expect, vi } from 'vitest'
import { applySecurityToIngestedMessage } from '@/lib/security/pipeline'
import { memDb } from '../helpers/memDb'

describe('applySecurityToIngestedMessage', () => {
  it('评分命中垃圾 → is_spam=1 + 移 Spam + 写 reasons', async () => {
    const db = memDb()
    db.exec(`INSERT INTO messages (id, message_id, account_id, sender, subject, body, body_html, folder, imap_uid) VALUES (1,'<m>',1,'x@y.com','FREE VIAGRA','b','<p>b</p>','INBOX',1)`)
    const moveSpam = vi.fn().mockResolvedValue(undefined)
    const r = await applySecurityToIngestedMessage(db, {
      messageRow: db.prepare('SELECT * FROM messages WHERE id=1').get() as any,
      headers: { 'authentication-results': 'spf=pass dkim=pass dmarc=pass' },
      accountEmail: 'me@company.com',
      moveSpamToFolder: moveSpam,
    })
    expect(r.spam.isSpam).toBe(true)
    expect((db.prepare('SELECT is_spam, spam_score FROM messages WHERE id=1').get() as any).is_spam).toBe(1)
    expect(moveSpam).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ messageIds: [1], targetFolder: 'Spam' }))
  })
  it('评分未命中 → is_spam=0,不移动', async () => {
    const db = memDb()
    db.exec(`INSERT INTO messages (id, message_id, account_id, sender, subject, body, body_html, folder, imap_uid) VALUES (1,'<m>',1,'friend@example.com','Hello','b','<p>b</p>','INBOX',1)`)
    const moveSpam = vi.fn()
    await applySecurityToIngestedMessage(db, {
      messageRow: db.prepare('SELECT * FROM messages WHERE id=1').get() as any,
      headers: { 'authentication-results': 'spf=pass dkim=pass dmarc=pass' },
      accountEmail: 'me@company.com',
      moveSpamToFolder: moveSpam,
    })
    expect((db.prepare('SELECT is_spam FROM messages WHERE id=1').get() as any).is_spam).toBe(0)
    expect(moveSpam).not.toHaveBeenCalled()
  })
  it('auth_result 写入 JSON(spf=fail)', async () => {
    const db = memDb()
    db.exec(`INSERT INTO messages (id, message_id, account_id, sender, subject, body, folder, imap_uid) VALUES (1,'<m>',1,'a@b','s','b','INBOX',1)`)
    const r = await applySecurityToIngestedMessage(db, {
      messageRow: db.prepare('SELECT * FROM messages WHERE id=1').get() as any,
      headers: { 'authentication-results': 'spf=fail dkim=fail dmarc=fail' },
      accountEmail: 'me@company.com',
      moveSpamToFolder: vi.fn(),
    })
    const auth = JSON.parse((db.prepare('SELECT auth_result FROM messages WHERE id=1').get() as any).auth_result)
    expect(auth.spf).toBe('fail')
    expect(r.auth.spf).toBe('fail')
  })
  it('外部发件人 → is_external=1', async () => {
    const db = memDb()
    db.exec(`INSERT INTO messages (id, message_id, account_id, sender, subject, body, folder, imap_uid) VALUES (1,'<m>',1,'stranger@evil.com','s','b','INBOX',1)`)
    await applySecurityToIngestedMessage(db, {
      messageRow: db.prepare('SELECT * FROM messages WHERE id=1').get() as any,
      headers: {},
      accountEmail: 'me@company.com',
      moveSpamToFolder: vi.fn(),
    })
    expect((db.prepare('SELECT is_external FROM messages WHERE id=1').get() as any).is_external).toBe(1)
  })
  it('入库前已净化则不重复写(幂等)', async () => {
    const db = memDb()
    db.exec(`INSERT INTO messages (id, message_id, account_id, sender, subject, body, body_html, folder, imap_uid) VALUES (1,'<m>',1,'a@b','s','b','<p>clean</p>','INBOX',1)`)
    const r = await applySecurityToIngestedMessage(db, {
      messageRow: db.prepare('SELECT * FROM messages WHERE id=1').get() as any,
      headers: {}, accountEmail: 'me@b.com', moveSpamToFolder: vi.fn(),
    })
    expect(r.sanitized).toBe(true)
    expect((db.prepare('SELECT body_html FROM messages WHERE id=1').get() as any).body_html).toBe('<p>clean</p>')
  })
})
```

- [ ] **Step 2: 运行确认失败** → FAIL。

- [ ] **Step 3: 实现**

```ts
// src/lib/security/pipeline.ts
import { sanitizeEmailHtml } from './sanitize'
import { scoreSpam, type SpamContext, type SpamVerdict } from './spam'
import { parseAuthHeaders, type AuthResult } from './auth-headers'
import { isExternalSender } from './external'

export interface SecurityPipelineResult {
  spam: SpamVerdict
  auth: AuthResult
  isExternal: boolean
  sanitized: boolean
}

/**
 * 对已入库的新邮件跑安全流水线:净化兜底 + 评分隔离 + 认证头解析 + 外部标识。
 * 入库前的 body_html 净化由 receiver 侧负责(见接线),本函数对存量/未净化兜底。
 */
export async function applySecurityToIngestedMessage(
  db: any,
  args: {
    messageRow: { id: number; sender?: string; subject?: string; body?: string; body_html?: string; received_at?: number }
    headers: Record<string, string>
    accountEmail: string
    moveSpamToFolder: (db: any, opts: { messageIds: number[]; targetFolder: string }) => Promise<void>
    spamThreshold?: number
    orgDomains?: string[]
  },
): Promise<SecurityPipelineResult> {
  const { messageRow, headers, accountEmail, moveSpamToFolder } = args
  const id = messageRow.id

  // 1. 净化兜底(幂等:对已净 html 再 sanitize 结果一致)
  const rawHtml = messageRow.body_html ?? ''
  const safeHtml = sanitizeEmailHtml(rawHtml)
  if (safeHtml !== rawHtml) {
    db.prepare('UPDATE messages SET body_html = ? WHERE id = ?').run(safeHtml, id)
  }

  // 2. 垃圾评分
  const spamCtx: SpamContext = {
    from: messageRow.sender ?? '',
    subject: messageRow.subject ?? '',
    bodyText: messageRow.body ?? '',
    bodyHtml: safeHtml,
    date: messageRow.received_at ? new Date(messageRow.received_at).toISOString() : null,
    messageId: null,
    hasAttachment: false,
    receivedHeader: headers['received'] || headers['Received'] || '',
  }
  const spam = scoreSpam(spamCtx, { threshold: args.spamThreshold })
  db.prepare('UPDATE messages SET spam_score = ?, spam_reasons = ?, is_spam = ? WHERE id = ?')
    .run(spam.score, JSON.stringify(spam.reasons), spam.isSpam ? 1 : 0, id)
  if (spam.isSpam) {
    await moveSpamToFolder(db, { messageIds: [id], targetFolder: 'Spam' })
  }

  // 3. 认证头
  const auth = parseAuthHeaders(headers)
  db.prepare('UPDATE messages SET auth_result = ? WHERE id = ?').run(JSON.stringify(auth), id)

  // 4. 外部标识
  const external = isExternalSender(messageRow.sender ?? '', accountEmail, args.orgDomains)
  db.prepare('UPDATE messages SET is_external = ? WHERE id = ?').run(external ? 1 : 0, id)

  return { spam, auth, isExternal: external, sanitized: true }
}
```

- [ ] **Step 4: 运行确认通过** → PASS。

- [ ] **Step 5: 入库接线（receiver 净化 + scheduler/fetch 调 pipeline）**

在 `src/lib/adapter/mail/receiver.ts` 解析出 `bodyHtml` 后、返回给上层前：

```ts
import { sanitizeEmailHtml } from '@/lib/security/sanitize'
// ...
bodyHtml: sanitizeEmailHtml(rawBodyHtml),  // 入库前净化
```

在 `src/lib/scheduler/index.ts` 与 `src/app/api/fetch/route.ts` 的 `db.insert(messages)` 成功分支后：

```ts
import { applySecurityToIngestedMessage } from '@/lib/security/pipeline'
import { applyAction } from '@/lib/sync/writeback' // plan-03
import { getAdapter } from '@/lib/adapter'          // plan-02
import { getDb } from '@/lib/db'

const row = getDb().prepare('SELECT * FROM messages WHERE id = ?').get(insertedId) as any
await applySecurityToIngestedMessage(getDb(), {
  messageRow: row,
  headers: msg.headers || {},                 // RawMessage 携带原始头(见下注)
  accountEmail: account.email,
  moveSpamToFolder: (d, opts) => applyAction(d, { ...opts, adapter: getAdapter(msg.accountId) }),
  orgDomains: settings.orgDomains,            // 可选 settings 配的组织域列表
})
```

> **注**：`RawMessage`/`ImapAdapter.fetch` 需携带原始头（`headers: Record<string,string>`）——子项目 2 的 mailparser 已解析 `parsed.headers`，透传即可（若 RawMessage 未含 headers 字段，本步顺带补上）。**此步无新单测**（pipeline 核心已由 Task 7 测覆盖），仅接线 + 手测：收一封主题 `FREE VIAGRA` 的邮件验证自动进 Spam 文件夹 + `is_spam=1`；收一封 `<script>` 邮件验证库内 `body_html` 已剥 script、渲染不弹窗。

- [ ] **Step 6: Commit**

```bash
git add src/lib/security/pipeline.ts src/__tests__/security/pipeline.test.ts src/lib/adapter/mail/receiver.ts src/lib/scheduler/index.ts src/app/api/fetch/route.ts
git commit -m "feat(security): ingest pipeline — sanitize + spam quarantine + auth headers + external tag"
git push
```

---

### Task 8: spam-repo（标记/取消垃圾 + 举报反馈训练 + 白名单学习）

**Files:**
- Create: `src/lib/security/spam-repo.ts`
- Create: `src/__tests__/security/spam-repo.test.ts`

**关键设计：** 「标记为垃圾」= UPDATE `is_spam=1` + 经 applyAction 移 Spam；「取消垃圾(误判恢复)」= `is_spam=0` + 移回收件箱 + **白名单学习**（把发件人域/地址加入可信，后续评分对该发件人降权/豁免——存 settings `spam_whitelist` JSON 数组，`scoreSpam` 读取后对白名单发件人跳过命中）。「举报为垃圾(反馈训练)」= 标记 + 把特征词加进本地垃圾词库（settings `spam_learned_words`），供评分规则动态增强（本地朴素贝叶斯雏形，最小实现：把举报邮件主题/正文高频词追加进 `FREE_WORD` 扩展集）。

- [ ] **Step 1: 写失败测试**

```ts
import { describe, it, expect, vi } from 'vitest'
import { markAsSpam, unmarkSpam, reportSpam, isWhitelistedSender, addSpamWhitelist } from '@/lib/security/spam-repo'
import { memDb } from '../helpers/memDb'

describe('spam-repo', () => {
  it('markAsSpam: is_spam=1 + 移 Spam', async () => {
    const db = memDb()
    db.exec(`INSERT INTO messages (id, message_id, account_id, sender, subject, folder, imap_uid) VALUES (1,'<m>',1,'a@b','s','INBOX',1)`)
    const move = vi.fn().mockResolvedValue(undefined)
    await markAsSpam(db, { messageId: 1, moveToSpam: move })
    expect((db.prepare('SELECT is_spam FROM messages WHERE id=1').get() as any).is_spam).toBe(1)
    expect(move).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ targetFolder: 'Spam' }))
  })
  it('unmarkSpam: is_spam=0 + 移回 INBOX + 加白名单', async () => {
    const db = memDb()
    db.exec(`INSERT INTO messages (id, message_id, account_id, sender, subject, folder, imap_uid, is_spam) VALUES (1,'<m>',1,'vip@corp.com','s','Spam',1,1)`)
    const move = vi.fn().mockResolvedValue(undefined)
    await unmarkSpam(db, { messageId: 1, moveToFolder: move, accountEmail: 'me@corp.com' })
    expect((db.prepare('SELECT is_spam FROM messages WHERE id=1').get() as any).is_spam).toBe(0)
    expect(isWhitelistedSender(db, 'vip@corp.com')).toBe(true)
    expect(move).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ targetFolder: 'INBOX' }))
  })
  it('addSpamWhitelist 去重', () => {
    const db = memDb()
    addSpamWhitelist(db, 'a@b.com')
    addSpamWhitelist(db, 'a@b.com')
    expect(isWhitelistedSender(db, 'a@b.com')).toBe(true)
    // 只一条
    const wl = JSON.parse((db.prepare(`SELECT value FROM settings WHERE key='spam_whitelist'`).get() as any).value)
    expect(wl.filter((x: string) => x === 'a@b.com')).toHaveLength(1)
  })
  it('reportSpam: 标记 + 学习特征词', async () => {
    const db = memDb()
    db.exec(`INSERT INTO messages (id, message_id, account_id, sender, subject, body, folder, imap_uid) VALUES (1,'<m>',1,'spam@x','低价代开','低价代开发票','INBOX',1)`)
    const move = vi.fn().mockResolvedValue(undefined)
    await reportSpam(db, { messageId: 1, moveToSpam: move })
    expect((db.prepare('SELECT is_spam FROM messages WHERE id=1').get() as any).is_spam).toBe(1)
    const learned = JSON.parse((db.prepare(`SELECT value FROM settings WHERE key='spam_learned_words'`).get() as any).value || '[]')
    expect(learned).toContain('代开发票')
  })
})
```

- [ ] **Step 2: 运行确认失败** → FAIL。

- [ ] **Step 3: 实现**

```ts
// src/lib/security/spam-repo.ts
function getSetting(db: any, key: string, fallback: any): any {
  const r = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as any
  if (!r) return fallback
  try { return JSON.parse(r.value) } catch { return fallback }
}
function setSetting(db: any, key: string, value: any): void {
  const v = JSON.stringify(value)
  const exists = db.prepare('SELECT 1 FROM settings WHERE key = ?').get(key)
  if (exists) db.prepare('UPDATE settings SET value = ? WHERE key = ?').run(v, key)
  else db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run(key, v)
}

/** 标记为垃圾 + 移 Spam 文件夹 */
export async function markAsSpam(db: any, args: { messageId: number; moveToSpam: (db: any, opts: { messageIds: number[]; targetFolder: string }) => Promise<void> }): Promise<void> {
  db.prepare('UPDATE messages SET is_spam = 1 WHERE id = ?').run(args.messageId)
  await args.moveToSpam(db, { messageIds: [args.messageId], targetFolder: 'Spam' })
}

/** 取消垃圾(误判) + 移回收件箱 + 加白名单(学习该发件人可信) */
export async function unmarkSpam(db: any, args: { messageId: number; moveToFolder: (db: any, opts: { messageIds: number[]; targetFolder: string }) => Promise<void>; accountEmail: string }): Promise<void> {
  db.prepare('UPDATE messages SET is_spam = 0 WHERE id = ?').run(args.messageId)
  await args.moveToFolder(db, { messageIds: [args.messageId], targetFolder: 'INBOX' })
  const m = db.prepare('SELECT sender FROM messages WHERE id = ?').get(args.messageId) as any
  if (m?.sender) {
    const mm = String(m.sender).match(/([^\s@<>]+)@([^\s@<>]+)/)
    if (mm) addSpamWhitelist(db, `${mm[1]}@${mm[2]}`.toLowerCase())
  }
}

/** 加垃圾白名单(去重) */
export function addSpamWhitelist(db: any, email: string): void {
  const e = email.toLowerCase().trim()
  const wl: string[] = getSetting(db, 'spam_whitelist', [])
  if (!wl.includes(e)) {
    wl.push(e)
    setSetting(db, 'spam_whitelist', wl)
  }
}

export function isWhitelistedSender(db: any, email: string): boolean {
  const wl: string[] = getSetting(db, 'spam_whitelist', [])
  return wl.includes(email.toLowerCase().trim())
}

/** 举报为垃圾 + 反馈训练(学特征词) */
export async function reportSpam(db: any, args: { messageId: number; moveToSpam: (db: any, opts: { messageIds: number[]; targetFolder: string }) => Promise<void> }): Promise<void> {
  const m = db.prepare('SELECT sender, subject, body FROM messages WHERE id = ?').get(args.messageId) as any
  await markAsSpam(db, { messageId: args.messageId, moveToSpam: args.moveToSpam })
  if (m) {
    const text = `${m.subject || ''} ${m.body || ''}`
    // 朴素:抽 ≥2 字中文词/英文词追加进 learned_words(去重,上限 500 防膨胀)
    const tokens = (text.match(/[一-龥]{2,}|[a-z]{4,}/gi) || []).map((t) => t.toLowerCase()).filter((t) => t.length >= 2)
    const learned: string[] = getSetting(db, 'spam_learned_words', [])
    for (const t of tokens) {
      if (!learned.includes(t) && learned.length < 500) learned.push(t)
    }
    setSetting(db, 'spam_learned_words', learned)
  }
}
```

> **scoreSpam 集成白名单/学习词**：在 Task 3 的 `scoreSpam` 增可选 `whitelistSenders?: string[]` 与 `extraSpamWords?: string[]` 参数（从 settings 读取后传入），白名单发件人直接返回 `isSpam:false`，`extraSpamWords` 追加进 `FREE_WORD` 匹配集。Task 7 接线时把 settings 读出的白名单/学习词透传。本步顺带给 `scoreSpam` 补这两个参数 + 1 个测试（白名单发件人即使主题全大写也不判垃圾）。

- [ ] **Step 4: 运行确认通过** → PASS。

- [ ] **Step 5: Commit**

```bash
git add src/lib/security/spam-repo.ts src/lib/security/spam.ts src/__tests__/security/spam-repo.test.ts src/__tests__/security/spam.test.ts
git commit -m "feat(security): spam mark/unmark/report + whitelist learning + feedback training"
git push
```

---

### Task 9: spam/links API

**Files:**
- Create: `src/app/api/messages/[id]/spam/route.ts`
- Create: `src/app/api/messages/[id]/links/route.ts`
- Create: `src/__tests__/api/messages-spam.test.ts`
- Create: `src/__tests__/api/messages-links.test.ts`

- [ ] **Step 1: 写失败测试（spam）**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { POST } from '@/app/api/messages/[id]/spam/route'
import { memDb } from '../../helpers/memDb'
import { vi as _vi } from 'vitest'

vi.mock('@/lib/db', () => {
  let current: any
  return {
    getDb: () => current,
    __setDb: (d: any) => { current = d },
  }
})

describe('POST /api/messages/[id]/spam', () => {
  beforeEach(() => {
    const db = memDb()
    db.exec(`INSERT INTO messages (id, message_id, account_id, sender, subject, folder, imap_uid) VALUES (1,'<m>',1,'a@b','s','INBOX',1)`)
    ;(require('@/lib/db') as any).__setDb(db)
  })
  it('action=mark → is_spam=1', async () => {
    const res = await POST(new Request('http://x/api/messages/1/spam', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'mark' }) }), { params: Promise.resolve({ id: '1' }) })
    expect(res.status).toBe(200)
    const db = (require('@/lib/db') as any).getDb()
    expect((db.prepare('SELECT is_spam FROM messages WHERE id=1').get() as any).is_spam).toBe(1)
  })
  it('action=unmark → is_spam=0', async () => {
    const db = (require('@/lib/db') as any).getDb()
    db.exec('UPDATE messages SET is_spam=1, folder=\'Spam\' WHERE id=1')
    await POST(new Request('http://x/api/messages/1/spam', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'unmark', accountEmail: 'me@b.com' }) }), { params: Promise.resolve({ id: '1' }) })
    expect((db.prepare('SELECT is_spam FROM messages WHERE id=1').get() as any).is_spam).toBe(0)
  })
  it('action=report → is_spam=1 + 学习', async () => {
    const res = await POST(new Request('http://x/api/messages/1/spam', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'report' }) }), { params: Promise.resolve({ id: '1' }) })
    expect(res.status).toBe(200)
  })
  it('非法 action → 400', async () => {
    const res = await POST(new Request('http://x/api/messages/1/spam', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'bogus' }) }), { params: Promise.resolve({ id: '1' }) })
    expect(res.status).toBe(400)
  })
})
```

- [ ] **Step 2: 写失败测试（links）**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { GET } from '@/app/api/messages/[id]/links/route'

vi.mock('@/lib/db', () => {
  let current: any
  return { getDb: () => current, __setDb: (d: any) => { current = d } }
})

describe('GET /api/messages/[id]/links', () => {
  beforeEach(() => {
    const { memDb } = require('../../helpers/memDb')
    const db = memDb()
    db.exec(`INSERT INTO messages (id, message_id, account_id, body_html) VALUES (1,'<m>',1,'<a href="http://1.2.3.4/login">bank</a><a href="https://ok.com">ok</a>')`)
    ;(require('@/lib/db') as any).__setDb(db)
  })
  it('返回可疑链接扫描结果', async () => {
    const res = await GET(new Request('http://x/api/messages/1/links'), { params: Promise.resolve({ id: '1' }) })
    const j = await res.json()
    expect(j.warnings.some((w: any) => w.reason === 'BARE_IP')).toBe(true)
    expect(j.links).toHaveLength(2)
  })
  it('消息不存在 → 404', async () => {
    const res = await GET(new Request('http://x/api/messages/999/links'), { params: Promise.resolve({ id: '999' }) })
    expect(res.status).toBe(404)
  })
})
```

- [ ] **Step 3: 运行确认失败** → FAIL。

- [ ] **Step 4: 实现 `/api/messages/[id]/spam/route.ts`**

```ts
import { NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { markAsSpam, unmarkSpam, reportSpam } from '@/lib/security/spam-repo'
import { applyAction } from '@/lib/sync/writeback' // plan-03
import { getAdapter } from '@/lib/adapter'          // plan-02

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const b = await req.json()
  const db = getDb()
  const m = db.prepare('SELECT account_id FROM messages WHERE id = ?').get(Number(id)) as any
  if (!m) return NextResponse.json({ error: 'not found' }, { status: 404 })
  const move = (d: any, opts: any) => applyAction(d, { ...opts, adapter: getAdapter(m.account_id) })
  if (b.action === 'mark') await markAsSpam(db, { messageId: Number(id), moveToSpam: move })
  else if (b.action === 'unmark') await unmarkSpam(db, { messageId: Number(id), moveToFolder: move, accountEmail: b.accountEmail })
  else if (b.action === 'report') await reportSpam(db, { messageId: Number(id), moveToSpam: move })
  else return NextResponse.json({ error: 'action must be mark|unmark|report' }, { status: 400 })
  return NextResponse.json({ ok: true })
}
```

- [ ] **Step 5: 实现 `/api/messages/[id]/links/route.ts`**

```ts
import { NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { extractLinks, isPhishing } from '@/lib/security/auth-headers'
import { sanitizeEmailHtml } from '@/lib/security/sanitize'

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const db = getDb()
  const m = db.prepare('SELECT body_html FROM messages WHERE id = ?').get(Number(id)) as any
  if (!m) return NextResponse.json({ error: 'not found' }, { status: 404 })
  const html = sanitizeEmailHtml(m.body_html || '')  // 渲染前净化 + 抽链接
  const links = extractLinks(html)
  const warnings = isPhishing(links)
  return NextResponse.json({ links, warnings })
}
```

- [ ] **Step 6: 运行确认通过** → PASS（spam 测试需 mock `@/lib/adapter` 的 `getAdapter` + `@/lib/sync/writeback` 的 `applyAction` 返回 no-op，或注入内存库后让 applyAction 检测 `adapter` 缺省走仅本地分支——参考 plan-08 约定）。

- [ ] **Step 7: Commit**

```bash
git add src/app/api/messages/[id]/spam/route.ts src/app/api/messages/[id]/links/route.ts src/__tests__/api/messages-spam.test.ts src/__tests__/api/messages-links.test.ts
git commit -m "feat(api): message spam mark/unmark/report + phishing link scan endpoints"
git push
```

---

### Task 10: 邮件详情页安全 UI（认证徽标 + 外部横幅 + 钓鱼链接警告）

**Files:**
- Modify: `src/app/mails/[id]/page.tsx`

- [ ] **Step 1: 加载认证结果**：从 message 的 `authResult`(JSON) 解析 SPF/DKIM/DMARC，渲染三枚徽标——`pass` 绿、`fail` 红、`softfail`/`none` 灰，附 tooltip 显示原文。任一 `fail` 顶部红条「⚠️ 该邮件未通过 SPF/DKIM/DMARC 认证，可能是伪造发件人」。

- [ ] **Step 2: 外部发件人横幅**：`is_external=1` 时顶部黄条「⚠️ 这是一封来自组织外部的邮件(来自 xxx.com),请警惕钓鱼/社工」。

- [ ] **Step 3: 钓鱼链接警告**：调 `GET /api/messages/[id]/links`，若 `warnings` 非空，正文上方列出可疑链接清单（href + reason 中文名：BARE_IP→「裸 IP 链接」、PUNYCODE→「疑似同形异义域名」、MISMATCHED_URL→「链接地址与显示不一致」、SHORT_LINK→「短链」）。iframe 内链接点击拦截（EmailBody 可加 `target="_blank" rel="noopener noreferrer"` 注入；点击前二次确认交由后续 P2,本任务先做列表警告）。

- [ ] **Step 4: 垃圾操作按钮**：详情页工具栏加「标记为垃圾」「不是垃圾」「举报」三按钮 → `POST /api/messages/[id]/spam { action }`。

- [ ] **Step 5: 手测**：收一封 SPF=fail 邮件验证红条 + fail 徽标；外部邮件验证黄条；含 IP 链接邮件验证警告清单；点「标记垃圾」验证移 Spam；Spam 里点「不是垃圾」验证移回收件箱 + 发件人入白名单。

- [ ] **Step 6: Commit**

```bash
git add src/app/mails/[id]/page.tsx
git commit -m "feat(ui): security badges (SPF/DKIM/DMARC) + external banner + phishing warnings + spam actions"
git push
```

---

### Task 11: 垃圾箱视图 + 还原入口（复用 plan-03 folders）

**Files:**
- Modify: `src/app/mails/page.tsx`（或 plan-03 的 folders 视图组件）

- [ ] **Step 1: 垃圾箱视图**：侧栏「垃圾邮件」(folders type=spam) 点击 → 列表 `SELECT ... WHERE folder='Spam' OR is_spam=1`，显示 spam_score + reasons 徽标。保留期提示（spec 风险登记册：保留期到期清除，30 天默认——读 settings `spam_retention_days`）。

- [ ] **Step 2: 还原入口**：列表/详情「不是垃圾」→ `POST /api/messages/[id]/spam { action:'unmark', accountEmail }`。彻底删除 → 复用 plan-03 delete。

- [ ] **Step 3: 保留期清理**：scheduler 加一个每日任务（或复用 plan-03 trash 保留期机制）`DELETE FROM messages WHERE is_spam=1 AND received_at < now - retention_days`（先手测可见性,清理逻辑可随 plan-03 一致实现）。

- [ ] **Step 4: 手测**：垃圾箱列表只显示 spam 邮件；「不是垃圾」恢复到收件箱且发件人入白名单；30 天前的垃圾邮件被清理。

- [ ] **Step 5: Commit**

```bash
git add src/app/mails/page.tsx
git commit -m "feat(ui): spam folder view + restore + retention cleanup"
git push
```

---

## 验收标准

- [ ] **HTML 净化（防 XSS）**：`sanitizeEmailHtml` 纯函数对攻击向量表（`<script>`/`<img onerror>`/`<svg onload>`/`<iframe>`/`javascript:`/`vbscript:`/`<object>`/`<form>`/`<base>`/`expression()`/HTML 实体编码/嵌套 `<scr<script>ipt>`/`data:text/html`）全部剥离；保留正常邮件标签（a/p/img/table/ul/strong/data:image）。入库前（receiver）+ 渲染前（EmailBody iframe srcDoc）两处接入。含 `<script>` 的邮件不执行。
- [ ] messages 新列 `is_spam/auth_result/is_external/spam_reasons/spam_score` 存在且迁移测试通过。
- [ ] **垃圾评分**：`scoreSpam` 纯函数按 SpamAssassin 规则子集累加（SUBJ_ALL_CAPS/FREE_WORD/URGENCY_WORDS/RDNS_NONE/FROM_LOCALPART_NUMERIC/MISSING_DATE/MISSING_MESSAGE_ID/HTML_FORM/HTML_SHORT_LEN/SUBJ_HAS_EXCESS_MARK/HIGH_SPAM_KEYWORDS_BUNDLE），超阈值判垃圾；阈值可配；支持白名单发件人豁免 + 学习词扩展。
- [ ] **垃圾自动隔离**：新收邮件入库后经 pipeline 评分，命中自动移 Spam 文件夹 + `is_spam=1`；垃圾箱视图可见；标记/取消垃圾/举报反馈训练可用且可逆（误判恢复 + 白名单学习）。
- [ ] **SPF/DKIM/DMARC**：`parseAuthHeaders` 解析 `Authentication-Results` 头输出三态（pass/fail/softfail/none）；失败项详情页红条 + 徽标警告。
- [ ] **钓鱼/恶意链接**：`isPhishing` 检测裸 IP/Punycode/显示不一致/短链；详情页可疑链接警告清单。
- [ ] **外部发件人标识**：组织外部邮件详情页显式黄条横幅防社工。
- [ ] **附件扫描钩子**：`AttachmentScanner` 接口 + `noopScanner` 默认 + 注册表（多引擎串联、malicious 短路、单引擎异常不中断）；本地默认不接真实 AV，接口已预留供后续接 ClamAV（与 plan-04 附件落盘链路协同）。
- [ ] spam/links API（`POST /api/messages/[id]/spam` mark/unmark/report、`GET /api/messages/[id]/links`）可用；非法输入 400、消息不存在 404。
- [ ] `npm test` 全绿（security sanitize/spam/auth-headers/external/scanner/pipeline/spam-repo、api messages-spam/messages-links、migration 补新列）。
- [ ] `npx tsc --noEmit` 无类型错误。

## 依赖

- 子项目 1：drizzle 迁移框架（messages 新列）+ §2.4 已要求 DOMPurify + 修 body 截断（评分正文需全文）+ RawMessage 携带 headers。
- 子项目 2：`accounts` 表（取 `account.email` 判外部域）+ `getAdapter(accountId)`。
- 子项目 3：`folders` 表（type=spam）+ `applyAction` 的 `move` UID 回写（垃圾隔离 / 还原 / sweep）+ 还原语义。
- 子项目 4：附件落盘链路——扫描钩子挂在 `attachments` 落盘后（`scanAttachment({ filePath, sha256, ... })`）。
- settings 表（plan-01 已有 key-value）：存 `spam_whitelist`/`spam_learned_words`/`spam_threshold`/`spam_retention_days`/`org_domains`。

## 风险

- **DOMPurify 浏览器侧 vs 服务端侧**：`sanitize.ts` import jsdom 仅 Node 需；EmailBody 是 client 组件。`getPurify` 用 `typeof window` 分支——浏览器用原生 window，服务端用 jsdom。Next 打包须确认 jsdom 不进 client bundle（DOMPurify 按需引用 + 分支惰性 new JSDOM）。**缓解**：手测渲染含 script 邮件不弹窗；若打包报错则把 EmailBody 侧净化改成「只依赖入库已净的 body_html,不在 client 再 sanitize」（退化为单点净化,入库即净）。
- **垃圾误判不可逆（spec Low 风险）**：误判把重要邮件隔离。**对策**：白名单学习（取消垃圾即加白名单）+ 可逆还原 + 保留期内可恢复 + 阈值默认偏保守(5.0)可调 + 垃圾箱显眼入口。验收时手测「误判 → 不是垃圾 → 恢复 + 后续该发件人不再误判」。
- **评分规则过/欠拟合**：本地规则子集非完整 SpamAssassin。**缓解**：反馈训练（reportSpam 学特征词）+ 阈值可配 + 白名单；不追求零误判,追求可恢复 + 可学习。
- **Authentication-Results 头格式差异**：各服务商（Gmail/163/QQ）该头格式略有差异,有的拆 `Received-SPF` 单独头。**缓解**：正则容错(同时查 `authentication-results`/`Authentication-Results`/`Received-SPF`),解析失败退化为 `none`(不误报),详情页显示原文供人判断。
- **pipeline 阻塞事件循环**：better-sqlite3 同步 + DOMPurify/jsdom 初始化开销。**缓解**：jsdom 单例惰性初始化（首封邮件慢一次,后续复用）；pipeline 接线处 `setImmediate` 让出（与 plan-06 NFR 一致）；大邮件净化耗时可后续挪 worker_threads（plan-14 已规划）。
- **附件扫描钩子默认 noop = 形同未扫**：本地不接真实 AV,恶意附件仍落盘。**缓解**：接口 + 文档明确「本地默认不查毒,接入 ClamAV 需 `registerScanner`」；子项目 4 已有路径穿越/ZIP 炸弹/大小上限防护作为前置;隔离位 `Quarantine` + 标记机制已就绪,接 AV 后立即生效。
- **RawMessage headers 透传**：若子项目 2 的 ImapAdapter 未把 `parsed.headers` 透进 RawMessage,pipeline 拿不到 `Authentication-Results`。**缓解**：Task 7 Step 5 顺带补 headers 字段;无头则 auth 全 none(不崩,仅不显示认证结果)。

## Out of scope（本地单用户不做）

- **多用户认证 / 2FA / 远程会话管理 / 多设备登录态**——本地单机单用户,无登录态、无会话、无多设备同步(spec §0/§范围/风险登记册明确砍掉)。
- **凭据加密 / credentials 表 / 主密钥**——auth_code 明文存 accounts(与 `.env.local` 一致),仅卫生点(db/env 不入 git、不入未加密云同步)。
- **真实杀毒引擎集成**——附件扫描钩子留接口(`noopScanner` 默认),不内置 ClamAV;需要时由用户 `registerScanner` 接入。
- **审计日志 / 配额限流 / 凭据轮换**——本地单用户 lens 不做(调研完备性审查 19 处遗漏中,这三项因本地 lens 明确 Out of scope)。
- **公网部署 / 横向扩展 / 对象存储**——纯本地单进程。
- **完整贝叶斯垃圾分类器**——本地用规则评分子集 + 反馈训练(学特征词)替代完整 ML 模型。
