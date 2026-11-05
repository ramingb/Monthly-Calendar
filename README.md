# 먼슬리 캘린더 🗓

한국 달력 기준 월간 캘린더입니다. 별도 설치 없이 브라우저에서 바로 동작합니다.

## 기능

- **일~토 순서** 월간 보기, 일요일·공휴일은 빨간색 / 토요일은 파란색
- **대한민국 공휴일 자동 표시**
  - 신정, 삼일절, 어린이날, 현충일, 제헌절(2026~), 광복절, 개천절, 한글날, 성탄절
  - 설날·추석 연휴, 부처님오신날 (음력 날짜 2024~2030년 내장)
  - **대체공휴일 자동 계산**, 선거일·임시공휴일
  - 노동절·어버이날·스승의 날 등 기념일은 회색으로 표시
- **약속 / 할 일 추가·수정·삭제** (시간, 메모 포함)
- **완료 체크** — 체크하면 취소선 표시
- **새로고침해도 유지** — 브라우저 저장소(localStorage)에 자동 저장
- **카카오톡 알림** — 당일 / 1·2·3일 전 / 1주일 전 중 선택하면 매일 아침 8시에 카톡 "나와의 채팅"으로 알림
- 다가오는 7일 일정 목록, JSON 백업/복원, 다크 모드, 모바일 화면 지원
- 키보드 ← → 로 이전/다음 달 이동

## 실행

`index.html`을 브라우저로 열면 됩니다. 휴대폰에서도 쓰려면 GitHub Pages로 배포하세요.

1. 저장소 **Settings → Pages**
2. Source: `Deploy from a branch`, Branch: `main` / `/ (root)` 선택 후 저장
3. 잠시 후 `https://<계정>.github.io/<저장소>/` 에서 접속

## 카카오톡 알림 설정

브라우저가 닫혀 있어도 알림을 받을 수 있도록 **GitHub Actions**가 매일 08:00(KST)에
`data/schedule.json`을 읽어 알림 대상 일정을 카톡으로 보냅니다.

```
[캘린더 웹] --(자동 업로드)--> data/schedule.json --(매일 8시 GitHub Actions)--> 카카오톡 나와의 채팅
```

### 1) 카카오 앱 만들기 (최초 1회)

1. [카카오 디벨로퍼스](https://developers.kakao.com) 로그인 → **내 애플리케이션 → 애플리케이션 추가하기**
2. **앱 키**에서 `REST API 키` 복사
3. **카카오 로그인** 활성화 ON, **Redirect URI**에 `https://localhost` 등록
4. **동의항목**에서 `카카오톡 메시지 전송(talk_message)` 을 "선택 동의"로 설정
5. (선택) **보안 → Client Secret**을 사용 중이면 값을 복사해 두기

### 2) 리프레시 토큰 발급 (최초 1회)

브라우저에서 아래 주소로 접속해 동의합니다. (`<REST_API_KEY>` 교체)

```
https://kauth.kakao.com/oauth/authorize?client_id=<REST_API_KEY>&redirect_uri=https://localhost&response_type=code&scope=talk_message
```

이동된 주소 `https://localhost/?code=XXXX` 에서 `code` 값을 복사해 바로(10분 이내) 실행합니다.

```bash
node scripts/kakao-get-token.js <REST_API_KEY> <code>
```

### 3) GitHub Secrets 등록

저장소 **Settings → Secrets and variables → Actions**

| 이름 | 값 |
| --- | --- |
| `KAKAO_REST_API_KEY` | REST API 키 |
| `KAKAO_REFRESH_TOKEN` | 2)에서 출력된 리프레시 토큰 |
| `KAKAO_CLIENT_SECRET` | (Client Secret 사용 시에만) |

알림 메시지의 "캘린더 열기" 버튼 주소를 바꾸려면 **Variables**에 `CALENDAR_URL`을 등록하세요.
(기본값: GitHub Pages 주소)

### 4) 캘린더와 저장소 연결

1. [GitHub 토큰 생성](https://github.com/settings/personal-access-tokens/new) — Fine-grained, 이 저장소만 선택,
   **Repository permissions → Contents: Read and write**
2. 캘린더 화면 **⚙︎ 설정**에 저장소(`owner/repo`), 브랜치(`main`), 토큰 입력 후 저장
3. 이후 일정을 추가·수정·완료할 때마다 `data/schedule.json`에 자동 업로드됩니다.
   다른 기기에서 같은 설정을 하면 열 때 최신 일정을 불러옵니다.

### 5) 테스트

**Actions → 카카오톡 일정 알림 → Run workflow** 로 바로 실행할 수 있습니다.
`dry_run`을 체크하면 전송 없이 메시지 내용만 로그로 확인합니다.

로컬 테스트:

```bash
TODAY=2026-11-05 DRY_RUN=1 node scripts/send-kakao-reminders.js
```

### 알림 규칙

- 일정의 "카톡 알림"이 `1일 전`이면 그 전날 아침 8시에 알림
- **완료 체크된 일정은 알림을 보내지 않음**
- 같은 날 알림이 여러 개면 한 메시지로 묶어서 전송 (200자 초과 시 나눠서 전송)

```
🗓 11/5(목) 일정 알림
✅ [오늘] 11/5(목) 보고서 제출
📌 [내일] 11/6(금) 14:00 치과 예약
📌 [D-3] 11/8(일) 엄마 생신
```

### 주의사항

- **공개 저장소**라면 `data/schedule.json`(일정 내용)도 공개됩니다. 개인 일정은 비공개 저장소를 권장합니다.
  (비공개 저장소의 GitHub Pages는 유료 플랜 필요 — 이 경우 `index.html`을 PC에서 직접 열어 사용해도 됩니다.)
- 카카오 리프레시 토큰은 약 2개월간 유효합니다. 만료가 가까워지면 Actions 실행 결과에 경고가 표시되니
  2)~3) 단계를 다시 진행해 시크릿을 교체하세요.
- GitHub 토큰은 이 브라우저의 localStorage에만 저장되며 GitHub API 호출에만 사용됩니다.
- GitHub Actions 예약 실행은 서버 사정에 따라 수 분~수십 분 늦어질 수 있습니다.

## 공휴일 데이터 갱신

`js/holidays.js`의 `LUNAR`(음력 공휴일 양력 날짜)와 `SPECIAL`(임시공휴일·선거일)에
새 연도를 추가하면 됩니다. 대체공휴일은 자동 계산됩니다.

## 파일 구조

```
index.html                         화면
css/style.css                      스타일 (라이트/다크)
js/holidays.js                     공휴일·대체공휴일 계산 (브라우저/Node 공용)
js/app.js                          캘린더·일정·저장·GitHub 동기화
data/schedule.json                 알림용 일정 데이터 (앱이 자동 업로드)
scripts/send-kakao-reminders.js    카톡 알림 전송 스크립트
scripts/kakao-get-token.js         카카오 리프레시 토큰 최초 발급
.github/workflows/kakao-reminder.yml  매일 08:00 KST 실행
```
