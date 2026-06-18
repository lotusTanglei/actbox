// src/lib/export/vault.ts — vault 文件写入。plan-18 Task 3。
import { promises as fs } from 'node:fs'
import path from 'node:path'

export async function writeToVault(vaultPath: string, filename: string, content: string): Promise<string> {
  // 安全校验
  if (!/^[A-Za-z0-9._-]+$/.test(filename)) throw new Error(`invalid filename: ${filename}`)
  const resolved = path.resolve(vaultPath, filename)
  if (!resolved.startsWith(path.resolve(vaultPath))) throw new Error(`path escape detected: ${filename}`)
  await fs.mkdir(path.dirname(resolved), { recursive: true })
  await fs.writeFile(resolved, content, 'utf8')
  return resolved
}

export function resolveVaultPath(db: any): string {
  try {
    const row = db.prepare("SELECT value FROM settings WHERE key='export.obsidianVault'").get() as any
    if (row && row.value) return row.value
  } catch { /* settings 表不存在 */ }
  throw new Error('VAULT_NOT_CONFIGURED')
}
