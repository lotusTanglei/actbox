#!/usr/bin/env bash
# 卸载 actbox 开机自启
#   - launchctl unload
#   - 删除 ~/Library/LaunchAgents/com.actbox.plist
set -euo pipefail

LABEL="com.actbox"
PLIST_DST="$HOME/Library/LaunchAgents/${LABEL}.plist"

if [ -f "$PLIST_DST" ]; then
  launchctl unload "$PLIST_DST" 2>/dev/null || true
  rm -f "$PLIST_DST"
  echo "✓ 已卸载 launchd agent: ${LABEL}(已删除 ${PLIST_DST})"
else
  echo "○ 未安装(${LABEL}),无需卸载"
fi
