#!/usr/bin/env bash
# 자동배포 워처 — 새 커밋(로컬 또는 원격)이 생기면 tmux 'server' 창의
# Node 서버를 재시작한다. cloudflared 터널은 유지되므로 공개 URL은 그대로.
#  - 원격(origin/main)이 앞서면 fast-forward pull 로 받아온 뒤 재배포
#  - 같은 머신에서 직접 커밋한 경우(로컬 HEAD 이동)도 재배포
# 안전: ff-only pull 만 수행하며, 실패 시 건너뛴다(로컬 변경 보존, reset 안 함).
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

DEPLOYED="$(git rev-parse HEAD 2>/dev/null || echo none)"
echo "[autodeploy] 시작 — 배포 커밋 ${DEPLOYED:0:7}, origin/$BRANCH 를 ${INTERVAL}s 마다 감시"

while true; do
  # 서버 헬스체크 — 죽어 있으면 즉시 재기동 (supervisor 역할). cloudflared 는 건드리지 않음.
  if ! curl -sf -o /dev/null --max-time 3 "http://localhost:$PORT/api/state"; then
    echo "[supervisor] 서버 응답 없음 → 재기동"
    restart_server
    sleep 2
  fi

  git fetch origin "$BRANCH" --quiet 2>/dev/null || true
  LOCAL="$(git rev-parse HEAD 2>/dev/null || echo none)"
  REMOTE="$(git rev-parse "origin/$BRANCH" 2>/dev/null || echo none)"

  # 원격이 앞서고 로컬이 그 조상이면 fast-forward pull
  if [ "$REMOTE" != "none" ] && [ "$LOCAL" != "$REMOTE" ] \
     && git merge-base --is-ancestor "$LOCAL" "$REMOTE" 2>/dev/null; then
    echo "[autodeploy] origin 이 앞섬 (${REMOTE:0:7}) → pull"
    git pull --ff-only origin "$BRANCH" || echo "[autodeploy] pull 실패 — 건너뜀"
    LOCAL="$(git rev-parse HEAD 2>/dev/null || echo none)"
  fi

  # 배포된 커밋과 현재 HEAD 가 다르면 의존성 갱신 후 서버 재시작
  if [ "$LOCAL" != "none" ] && [ "$LOCAL" != "$DEPLOYED" ]; then
    echo "[autodeploy] 새 커밋 ${LOCAL:0:7} → 의존성 설치 + 서버 재시작"
    npm ci --omit=dev --silent 2>/dev/null || npm install --omit=dev --silent || true
    restart_server
    DEPLOYED="$LOCAL"
    echo "[autodeploy] 배포 완료: ${LOCAL:0:7}"
  fi

  sleep "$INTERVAL"
done
