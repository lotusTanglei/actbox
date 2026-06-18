#!/usr/bin/env bash
# 安装 actbox 开机自启(macOS launchd user agent)
#   - 渲染 com.actbox.plist.tpl(替换 ACTBOX_DIR / NODE_PATH / HOME)
#   - 写入 ~/Library/LaunchAgents/com.actbox.plist
#   - launchctl load(崩溃自动重启 KeepAlive)
set -euo pipefail

cd "$(dirname "$0")/.."
ACTBOX_DIR="$(pwd)"
LABEL="com.actbox"
PLIST_DST="$HOME/Library/LaunchAgents/${LABEL}.plist"

command -v node >/dev/null 2>&1 || { echo "✗ 未找到 node,请先安装 Node.js"; exit 1; }
command -v npm  >/dev/null 2>&1 || { echo "✗ 未找到 npm"; exit 1; }

NPM_BIN="$(dirname "$(command -v npm)")"
NODE_BIN="$(dirname "$(command -v node)")"
# 合成 PATH:优先 node/npm 所在目录 + 常见安装位置
NODE_PATH="${NPM_BIN}:${NODE_BIN}:${HOME}/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"

mkdir -p data/logs

TPL="scripts/com.actbox.plist.tpl"
[ -f "$TPL" ] || { echo "✗ 模板不存在: ${ACTBOX_DIR}/${TPL}"; exit 1; }

sed \
  -e "s|__ACTBOX_DIR__|${ACTBOX_DIR}|g" \
  -e "s|__NODE_PATH__|${NODE_PATH}|g" \
  -e "s|__HOME__|${HOME}|g" \
  "$TPL" > "$PLIST_DST"

echo "✓ plist 已写入: ${PLIST_DST}"
echo "  项目目录: ${ACTBOX_DIR}"
echo "  node PATH: ${NODE_PATH}"

# 重新加载(已在运行则先卸载)
launchctl unload "$PLIST_DST" 2>/dev/null || true
launchctl load "$PLIST_DST"

echo "✓ launchd agent 已加载: ${LABEL}(端口 8321,崩溃自动重启)"
echo "  日志: ${ACTBOX_DIR}/data/logs/actbox.{out,err}.log"
echo "  手动管理: launchctl stop|start ${LABEL}"
echo "  卸载:     scripts/uninstall-autostart.sh"
