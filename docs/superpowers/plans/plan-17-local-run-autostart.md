# 子项目 17 — 一行启动 + 不常见端口 + launchd 自启 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: 用 superpowers:subagent-driven-development（concurrency=1，串行）或 executing-plans 逐任务实现。步骤用 `- [ ]` 勾选跟踪。

**Goal:** 让 actbox 能用 `./start` 一行命令启动到非默认端口 8321（避开常见占用），并支持 macOS launchd 开机自启 + 崩溃自动重启。

**Architecture:** 方案 B（详见 spec §0/§17）。① 项目根 `start` 脚本（bash）：确保 `data/` → `npm run db:migrate`（含 align）→ 加载 `.env.local` → `PORT=${PORT:-8321}` → 生产 `next start` 或 `ACTBOX_DEV=1` 时 `next dev`；② launchd plist 模板 + install/uninstall 脚本，`RunAtLoad=true` + `KeepAlive` 崩溃重启，日志写 `data/logs/`。

**Tech Stack:** Next.js 16 / React 19 / TypeScript / Drizzle ORM + better-sqlite3(WAL) / drizzle-kit / ImapFlow / nodemailer / vitest / bash + launchd。

**执行前置：** 在 git worktree 或干净 main 上执行；每任务结束 `git add` + `git commit` + `git push`（用户要求每任务提交推送）。本子项目依赖子项目 1 的 `db:migrate` 脚本。

---

## 文件结构

- Create: `start`（项目根，可执行 shell）— 一行启动
- Create: `scripts/install-autostart.sh`、`scripts/uninstall-autostart.sh`
- Create: `scripts/com.actbox.plist.tpl` — launchd 模板
- Modify: `package.json` — `start` 脚本 + `PORT` 默认
- Test: `src/__tests__/scripts/start.test.ts`（脚本存在性 + 端口默认值断言）

---

### Task 13: ./start 一行启动 + 端口 8321

**Files:**
- Create: `start`（项目根）
- Modify: `package.json`

- [ ] **Step 1: 写 start 脚本**（bash）：确保 `data/` 存在 → `npm run db:migrate`（含 align）→ 加载 `.env.local` → `PORT=${PORT:-8321}` → `next start`（生产）或 `next dev`（`ACTBOX_DEV=1` 时）。`chmod +x start`。

```bash
#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p data logs
export PORT="${PORT:-8321}"
npm run db:migrate
if [ "${ACTBOX_DEV:-0}" = "1" ]; then exec npm run dev; else exec npm run start; fi
```

- [ ] **Step 2: package.json 加 start**：`"start": "next start"`（已有则确认）。

- [ ] **Step 3: 写测试 `src/__tests__/scripts/start.test.ts`**（断言 `start` 文件存在且可执行、含 `PORT:-8321`、含 `db:migrate`）。

```ts
import { describe, it, expect } from 'vitest'
import { readFileSync, statSync } from 'fs'
describe('start 脚本', () => {
  it('存在且可执行，默认端口 8321，启动前迁移', () => {
    const st = statSync('start')
    expect(st.mode & 0o111).not.toBe(0)
    const src = readFileSync('start', 'utf8')
    expect(src).toContain('PORT:-8321')
    expect(src).toContain('db:migrate')
  })
})
```

- [ ] **Step 4: 运行通过** `npx vitest run src/__tests__/scripts/start.test.ts`。

- [ ] **Step 5: 手测** `./start` → http://localhost:8321 可访问、库已迁移。

- [ ] **Step 6: Commit**

```bash
git add start package.json src/__tests__/scripts/start.test.ts
git commit -m "feat(run): ./start one-command launch on port 8321 with auto-migrate"
git push
```

---

### Task 14: launchd 开机自启 install/uninstall

**Files:**
- Create: `scripts/com.actbox.plist.tpl`、`scripts/install-autostart.sh`、`scripts/uninstall-autostart.sh`

- [ ] **Step 1: 写 plist 模板** `scripts/com.actbox.plist.tpl`（Label=com.actbox、ProgramArguments 调项目根 `./start`、WorkingDirectory=项目根、EnvironmentVariables 含 `PORT=8321`、RunAtLoad=true、KeepAlive 崩溃重启、StandardOut/ErrPath 指向 `data/logs/`）。用 `__ACTBOX_DIR__` 占位由 install 脚本替换为绝对路径。

- [ ] **Step 2: 写 install-autostart.sh**：渲染模板 → 写到 `~/Library/LaunchAgents/com.actbox.plist` → `launchctl load` → 打印状态。

- [ ] **Step 3: 写 uninstall-autostart.sh**：`launchctl unload` → 删 plist。

- [ ] **Step 4: 手测**：`scripts/install-autostart.sh` → 重启机器（或 `launchctl start com.actbox`）→ 服务自起、8321 可访问；`scripts/uninstall-autostart.sh` → 清理干净。

- [ ] **Step 5: Commit**

```bash
git add scripts/com.actbox.plist.tpl scripts/install-autostart.sh scripts/uninstall-autostart.sh
git commit -m "feat(run): macOS launchd autostart install/uninstall"
git push
```
