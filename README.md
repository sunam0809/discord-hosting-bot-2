# 🤖 Discord Hosting Bot

고객이 키를 받아 Discord 패널에서 코드를 즉시 호스팅할 수 있는 봇입니다.

## 기능

| 명령어 | 설명 |
|--------|------|
| `/키생성` | 유효기간 설정 가능한 접근 키 생성 (관리자 전용) |
| `/창띄우기` | 채널에 호스팅 패널 게시 (관리자 전용) |

### 패널 기능
- **언어 선택** → 키 입력 + 코드 붙여넣기 → 즉시 호스팅 시작
- **내 호스팅 기록** → 재시작 / 수정 / 중지 / 로그 확인
- 키 만료 시 자동 호스팅 종료

### 지원 언어
- 🟨 JavaScript (Node.js)
- 🐍 Python 3

---

## 설치 & 실행

### 1. 의존성 설치
```bash
npm install
```

### 2. 환경변수 설정
`.env.example`을 `.env`로 복사하고 값 입력:
```
DISCORD_BOT_TOKEN=봇토큰
DISCORD_CLIENT_ID=애플리케이션ID
PORT=3000
```

### 3. 슬래시 명령어 등록 (최초 1회)
```bash
npm run deploy-commands
```

### 4. 봇 실행
```bash
npm start
```

---

## Render 배포

1. GitHub 레포를 Render에 연결
2. **Environment** → 환경변수 추가:
   - `DISCORD_BOT_TOKEN`
   - `DISCORD_CLIENT_ID`
3. **Start Command**: `npm start`
4. 배포 후 서비스 URL을 UptimeRobot에 등록 (`/health` 엔드포인트)

## UptimeRobot 설정

1. [UptimeRobot](https://uptimerobot.com) 접속 → 모니터 추가
2. **Monitor Type**: HTTP(s)
3. **URL**: `https://your-render-url.onrender.com/health`
4. **Interval**: 5분
5. 이걸로 봇이 영원히 꺼지지 않습니다 ✅

---

## 관리자 ID
`1531640611977957446` 만 `/키생성`, `/창띄우기` 사용 가능
