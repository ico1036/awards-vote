#!/usr/bin/env bash
# THE AWARDS — tmux로 서버 유지 + Cloudflare Quick Tunnel로 공개 URL 발급
set -euo pipefail

SESSION="${SESSION:-awards}"
PORT="${PORT:-3210}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-admin1234}"
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CF_LOG="/tmp/awards-cf.log"

# 깨끗하게 재시작 (Quick Tunnel URL은 실행마다 새로 발급됨)
tmux kill-session -t "$SESSION" 2>/dev/null || true

# 1) 서버 창
tmux new-session -d -s "$SESSION" -n server
tmux send-keys -t "$SESSION":server \
  "cd '$DIR' && ADMIN_PASSWORD='$ADMIN_PASSWORD' PORT='$PORT' node server.js" Enter

# 서버가 뜰 시간을 잠깐 준다
sleep 2

# 2) 터널 창
: > "$CF_LOG"
tmux new-window -t "$SESSION" -n tunnel
tmux send-keys -t "$SESSION":tunnel \
  "cloudflared tunnel --no-autoupdate --protocol http2 --url http://localhost:$PORT > '$CF_LOG' 2>&1" Enter

# 3) 자동배포 워처 (git remote 'origin' 이 있을 때만)
if git -C "$DIR" remote get-url origin >/dev/null 2>&1; then
  tmux new-window -t "$SESSION" -n deploy
  tmux send-keys -t "$SESSION":deploy \
    "cd '$DIR' && ADMIN_PASSWORD='$ADMIN_PASSWORD' PORT='$PORT' ./autodeploy.sh" Enter
  echo "▸ 자동배포 워처 시작됨 (origin/main 감시)"
fi

# 4) 공개 URL 대기/추출
echo "▸ cloudflared URL 발급을 기다리는 중..."
URL=""
for _ in $(seq 1 40); do
  URL="$(grep -Eo 'https://[a-z0-9-]+\.trycloudflare\.com' "$CF_LOG" | head -1 || true)"
  [ -n "$URL" ] && break
  sleep 1
done

echo
if [ -n "$URL" ]; then
  echo "════════════════════════════════════════════════════"
  echo "  공개 URL:  $URL"
  echo "    • 투표:    $URL/vote.html"
  echo "    • 결과:    $URL/results.html"
  echo "    • 관리자:  $URL/admin.html   (비번: $ADMIN_PASSWORD)"
  echo "════════════════════════════════════════════════════"
  echo "  tmux 접속:  tmux attach -t $SESSION   (분리: Ctrl-b d)"
  echo "  종료:       ./stop-tunnel.sh"
else
  echo "URL을 아직 못 찾았습니다. 'tmux attach -t $SESSION' 후 tunnel 창을 확인하세요."
  echo "로그: $CF_LOG"
fi
