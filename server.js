const path = require('path');
const { createApp } = require('./app');

const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin1234';

const { app } = createApp({
  adminPassword: ADMIN_PASSWORD,
  dataFile: path.join(__dirname, 'data.json'),
  staticDir: path.join(__dirname, 'public'),
});

app.listen(PORT, () => {
  console.log(`\n  ✦ 바사해 2026 — 투표 서버가 시작되었습니다`);
  console.log(`  ✦ http://localhost:${PORT}`);
  console.log(`  ✦ 관리자 비밀번호: ${ADMIN_PASSWORD} (환경변수 ADMIN_PASSWORD로 변경 가능)\n`);
});
