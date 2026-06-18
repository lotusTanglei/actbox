// src/lib/templates/render.ts — 模板变量替换纯函数。plan-13 Task 4。
const VAR_RE = /\{\{\s*([A-Za-z_]\w*)\s*\}\}/g

/** 替换 {{name}} 占位。未提供的变量替换为空串。 */
export function applyTemplate(html: string, vars: Record<string, string>): string {
  return html.replace(VAR_RE, (full, name: string) => {
    return Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name] ?? '') : ''
  })
}

/** 抽取所有 {{name}} 占位的变量名(按出现顺序去重)。 */
export function extractVariables(html: string): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  let m: RegExpExecArray | null
  VAR_RE.lastIndex = 0
  while ((m = VAR_RE.exec(html)) !== null) {
    const name = m[1]
    if (!seen.has(name)) { seen.add(name); out.push(name) }
  }
  return out
}
