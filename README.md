# THE AWARDS — 시상식 실시간 투표 웹앱

아르데코(Art Deco) 감성의 시상식 투표 웹앱. 관리자가 상장·팀을 등록하고,
게스트는 소속 팀으로 입장해 상별로 투표하며, 결과는 막대그래프로 실시간
반영됩니다. "최종 결정"을 누르면 컨페티와 함께 수상 팀이 발표됩니다.

## 실행

```bash
npm install
npm start            # http://localhost:3000
# 포트 변경:  PORT=3210 npm start
# 관리자 비번: ADMIN_PASSWORD=원하는비번 npm start  (기본값 admin1234)
```

## 화면

| 경로            | 설명                                                       |
| --------------- | ---------------------------------------------------------- |
| `/`             | 랜딩 — 게스트/결과/관리자 입구                              |
| `/vote.html`    | 게스트: 소속 팀 선택(라이트 로그인) → 상별 투표            |
| `/results.html` | 상마다 실시간 막대그래프 + **최종 결정** 발표 화면          |
| `/admin.html`   | 관리자: 상장·팀 등록/수정/삭제, 결정/재개, 투표 초기화      |

## 요구사항 매핑

1. **상장·팀 등록** — `/admin.html` (관리자 비밀번호 필요)
2. **게스트 투표** — `/vote.html`. 소속 팀을 체크하고 입장하는 라이트 로그인,
   본인 팀에는 투표 불가, 상별 1표(언제든 변경 가능)
3. **실시간 결과 + 발표** — `/results.html`. 상마다 페이지(탭)와 막대그래프가
   Server-Sent Events로 실시간 갱신. "최종 결정" → "축하합니다!!" 컨페티 연출

## 구조

- `server.js` — 실행 진입점(포트/파일 저장/정적 파일)
- `app.js` — Express 앱 팩토리(`createApp`). 상태 격리 → 테스트 용이
- `public/` — 정적 프론트엔드(빌드 불필요, Vanilla JS)
- `data.json` — 런타임 생성되는 영속 저장 파일
- `test/server.test.js` — 엣지 케이스 포함 API 테스트

## 테스트

Kent Beck 식 TDD(레드→그린)로 작성한 엣지 케이스 포함 31개 테스트:

```bash
npm test
```

자기 자신 팀 투표 차단, 재투표(업서트) 중복 집계 방지, 수상 확정 후 투표 잠금,
팀 삭제 시 관련 투표·수상 해제, 0표 자동 결정 금지, 미존재 팀 지정 거부,
동점 결정의 결정성(deterministic) 등을 검증합니다.

## 공개 배포 — 로컬 tmux + Cloudflare Quick Tunnel

GitHub Pages 같은 정적 호스팅은 이 앱의 실시간 백엔드(SSE)를 못 돌립니다.
대신 로컬에서 서버를 띄우고 Cloudflare 터널로 공개 HTTPS URL을 받습니다.
(`cloudflared`, `tmux` 필요: `brew install cloudflared tmux`)

```bash
./start-tunnel.sh      # tmux 세션 'awards' 에 서버+터널(+자동배포) 기동, 공개 URL 출력
./stop-tunnel.sh       # 전체 종료
tmux attach -t awards  # 로그 확인 (분리: Ctrl-b d)
```

- 공개 URL은 `https://<랜덤>.trycloudflare.com` 형태이며 **실행마다 새로 발급**됩니다.
- 고정 도메인이 필요하면 Cloudflare 계정의 Named Tunnel을 쓰세요.

## 자동배포 (push → 자동 반영)

런타임이 로컬 터널이므로, CI(클라우드)와 로컬 자동배포 두 축으로 구성됩니다.

- **CI** — `.github/workflows/ci.yml`: push/PR 마다 GitHub Actions에서 `npm test`(31개) 실행.
- **로컬 자동배포** — `autodeploy.sh`: `origin/main`을 30초마다 감시하다가 새 커밋이
  생기면 `git pull` 후 tmux의 Node 서버만 재시작. cloudflared 터널은 유지되어
  **공개 URL은 그대로**입니다. `start-tunnel.sh`가 remote가 있으면 `deploy` 창에서
  자동 실행합니다.

즉, 코드를 고쳐 `git push` 하면 → CI가 테스트 → 로컬 워처가 받아 서버 재시작.

> 보안 메모: 기본 관리자 비밀번호 `admin1234`는 공개 저장소에 노출됩니다.
> 실제 운영 시 `ADMIN_PASSWORD=...` 환경변수로 바꿔서 실행하세요.
