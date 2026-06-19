'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../app');

/* ---------------- test harness ----------------
   Each test gets a fresh in-memory app (dataFile: null, static disabled)
   seeded with a deterministic fixture so IDs are known up front. */

function fixture() {
  return {
    teams: [
      { id: 'team-a', name: 'A팀' },
      { id: 'team-b', name: 'B팀' },
      { id: 'team-c', name: 'C팀' },
    ],
    awards: [
      { id: 'aw-1', title: '대상', description: '설명1', order: 0, decided: false, winnerTeamId: null },
      { id: 'aw-2', title: '인기상', description: '', order: 1, decided: false, winnerTeamId: null },
    ],
    votes: [],
  };
}

async function withServer(initialState, fn) {
  const { app } = createApp({
    adminPassword: 'pw',
    dataFile: null,
    staticDir: null,
    initialState,
  });
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const J = { 'Content-Type': 'application/json' };
  const ctx = {
    get: (p) => fetch(base + p),
    post: (p, body, headers) =>
      fetch(base + p, { method: 'POST', headers: { ...J, ...headers }, body: JSON.stringify(body || {}) }),
    put: (p, body, headers) =>
      fetch(base + p, { method: 'PUT', headers: { ...J, ...headers }, body: JSON.stringify(body || {}) }),
    del: (p, headers) => fetch(base + p, { method: 'DELETE', headers }),
    state: async () => (await fetch(base + '/api/state')).json(),
    admin: { 'x-admin-pass': 'pw' },
  };
  try {
    await fn(ctx);
  } finally {
    await new Promise((r) => server.close(r));
  }
}

const vote = (a, t, voter, voterTeam) => ({ awardId: a, teamId: t, voterId: voter, voterTeamId: voterTeam });
const awardOf = (st, id) => st.awards.find((a) => a.id === id);

/* ======================= VOTING ======================= */

test('vote · 다른 팀에 투표하면 집계된다', async () =>
  withServer(fixture(), async (c) => {
    const r = await c.post('/api/vote', vote('aw-1', 'team-b', 'v1', 'team-a'));
    assert.equal(r.status, 200);
    const st = await c.state();
    const res = awardOf(st, 'aw-1').results.find((x) => x.teamId === 'team-b');
    assert.equal(res.count, 1);
    assert.equal(awardOf(st, 'aw-1').totalVotes, 1);
  }));

test('vote · 본인 팀에는 투표할 수 없다 (자기투표 차단)', async () =>
  withServer(fixture(), async (c) => {
    const r = await c.post('/api/vote', vote('aw-1', 'team-a', 'v1', 'team-a'));
    assert.equal(r.status, 400);
    assert.match((await r.json()).error, /본인 팀/);
  }));

test('vote · 같은 투표자가 다시 투표하면 교체된다 (중복 집계 없음)', async () =>
  withServer(fixture(), async (c) => {
    await c.post('/api/vote', vote('aw-1', 'team-b', 'v1', 'team-a'));
    await c.post('/api/vote', vote('aw-1', 'team-c', 'v1', 'team-a')); // 같은 voter, 선택 변경
    const st = await c.state();
    const aw = awardOf(st, 'aw-1');
    assert.equal(aw.totalVotes, 1, '총 표는 1이어야 한다');
    assert.equal(aw.results.find((x) => x.teamId === 'team-b').count, 0);
    assert.equal(aw.results.find((x) => x.teamId === 'team-c').count, 1);
  }));

test('vote · 서로 다른 투표자는 누적된다', async () =>
  withServer(fixture(), async (c) => {
    await c.post('/api/vote', vote('aw-1', 'team-b', 'v1', 'team-a'));
    await c.post('/api/vote', vote('aw-1', 'team-b', 'v2', 'team-a'));
    await c.post('/api/vote', vote('aw-1', 'team-b', 'v3', 'team-c'));
    const st = await c.state();
    assert.equal(awardOf(st, 'aw-1').results.find((x) => x.teamId === 'team-b').count, 3);
  }));

test('vote · 존재하지 않는 상이면 404', async () =>
  withServer(fixture(), async (c) => {
    assert.equal((await c.post('/api/vote', vote('nope', 'team-b', 'v1', 'team-a'))).status, 404);
  }));

