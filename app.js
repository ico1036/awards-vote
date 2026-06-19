/**
 * App factory — builds the Express app around an isolated state object so it
 * can be exercised by tests (in-memory) or run for real (file-backed).
 *
 *   const { app, reset } = createApp({ dataFile, adminPassword, initialState });
 */
const express = require('express');
const fs = require('fs');
const crypto = require('crypto');

function seed() {
  const teams = ['오로라', '네뷸라', '카멜롯', '피닉스'].map((n) => ({
    id: crypto.randomUUID(),
    name: n,
  }));
  const awards = [
    { title: '올해의 팀', description: '한 해를 가장 환하게 빛낸 팀' },
    { title: '베스트 협업상', description: '협업의 진가를 보여준 팀' },
    { title: '라이징 스타', description: '가장 눈부시게 성장한 팀' },
  ].map((a, i) => ({
    id: crypto.randomUUID(),
    order: i,
    decided: false,
    winnerTeamId: null,
    ...a,
  }));
  return { teams, awards, votes: [] };
}

function normalize(s) {
  return {
    teams: Array.isArray(s.teams) ? s.teams : [],
    awards: (Array.isArray(s.awards) ? s.awards : []).map((a, i) => ({
      order: i,
      decided: false,
      winnerTeamId: null,
      description: '',
      ...a,
    })),
    votes: Array.isArray(s.votes) ? s.votes : [],
  };
}

