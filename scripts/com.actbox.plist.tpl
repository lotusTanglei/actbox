<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<!-- launchd 模板:__ACTBOX_DIR__ / __NODE_PATH__ 由 scripts/install-autostart.sh 渲染替换 -->
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.actbox</string>
  <key>ProgramArguments</key>
  <array>
    <string>__ACTBOX_DIR__/start</string>
  </array>
  <key>WorkingDirectory</key>
  <string>__ACTBOX_DIR__</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PORT</key>
    <string>8321</string>
    <key>PATH</key>
    <string>__NODE_PATH__</string>
    <key>HOME</key>
    <string>__HOME__</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>__ACTBOX_DIR__/data/logs/actbox.out.log</string>
  <key>StandardErrorPath</key>
  <string>__ACTBOX_DIR__/data/logs/actbox.err.log</string>
</dict>
</plist>
