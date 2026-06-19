/* ===================== shared client utilities ===================== */

function esc(s) {
  return String(s == null ? '' : s).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}

async function api(path, opts = {}) {
  const { headers, ...rest } = opts;
  const res = await fetch(path, {
    ...rest,
    headers: { 'Content-Type': 'application/json', ...(headers || {}) },
  });
  let data = null;
  try {
    data = await res.json();
  } catch (e) {
    /* no body */
  }
  if (!res.ok) {
    const err = new Error((data && data.error) || `요청 실패 (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}

/* ---- admin auth (sessionStorage) ---- */
const ADMIN_KEY = 'awards.adminPass';
function getAdminPass() {
  return sessionStorage.getItem(ADMIN_KEY) || '';
}
function setAdminPass(p) {
  sessionStorage.setItem(ADMIN_KEY, p);
}
function clearAdminPass() {
  sessionStorage.removeItem(ADMIN_KEY);
}
async function adminApi(path, opts = {}) {
  return api(path, { ...opts, headers: { 'x-admin-pass': getAdminPass(), ...(opts.headers || {}) } });
}

/* ---- voter identity (localStorage) ---- */
function getVoter() {
  let id = localStorage.getItem('awards.voterId');
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem('awards.voterId', id);
  }
  return {
    voterId: id,
    voterTeamId: localStorage.getItem('awards.teamId') || '',
    voterTeamName: localStorage.getItem('awards.teamName') || '',
  };
}
function setVoterTeam(teamId, teamName) {
  localStorage.setItem('awards.teamId', teamId);
  localStorage.setItem('awards.teamName', teamName);
}
function clearVoterTeam() {
  localStorage.removeItem('awards.teamId');
  localStorage.removeItem('awards.teamName');
}

/* ---- realtime stream (SSE with polling fallback) ----
   일부 터널/프록시(cloudflared --protocol http2 등)는 SSE를 버퍼링해 막습니다.
   그래서 ① 처음에 /api/state 로 즉시 1회 렌더하고, ② SSE 푸시를 시도하되,
   SSE가 조용하거나 끊기면 폴링으로 폴백합니다. 어떤 환경에서도 화면이 갱신됩니다. */
function connectStream(onState) {
  let gotSSE = false;
  let pollTimer = null;
  let lastJson = null;

  // 상태가 실제로 바뀐 경우에만 렌더 콜백 호출 (폴링으로 인한 깜빡임 방지)
  function emit(state) {
    let j;
    try {
      j = JSON.stringify(state);
    } catch (e) {
      j = null;
    }
    if (j !== null && j === lastJson) return; // 변화 없음 → 다시 그리지 않음
    lastJson = j;
    onState(state);
  }

  async function poll() {
    try {
      emit(await api('/api/state'));
    } catch (e) {
      /* ignore transient errors */
    }
  }
  function startPolling() {
    if (pollTimer) return;
    poll();
    pollTimer = setInterval(poll, 1500);
  }

  // ① 즉시 1회 렌더 (SSE 연결 전에도 팀/상장이 바로 보이도록)
  poll();

  // ② 실시간 푸시 시도
  let es = null;
  try {
    es = new EventSource('/api/stream');
    es.onmessage = (e) => {
      gotSSE = true;
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
      try {
        emit(JSON.parse(e.data));
      } catch (err) {
        /* ignore */
      }
    };
    es.onerror = () => startPolling();
  } catch (e) {
    startPolling();
  }

  // ③ SSE가 곧 데이터를 주지 않으면 폴링으로 폴백
  setTimeout(() => {
    if (!gotSSE) startPolling();
  }, 2500);

  return es;
}

/* ---- toast ---- */
function toast(msg, isErr = false) {
  let wrap = document.querySelector('.toast-wrap');
  if (!wrap) {
    wrap = document.createElement('div');
    wrap.className = 'toast-wrap';
    document.body.appendChild(wrap);
  }
  const el = document.createElement('div');
  el.className = 'toast' + (isErr ? ' err' : '');
  el.textContent = msg;
  wrap.appendChild(el);
  setTimeout(() => {
    el.style.transition = 'opacity .4s';
    el.style.opacity = '0';
    setTimeout(() => el.remove(), 400);
  }, 2600);
}

/* ---- confetti (gold, canvas) ---- */
function celebrate() {
  const canvas = document.createElement('canvas');
  canvas.className = 'confetti-canvas';
  document.body.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  let W = (canvas.width = innerWidth * dpr);
  let H = (canvas.height = innerHeight * dpr);
  canvas.style.width = innerWidth + 'px';
  canvas.style.height = innerHeight + 'px';
  const colors = ['#e8c97a', '#f0d69a', '#c9a45c', '#fff4d6', '#b08f4d'];
  const N = 200;
  const P = [];
  for (let i = 0; i < N; i++) {
    P.push({
      x: Math.random() * W,
      y: -Math.random() * H * 0.6,
      r: (4 + Math.random() * 8) * dpr,
      c: colors[i % colors.length],
      vy: (2.4 + Math.random() * 4.5) * dpr,
      vx: (-1.6 + Math.random() * 3.2) * dpr,
      rot: Math.random() * 6.28,
      vr: -0.22 + Math.random() * 0.44,
      shape: Math.random() < 0.5 ? 'r' : 't',
    });
  }
  let f = 0;
  function frame() {
    f++;
    ctx.clearRect(0, 0, W, H);
    for (const p of P) {
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.035 * dpr;
      p.rot += p.vr;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.c;
      if (p.shape === 'r') ctx.fillRect(-p.r / 2, -p.r / 2, p.r, p.r * 1.7);
      else {
        ctx.beginPath();
        ctx.moveTo(0, -p.r);
        ctx.lineTo(p.r, p.r);
        ctx.lineTo(-p.r, p.r);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
    }
    if (f < 300) requestAnimationFrame(frame);
    else {
      canvas.style.transition = 'opacity .6s';
      canvas.style.opacity = '0';
      setTimeout(() => canvas.remove(), 600);
    }
  }
  frame();
}

/* ---- winner reveal overlay ---- */
function showWinner(awardTitle, teamName) {
  let ov = document.querySelector('.winner-overlay');
  if (!ov) {
    ov = document.createElement('div');
    ov.className = 'winner-overlay';
    document.body.appendChild(ov);
  }
  ov.classList.remove('hidden');
  ov.innerHTML = `
    <div class="winner-card">
      <div class="sunburst"></div>
      <div class="congrats">Congratulations</div>
      <div class="award-label">${esc(awardTitle)}</div>
      <div class="winner-name">${esc(teamName)}</div>
      <div class="congrats-ko">축하합니다!! 🏆</div>
      <div class="close-x"><button class="btn btn-ghost" id="winnerClose">닫기</button></div>
    </div>`;
  ov.querySelector('#winnerClose').onclick = () => ov.classList.add('hidden');
  celebrate();
}