test('vote · 존재하지 않는 팀이면 400', async () =>
  withServer(fixture(), async (c) => {
    assert.equal((await c.post('/api/vote', vote('aw-1', 'ghost', 'v1', 'team-a'))).status, 400);
  }));

test('vote · voterId 없으면 400 (로그인 필요)', async () =>
  withServer(fixture(), async (c) => {
    const r = await c.post('/api/vote', { awardId: 'aw-1', teamId: 'team-b' });
    assert.equal(r.status, 400);
  }));

test('vote · 소속 팀(voterTeamId) 없으면 400', async () =>
  withServer(fixture(), async (c) => {
    const r = await c.post('/api/vote', { awardId: 'aw-1', teamId: 'team-b', voterId: 'v1' });
    assert.equal(r.status, 400);
  }));

test('vote · 빈 요청 본문이면 404 (상 없음)', async () =>
  withServer(fixture(), async (c) => {
    assert.equal((await c.post('/api/vote', {})).status, 404);
  }));

test('vote · 수상 확정된 상에는 투표 불가 (409)', async () =>
  withServer(fixture(), async (c) => {
    await c.post('/api/vote', vote('aw-1', 'team-b', 'v1', 'team-a'));
    await c.post('/api/admin/awards/aw-1/decide', {}, c.admin);
    const r = await c.post('/api/vote', vote('aw-1', 'team-b', 'v2', 'team-a'));
    assert.equal(r.status, 409);
  }));

test('my-votes · 투표자의 선택을 상별로 돌려주고, 모르는 투표자는 빈 객체', async () =>
  withServer(fixture(), async (c) => {
    await c.post('/api/vote', vote('aw-1', 'team-b', 'v1', 'team-a'));
    assert.deepEqual(await (await c.get('/api/my-votes?voterId=v1')).json(), { 'aw-1': 'team-b' });
    assert.deepEqual(await (await c.get('/api/my-votes?voterId=ghost')).json(), {});
    assert.deepEqual(await (await c.get('/api/my-votes')).json(), {});
  }));

/* ======================= ADMIN AUTH ======================= */

test('admin · 비밀번호 없거나 틀리면 보호 라우트 401', async () =>
  withServer(fixture(), async (c) => {
    assert.equal((await c.post('/api/admin/teams', { name: 'X' })).status, 401);
    assert.equal((await c.post('/api/admin/teams', { name: 'X' }, { 'x-admin-pass': 'wrong' })).status, 401);
  }));

test('admin/login · 틀리면 401, 맞으면 200', async () =>
  withServer(fixture(), async (c) => {
    assert.equal((await c.post('/api/admin/login', { password: 'bad' })).status, 401);
    assert.equal((await c.post('/api/admin/login', { password: 'pw' })).status, 200);
  }));

/* ======================= TEAMS ======================= */

test('teams · 추가된다', async () =>
  withServer(fixture(), async (c) => {
    const r = await c.post('/api/admin/teams', { name: 'D팀' }, c.admin);
    assert.equal(r.status, 200);
    const st = await c.state();
    assert.ok(st.teams.some((t) => t.name === 'D팀'));
  }));

test('teams · 공백 이름은 400', async () =>
  withServer(fixture(), async (c) => {
    assert.equal((await c.post('/api/admin/teams', { name: '   ' }, c.admin)).status, 400);
  }));

test('teams · 중복 이름은 409', async () =>
  withServer(fixture(), async (c) => {
    assert.equal((await c.post('/api/admin/teams', { name: 'A팀' }, c.admin)).status, 409);
  }));

