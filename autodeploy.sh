#!/usr/bin/env bash
# 자동배포 워처 — origin/main 을 주기적으로 확인해 새 커밋이 있으면
# pull 후 tmux 'server' 창의 Node 서버를 재시작한다.
# cloudflared 터널은 그대로 유지되므로 공개 URL은 바뀌지 않는다.
set -uo pipefail

SESSION="${SESSION:-awards}"
PORT="${PORT:-3210}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-admin1234}"
BRANCH="${BRANCH:-main}"
INTERVAL="${INTERVAL:-30}"
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

restart_server() {
  tmux send-keys -t "$SESSION":server C-c 2>/dev/null || true
  sleep 1
  tmux send-keys -t "$SESSION":server \
    "ADMIN_PASSWORD='$ADMIN_PASSWORD' PORT='$PORT' node server.js" Enter
}

echo "[autodeploy] origin/$BRANCH 를 ${INTERVAL}s 마다 감시합니다..."
while true; do
  git fetch origin "$BRANCH" --quiet 2>/dev/null || true
  LOCAL="$(git rev-parse HEAD 2>/dev/null || true)"
  REMOTE="$(git rev-parse "origin/$BRANCH" 2>/dev/null || true)"
  if [ -n "$REMOTE" ] && [ "$LOCAL" != "$REMOTE" ]; then
    echo "[autodeploy] 새 커밋 감지: ${REMOTE:0:7} — 배포 시작"
    git pull --ff-only origin "$BRANCH" || git reset --hard "origin/$BRANCH"
    npm ci --omit=dev --silent 2>/dev/null || npm install --omit=dev --silent || true
    restart_server
    echo "[autodeploy] 배포 완료: $(git rev-parse --short HEAD)"
  fi
  sleep "$INTERVAL"
done
