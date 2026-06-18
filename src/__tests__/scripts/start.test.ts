// src/__tests__/scripts/start.test.ts
// 验证一行启动脚本结构正确(防止端口/迁移/构建守卫回归)。

import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync, statSync } from 'fs'

describe('start 脚本', () => {
  it('存在且可执行,默认端口 8321,启动前迁移', () => {
    const st = statSync('start')
    expect(st.mode & 0o111).not.toBe(0) // 可执行位
    const src = readFileSync('start', 'utf8')
    expect(src).toContain('PORT:-8321')
    expect(src).toContain('db:migrate')
  })

  it('生产模式缺失构建时自动 build', () => {
    const src = readFileSync('start', 'utf8')
    expect(src).toContain('BUILD_ID')
    expect(src).toContain('npm run build')
  })
})

describe('launchd 自启产物', () => {
  it('plist 模板存在且含关键键 + 占位符', () => {
    const path = 'scripts/com.actbox.plist.tpl'
    expect(existsSync(path)).toBe(true)
    const src = readFileSync(path, 'utf8')
    expect(src).toContain('<string>com.actbox</string>')
    expect(src).toContain('RunAtLoad')
    expect(src).toContain('KeepAlive')
    expect(src).toContain('__ACTBOX_DIR__') // install 脚本替换
    expect(src).toContain('StandardOutPath')
    expect(src).toContain('StandardErrorPath')
  })

  it('install/uninstall 脚本存在且可执行', () => {
    for (const p of ['scripts/install-autostart.sh', 'scripts/uninstall-autostart.sh']) {
      expect(existsSync(p)).toBe(true)
      expect(statSync(p).mode & 0o111).not.toBe(0)
    }
    const install = readFileSync('scripts/install-autostart.sh', 'utf8')
    expect(install).toContain('launchctl load')
    expect(install).toContain('LaunchAgents')
    const uninstall = readFileSync('scripts/uninstall-autostart.sh', 'utf8')
    expect(uninstall).toContain('launchctl unload')
  })
})