test('teams · 팀 삭제 시 그 팀에 대한/그 팀이 한 투표가 모두 사라지고, 수상 이력도 해제된다', async () =>
  withServer(fixture(), async (c) => {
    await c.post('/api/vote', vote('aw-1', 'team-b', 'v1', 'team-a')); // team-b 가 받은 표
    await c.post('/api/vote', vote('aw-1', 'team-a', 'v2', 'team-b')); // team-b 가 한 표
    await c.post('/api/admin/awards/aw-1/decide', { teamId: 'team-b' }, c.admin); // team-b 수상
    const r = await c.del('/api/admin/teams/team-b', c.admin);
    assert.equal(r.status, 200);

    const st = await c.state();
    assert.deepEqual(st.teams.map((t) => t.name), ['A팀', 'C팀']);
    const aw = awardOf(st, 'aw-1');
    assert.equal(aw.totalVotes, 0, '관련 투표가 모두 제거되어야 한다');
    assert.equal(aw.decided, false, '수상 결정이 해제되어야 한다');
    assert.equal(aw.winnerTeamId, null);
  }));

/* ======================= AWARDS ======================= */

test('awards · 추가된다', async () =>
  withServer(fixture(), async (c) => {
    const r = await c.post('/api/admin/awards', { title: '신설상', description: '설명' }, c.admin);
    assert.equal(r.status, 200);
    assert.ok((await c.state()).awards.some((a) => a.title === '신설상'));
  }));

test('awards · 빈 제목은 400', async () =>
  withServer(fixture(), async (c) => {
    assert.equal((await c.post('/api/admin/awards', { title: '  ' }, c.admin)).status, 400);
  }));

test('awards · 제목/설명 수정', async () =>
  withServer(fixture(), async (c) => {
    await c.put('/api/admin/awards/aw-2', { title: '인기상(수정)', description: '새설명' }, c.admin);
    const aw = awardOf(await c.state(), 'aw-2');
    assert.equal(aw.title, '인기상(수정)');
    assert.equal(aw.description, '새설명');
  }));

test('awards · 수정 시 빈 제목은 400', async () =>
  withServer(fixture(), async (c) => {
    assert.equal((await c.put('/api/admin/awards/aw-1', { title: '   ' }, c.admin)).status, 400);
  }));

test('awards · 삭제 시 해당 상의 투표가 제거되고 순서가 재정렬된다', async () =>
  withServer(fixture(), async (c) => {
    await c.post('/api/vote', vote('aw-1', 'team-b', 'v1', 'team-a'));
    await c.del('/api/admin/awards/aw-1', c.admin);

    assert.deepEqual(await (await c.get('/api/my-votes?voterId=v1')).json(), {}, '삭제된 상의 투표는 사라진다');
    let titles = (await c.state()).awards.map((a) => a.title);
    assert.deepEqual(titles, ['인기상']);

    await c.post('/api/admin/awards', { title: '신설상' }, c.admin);
    titles = (await c.state()).awards.map((a) => a.title);
    assert.deepEqual(titles, ['인기상', '신설상'], '재정렬된 순서대로 노출된다');
  }));

test('awards · 없는 id에 수정/결정/재개 시 404', async () =>
  withServer(fixture(), async (c) => {
    assert.equal((await c.put('/api/admin/awards/ghost', { title: 'x' }, c.admin)).status, 404);
    assert.equal((await c.post('/api/admin/awards/ghost/decide', {}, c.admin)).status, 404);
    assert.equal((await c.post('/api/admin/awards/ghost/reopen', {}, c.admin)).status, 404);
  }));

/* ======================= DECIDE / REOPEN / RESET ======================= */

test('decide · 최다 득표 팀을 자동으로 수상자로 정한다', async () =>
  withServer(fixture(), async (c) => {
    await c.post('/api/vote', vote('aw-1', 'team-b', 'v1', 'team-a'));
    await c.post('/api/vote', vote('aw-1', 'team-b', 'v2', 'team-c'));
    await c.post('/api/vote', vote('aw-1', 'team-c', 'v3', 'team-a'));
    const r = await c.post('/api/admin/awards/aw-1/decide', {}, c.admin);
    assert.equal(r.status, 200);
    const body = await r.json();
    assert.equal(body.winnerTeamId, 'team-b');
    assert.equal(body.winnerTeamName, 'B팀');
    assert.equal(awardOf(await c.state(), 'aw-1').decided, true);
  }));

