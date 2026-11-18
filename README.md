# 러시아어 받아쓰기 (PWA)

프레임워크 없는 HTML/CSS/JS 앱. 폰(안드로이드 크롬) 기준.

## 실행
정적 파일 서버면 됩니다. PWA 설치·오프라인은 **HTTPS**(또는 localhost)에서만 동작합니다.

    python3 -m http.server 8000   # → http://localhost:8000

폰에서 쓰려면 GitHub Pages / Netlify / Cloudflare Pages 등에 폴더째 올리고,
크롬 메뉴 → "홈 화면에 추가"(앱 설치).

## 구조
- `data/words.json` — 기본 단어 (회차 → 단어). 첫 실행 때 localStorage로 복사됨.
  `{ sessions: [{ id, title, subtitle, date, words: [{ id, ru, ko, ex?, exKo?, pron? }] }] }`
- `js/store.js` — localStorage 저장 (단어 / 학습기록 / 설정), 가져오기·내보내기
- `js/leitner.js` — Leitner 박스 1~5 (간격: 매번, 1, 2, 4, 8일), 출제 큐
- `js/pad.js` — 필기 캔버스 (펜 압력, 되돌리기, 지우기, PNG 내보내기)
- `js/grader.js` — 채점기 플러그인 자리. `vision` 채점기의 `grade({image, word})`를 구현하고
  `available: true`로 바꾸면 "정답 보기" 때 AI 판단이 제안으로 표시됩니다.
- `sw.js` — 오프라인 캐시. 파일을 수정하면 `VERSION`을 올려야 폰에 반영됩니다.

## 안드로이드 앱 (APK)
`android/` 폴더는 웹 파일을 앱 안에 넣어 WebView로 띄우는 안드로이드 프로젝트입니다 (인터넷 없이 동작).
`main`에 push하면 GitHub Actions(`.github/workflows/android.yml`)가 APK를 만들어 **Releases**에 올립니다.

- 정식 APK를 만들려면 저장소 Settings → Secrets and variables → Actions에
  `KEYSTORE_BASE64`(서명 키 파일을 base64로), `KEYSTORE_PASSWORD`를 넣어야 합니다.
  없으면 테스트용(debug) APK만 Actions 결과물(Artifacts)로 만들어집니다.
- 같은 서명 키로 만든 APK를 설치해야 기존 기록을 유지한 채 업데이트됩니다. 키 파일은 따로 잘 보관하세요.