function createApp(opts = {}) {
  const ADMIN_PASSWORD = opts.adminPassword || 'admin1234';
  const DATA_FILE = opts.dataFile || null;

  function load() {
    if (!DATA_FILE) return seed();
    try {
      return normalize(JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')));
    } catch (e) {
      return seed();
    }
  }

  let state = opts.initialState ? normalize(structuredClone(opts.initialState)) : load();

  let saveTimer = null;
  function save() {
    if (!DATA_FILE) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      fs.writeFile(DATA_FILE, JSON.stringify(state, null, 2), () => {});
    }, 120);
  }
  save();

  function reset(initial) {
    state = initial ? normalize(structuredClone(initial)) : seed();
    save();
    broadcast();
  }

  // ---------- views ----------
  const teamName = (id) => {
    const t = state.teams.find((x) => x.id === id);
    return t ? t.name : '—';
  };

  function publicView() {
    const countMap = {};
    for (const v of state.votes) {
      (countMap[v.awardId] = countMap[v.awardId] || {})[v.teamId] =
        (countMap[v.awardId]?.[v.teamId] || 0) + 1;
    }
    const awards = [...state.awards]
      .sort((a, b) => a.order - b.order)
      .map((a) => {
        const counts = countMap[a.id] || {};
        const results = state.teams.map((t) => ({
          teamId: t.id,
          teamName: t.name,
          count: counts[t.id] || 0,
        }));
        const totalVotes = results.reduce((s, r) => s + r.count, 0);
        return {
          id: a.id,
          title: a.title,
          description: a.description || '',
          decided: !!a.decided,
          winnerTeamId: a.winnerTeamId || null,
          winnerTeamName: a.winnerTeamId ? teamName(a.winnerTeamId) : null,
          totalVotes,
          results,
        };
      });
    return { teams: state.teams.map((t) => ({ id: t.id, name: t.name })), awards };
  }

  function awardTotal(awardId) {
    return state.votes.reduce((n, v) => n + (v.awardId === awardId ? 1 : 0), 0);
  }

  // ---------- SSE ----------
  const clients = new Set();
  function broadcast() {
    const payload = `data: ${JSON.stringify(publicView())}\n\n`;
    for (const res of clients) {
      try {
        res.write(payload);
      } catch (e) {
        /* ignore */
      }
    }
  }

  // ---------- app ----------
  const app = express();
  app.use(express.json());
  if (opts.staticDir !== null) app.use(express.static(opts.staticDir || require('path').join(__dirname, 'public')));

  app.get('/api/stream', (req, res) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write(`data: ${JSON.stringify(publicView())}\n\n`);
    clients.add(res);
    const ping = setInterval(() => {
      try {
        res.write(': ping\n\n');
      } catch (e) {
        /* ignore */
      }
    }, 25000);
    req.on('close', () => {
      clearInterval(ping);
      clients.delete(res);
    });
  });

  app.get('/api/state', (req, res) => res.json(publicView()));

  app.get('/api/my-votes', (req, res) => {
    const voterId = req.query.voterId;
    const mine = {};
    if (voterId) for (const v of state.votes) if (v.voterId === voterId) mine[v.awardId] = v.teamId;
    res.json(mine);
  });

  app.post('/api/vote', (req, res) => {
    const { awardId, teamId, voterId, voterTeamId } = req.body || {};
    const award = state.awards.find((a) => a.id === awardId);
    if (!award) return res.status(404).json({ error: '존재하지 않는 상입니다.' });
    if (award.decided) return res.status(409).json({ error: '이미 수상자가 결정된 상입니다.' });
    if (!state.teams.find((t) => t.id === teamId))
      return res.status(400).json({ error: '존재하지 않는 팀입니다.' });
    if (!voterId) return res.status(400).json({ error: '로그인이 필요합니다.' });
    if (!voterTeamId) return res.status(400).json({ error: '소속 팀을 먼저 선택하세요.' });
    if (teamId === voterTeamId)
      return res.status(400).json({ error: '본인 팀에는 투표할 수 없습니다.' });

    const existing = state.votes.find((v) => v.awardId === awardId && v.voterId === voterId);
    if (existing) existing.teamId = teamId;
    else state.votes.push({ awardId, teamId, voterId, voterTeamId });
    save();
    broadcast();
    res.json({ ok: true });
  });

  // ---------- admin ----------
  function admin(req, res, next) {
    if ((req.headers['x-admin-pass'] || '') !== ADMIN_PASSWORD)
      return res.status(401).json({ error: '관리자 인증에 실패했습니다.' });
    next();
  }

  app.post('/api/admin/login', (req, res) => {
    if ((req.body?.password || '') !== ADMIN_PASSWORD)
      return res.status(401).json({ error: '비밀번호가 올바르지 않습니다.' });
    res.json({ ok: true });
  });

  app.post('/api/admin/teams', admin, (req, res) => {
    const name = (req.body?.name || '').trim();
    if (!name) return res.status(400).json({ error: '팀 이름을 입력하세요.' });
    if (state.teams.some((t) => t.name === name))
      return res.status(409).json({ error: '이미 존재하는 팀입니다.' });
    const team = { id: crypto.randomUUID(), name };
    state.teams.push(team);
    save();
    broadcast();
    res.json(team);
  });

  app.delete('/api/admin/teams/:id', admin, (req, res) => {
    const id = req.params.id;
    state.teams = state.teams.filter((t) => t.id !== id);
    state.votes = state.votes.filter((v) => v.teamId !== id && v.voterTeamId !== id);
    state.awards.forEach((a) => {
      if (a.winnerTeamId === id) {
        a.winnerTeamId = null;
        a.decided = false;
      }
    });
    save();
    broadcast();
    res.json({ ok: true });
  });

  app.post('/api/admin/awards', admin, (req, res) => {
    const title = (req.body?.title || '').trim();
    if (!title) return res.status(400).json({ error: '상 이름을 입력하세요.' });
    const description = (req.body?.description || '').trim();
    const award = {
      id: crypto.randomUUID(),
      title,
      description,
      order: state.awards.length,
      decided: false,
      winnerTeamId: null,
    };
    state.awards.push(award);
    save();
    broadcast();
    res.json(award);
  });

  app.put('/api/admin/awards/:id', admin, (req, res) => {
    const a = state.awards.find((x) => x.id === req.params.id);
    if (!a) return res.status(404).json({ error: '존재하지 않는 상입니다.' });
    if (req.body?.title !== undefined) {
      const t = String(req.body.title).trim();
      if (!t) return res.status(400).json({ error: '상 이름을 입력하세요.' });
      a.title = t;
    }
    if (req.body?.description !== undefined) a.description = String(req.body.description).trim();
    save();
    broadcast();
    res.json(a);
  });

  app.delete('/api/admin/awards/:id', admin, (req, res) => {
    state.awards = state.awards.filter((a) => a.id !== req.params.id);
    state.votes = state.votes.filter((v) => v.awardId !== req.params.id);
    state.awards.forEach((a, i) => (a.order = i));
    save();
    broadcast();
    res.json({ ok: true });
  });

  app.post('/api/admin/awards/:id/decide', admin, (req, res) => {
    const a = state.awards.find((x) => x.id === req.params.id);
    if (!a) return res.status(404).json({ error: '존재하지 않는 상입니다.' });
    let teamId = req.body?.teamId;
    if (teamId) {
      // explicit manual pick — must reference a real team
      if (!state.teams.find((t) => t.id === teamId))
        return res.status(400).json({ error: '존재하지 않는 팀입니다.' });
    } else {
      // automatic: crown the leader, but never with zero votes cast
      if (awardTotal(a.id) === 0)
        return res.status(400).json({ error: '투표가 없어 수상자를 결정할 수 없습니다.' });
      const counts = {};
      for (const v of state.votes) if (v.awardId === a.id) counts[v.teamId] = (counts[v.teamId] || 0) + 1;
      let best = null;
      let bestC = -1;
      for (const t of state.teams) {
        const c = counts[t.id] || 0;
        if (c > bestC) {
          bestC = c;
          best = t.id;
        }
      }
      teamId = best;
    }
    if (!teamId) return res.status(400).json({ error: '후보 팀이 없습니다.' });
    a.decided = true;
    a.winnerTeamId = teamId;
    save();
    broadcast();
    res.json({ ok: true, winnerTeamId: teamId, winnerTeamName: teamName(teamId) });
  });

  app.post('/api/admin/awards/:id/reopen', admin, (req, res) => {
    const a = state.awards.find((x) => x.id === req.params.id);
    if (!a) return res.status(404).json({ error: '존재하지 않는 상입니다.' });
    a.decided = false;
    a.winnerTeamId = null;
    save();
    broadcast();
    res.json({ ok: true });
  });

  app.post('/api/admin/reset-votes', admin, (req, res) => {
    state.votes = [];
    state.awards.forEach((a) => {
      a.decided = false;
      a.winnerTeamId = null;
    });
    save();
    broadcast();
    res.json({ ok: true });
  });

  return { app, reset, publicView, seed, get state() {
    return state;
  } };
}

module.exports = { createApp, seed, normalize };