test('decide · 동점이면 팀 순서상 앞선 팀이 결정된다 (결정적)', async () =>
  withServer(fixture(), async (c) => {
    await c.post('/api/vote', vote('aw-2', 'team-a', 'v1', 'team-c'));
    await c.post('/api/vote', vote('aw-2', 'team-b', 'v2', 'team-c'));
    const body = await (await c.post('/api/admin/awards/aw-2/decide', {}, c.admin)).json();
    assert.equal(body.winnerTeamId, 'team-a');
  }));

test('decide · teamId를 명시하면 최다 득표와 무관하게 그 팀으로 결정', async () =>
  withServer(fixture(), async (c) => {
    await c.post('/api/vote', vote('aw-1', 'team-b', 'v1', 'team-a')); // 최다는 team-b
    const body = await (await c.post('/api/admin/awards/aw-1/decide', { teamId: 'team-c' }, c.admin)).json();
    assert.equal(body.winnerTeamId, 'team-c');
  }));

/* ---- EDGE CASES (the spec the original code did not yet satisfy) ---- */

test('decide · [엣지] 표가 하나도 없으면 자동 결정 불가 (400)', async () =>
  withServer(fixture(), async (c) => {
    const r = await c.post('/api/admin/awards/aw-1/decide', {}, c.admin);
    assert.equal(r.status, 400, '0표 상태에서 임의의 첫 팀을 수상시키면 안 된다');
  }));

test('decide · [엣지] 명시한 teamId가 존재하지 않으면 400', async () =>
  withServer(fixture(), async (c) => {
    await c.post('/api/vote', vote('aw-1', 'team-b', 'v1', 'team-a'));
    const r = await c.post('/api/admin/awards/aw-1/decide', { teamId: 'ghost' }, c.admin);
    assert.equal(r.status, 400, '없는 팀을 수상자로 지정할 수 없다');
  }));

test('reopen · 결정을 해제하면 투표가 다시 열린다', async () =>
  withServer(fixture(), async (c) => {
    await c.post('/api/vote', vote('aw-1', 'team-b', 'v1', 'team-a'));
    await c.post('/api/admin/awards/aw-1/decide', {}, c.admin);
    await c.post('/api/admin/awards/aw-1/reopen', {}, c.admin);
    const aw = awardOf(await c.state(), 'aw-1');
    assert.equal(aw.decided, false);
    assert.equal(aw.winnerTeamId, null);
    assert.equal((await c.post('/api/vote', vote('aw-1', 'team-b', 'v2', 'team-a'))).status, 200);
  }));

test('reset-votes · 모든 투표와 결정을 초기화한다', async () =>
  withServer(fixture(), async (c) => {
    await c.post('/api/vote', vote('aw-1', 'team-b', 'v1', 'team-a'));
    await c.post('/api/admin/awards/aw-1/decide', {}, c.admin);
    await c.post('/api/admin/reset-votes', {}, c.admin);
    const st = await c.state();
    assert.equal(awardOf(st, 'aw-1').totalVotes, 0);
    assert.equal(awardOf(st, 'aw-1').decided, false);
  }));

/* ======================= PUBLIC VIEW ======================= */

test('state · 집계/총표/수상팀명/순서를 올바르게 노출한다', async () =>
  withServer(fixture(), async (c) => {
    await c.post('/api/vote', vote('aw-1', 'team-b', 'v1', 'team-a'));
    await c.post('/api/vote', vote('aw-1', 'team-b', 'v2', 'team-a'));
    await c.post('/api/vote', vote('aw-1', 'team-c', 'v3', 'team-b'));
    await c.post('/api/admin/awards/aw-1/decide', { teamId: 'team-b' }, c.admin);
    const st = await c.state();
    const aw = awardOf(st, 'aw-1');
    assert.equal(aw.totalVotes, 3);
    assert.equal(aw.results.find((x) => x.teamId === 'team-a').count, 0);
    assert.equal(aw.results.find((x) => x.teamId === 'team-b').count, 2);
    assert.equal(aw.results.find((x) => x.teamId === 'team-c').count, 1);
    assert.equal(aw.winnerTeamName, 'B팀');
    assert.deepEqual(st.awards.map((a) => a.title), ['대상', '인기상'], '상은 order대로 정렬');
  }));
