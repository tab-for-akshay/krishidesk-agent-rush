#!/bin/bash
# Pull the latest code and restart (run on the VM as root).
set -e
cd /opt/agentrush/app && git pull --ff-only && systemctl restart agentrush && sleep 2 && curl -fsS http://127.0.0.1/api/health
