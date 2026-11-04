#!/bin/bash
# Vultr "Startup Script" / cloud-init user-data. Ubuntu 22.04/24.04. Installs Node, clones the repo, runs it as a systemd service on port 80.
# Built by Tab, an AI assistant, for team lead Akshay Wagh.
set -eux
export DEBIAN_FRONTEND=noninteractive
REPO="${REPO:-https://github.com/tab-for-akshay/krishidesk-agent-rush}"
apt-get update -y
apt-get install -y nodejs git ca-certificates
id agentrush >/dev/null 2>&1 || useradd -r -m -d /opt/agentrush -s /usr/sbin/nologin agentrush
rm -rf /opt/agentrush/app
git clone --depth 1 "$REPO" /opt/agentrush/app
mkdir -p /var/lib/agentrush && chown -R agentrush:agentrush /var/lib/agentrush /opt/agentrush
cat > /etc/systemd/system/agentrush.service <<'UNIT'
[Unit]
Description=KrishiDesk Agent (Vultr Agent Rush)
After=network-online.target
Wants=network-online.target

[Service]
User=agentrush
WorkingDirectory=/opt/agentrush/app
Environment=PORT=80
Environment=DATA_FILE=/var/lib/agentrush/state.json
Environment=DEMO_OPEN_KILL=1
ExecStart=/usr/bin/node src/server.js
Restart=always
RestartSec=3
AmbientCapabilities=CAP_NET_BIND_SERVICE
NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=/var/lib/agentrush
PrivateTmp=true
MemoryMax=300M

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable --now agentrush
sleep 3
curl -fsS http://127.0.0.1/api/health || journalctl -u agentrush --no-pager | tail -20
