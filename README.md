# Pulse Desk

BlueprintJS 프런트엔드와 Express + SQLite 백엔드를 함께 둔 풀스택 스타터다.

## 구성

- 프런트엔드: React + Vite + BlueprintJS
- 백엔드: Express
- 데이터베이스: SQLite (`node:sqlite`)

## 실행

```bash
npm install
npm run dev
```

- 프런트엔드: `http://localhost:6004`
- 백엔드 API: `http://localhost:60041/api`

`최신 캐시값` 위성 데이터를 쓰려면 `.env`에 `Space-Track` 계정을 넣어야 한다.

```bash
SPACE_TRACK_IDENTITY=your-space-track-email-or-identity
SPACE_TRACK_PASSWORD=your-space-track-password
```

## 원샷 스크립트

```bash
./one-shot-setup.sh
./one-shot-sartup.sh
./one-shot-stop.sh
```

- `one-shot-setup.sh`: 최초 셋업, `.env` 기본 생성, 의존성 설치
- `one-shot-sartup.sh`: 프런트와 백엔드 개발 서버를 백그라운드 기동
- `one-shot-stop.sh`: 위 스크립트로 띄운 서버 종료

로그와 PID 파일은 `.run/` 아래에 생성된다.

## 프로덕션 빌드

```bash
npm run build
npm start
```

프로덕션에서는 Express가 `dist` 정적 파일과 API를 함께 서빙한다.

## 메모

- 기본 바인딩 호스트는 `127.0.0.1`이다.
- 외부에서 접근 가능하게 띄우려면 `HOST=0.0.0.0 npm start`처럼 실행하면 된다.
- SQLite는 Node 24의 `node:sqlite`를 사용하므로 시작 시 experimental 경고가 한 번 출력될 수 있다.
- 좌측 `Orbit Track` 탭은 `CesiumJS + satellite.js` 기반이며, `하드코딩` 또는 `Space-Track` 최신 캐시값을 선택해 한국 상업위성 궤적을 렌더링한다.
