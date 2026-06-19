#!/usr/bin/env bash
# tmux 세션(서버 + 터널) 종료
SESSION="${SESSION:-awards}"
if tmux kill-session -t "$SESSION" 2>/dev/null; then
  echo "중지됨: tmux 세션 '$SESSION' (서버 + cloudflared)"
else
  echo "실행 중인 '$SESSION' 세션이 없습니다."
fi
