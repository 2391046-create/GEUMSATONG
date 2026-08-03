# 금사통 · 금융 기사 통역가

URL을 붙여넣으면 기사 본문을 가져와서, 내가 고른 금융 난이도(초급/중급/고급)에 맞춰
① 어려운 금융 용어를 자동으로 찾아 설명해주고,
② 기사 속 인과관계를 흐름도로 그려주고,
③ 기사에 등장한 기업을 DART(전자공시시스템)에서 조회해 재무 그래프·최근 공시로 보여주고,
④ DART 재무 데이터 + 뉴스 감성분석 기반 AI로 그 기업의 **다음 분기 재무 위험 확률**까지 예측해주는
1인 프로젝트용 웹앱입니다.

(이전 이름: 원장(LEDGER))

---

## 핵심 기술 — 난이도별 용어 번역 + 온톨로지

이 프로젝트의 본질은 **"같은 금융 용어라도 읽는 사람의 수준에 따라 다르게 설명한다"**는 것과, 그걸 가능하게 하는 **금융 용어 온톨로지(분류 체계)**입니다.

### 1) 난이도별 번역
기사 본문에서 금융 용어를 찾아 초급/중급/고급 세 가지 설명을 동시에 생성합니다 (`services/llm.js`).
- **초급**: 금리, ETF처럼 기초 용어까지 전부 설명
- **중급**: 기초 용어는 건너뛰고 한 단계 더 들어간 용어만 설명
- **고급**: ETF·레버리지·PER 같은 업계 상식은 생략하고, 법률·회계·구조화상품처럼 정말 낯선 용어만 설명

한 번의 LLM 호출로 세 난이도 설명을 동시에 받아오기 때문에(`LEVEL_CONFIG`), 사용자가 스마트 통역가 패널에서 초급→고급 탭을 눌러도 추가 API 호출 없이 즉시 전환됩니다.

### 2) 온톨로지 (금융 용어 분류 체계)
개별 용어를 "주식·ETF · 금리·대출 · 예·적금 · 환율·해외여행 · 부동산 · 기업실적 · 연금 · 세금" 등 상위 카테고리로 묶는 분류 체계가 `services/categories.js`의 `categorize()` / `CATEGORIES`에 정의되어 있습니다. 이 온톨로지는 한 곳에만 쓰이지 않고 서비스 전반에서 재사용됩니다.
- 기사 하나에 여러 용어가 섞여 있을 때, LLM이 카테고리를 안 주거나 애매하게 주면 등장한 용어들을 다수결로 집계해 대표 카테고리를 결정 (`server.js`의 `resolveCategory`)
- 사용자가 어떤 카테고리 용어에서 자주 설명을 필요로 했는지 집계해 "취약분야" 산출 (`services/literacy.js`)
- 온보딩에서 고른 관심분야, 기사 카테고리에 맞춰 추천 기사 매칭
- 기사 카테고리에 맞는 은행 상품 추천 (`services/bankProducts.js`)

즉, 용어 하나하나의 뜻풀이(미시적 번역)와 그 용어들을 묶는 분류 체계(거시적 온톨로지)가 맞물려서, "이 기사는 어떤 분야고, 나는 어떤 분야에 약한가"까지 자동으로 도출되는 구조입니다.

---

## 구성

```
finance-reader/
  server.js                 Express 서버 + API 라우트
  predict.py                 AI 위험 예측 실시간 추론 스크립트 (server.js가 기사 열람 시 실행)
  best_risk_model.pkl        학습된 위험 예측 모델
  final_dataset.csv          모델 학습에 쓰인 최종 데이터셋 (DART 재무 + 감성점수)
  alert_thresholds.json      투트랙(1차 주의 / 2차 고위험) 경보 임계값 (train_model.py가 자동 생성)
  services/
    articleExtractor.js      URL → 기사 본문 추출 (Readability 우선, 실패 시 셀렉터 폴백)
    llm.js                    Groq(무료) API 호출 (용어설명/흐름도/추천, 난이도별 LEVEL_CONFIG)
    categories.js              금융 용어 온톨로지(카테고리 분류 체계)
    dart.js                    DART Open API 연동 (기업 재무/공시)
    newsFeed.js                네이버 뉴스 스크레이핑 (오늘의 핫 기사 / 추천)
    literacy.js                금융 이해도 점수·레벨·취약분야 계산
    bankProducts.js            카테고리별 금융상품 추천
    auth.js                    회원가입/로그인/세션
    leaderboard.js              전국 순위 계산
    userStore.js                사용자별 데이터 저장 (data/users/<userId>.json)
  public/                    프론트엔드 (순수 HTML/CSS/JS, 빌드 도구 없음)
    index.html
    style.css
    app.js
  ml_pipeline/                AI 위험 예측 모델 학습 파이프라인 (서비스 실행에는 필수 아님, 재학습할 때만 사용)
    dart_prep.py               1단계: DART 재무데이터 수집
    merge_data.py               2단계: 뉴스 감성분석 결합 → final_dataset.csv
    train_model.py               3단계: 모델 학습 + 투트랙 임계값 산출 → best_risk_model.pkl, alert_thresholds.json
    news_sentiment.py            감성분석 실험용 스크립트
    requirements.txt
  data/                       런타임에 자동 생성되는 캐시/이력 파일
  .env                        API 키 (직접 생성, git에 올리지 않음)
  .env.example
  .gitignore
```

## 1. 필요한 것

- **Node.js 18 이상**
- **Groq API 키 (무료)** — https://console.groq.com 에서 신용카드 없이 발급 (용어 설명·흐름도·추천·뉴스 감성분석에 사용)
  1. 구글/깃허브 계정으로 가입
  2. 좌측 메뉴 **API Keys** → **Create API Key**
  3. `gsk_`로 시작하는 키 복사
  - 무료 한도: 분당 30회, 일 1,000회 정도 (모델별로 다름). 개인 프로젝트로 충분하고, 초과하면 잠깐 대기 후 자동 리셋됩니다.
- **DART Open API 키 (무료)** — https://opendart.fss.or.kr 에서 발급 (기업 재무/공시 조회, AI 위험 예측 모델 학습 데이터 수집에 사용). 발급 안 해도 나머지 기능(용어 설명, 흐름도, 추천, 핫기사)은 정상 작동하고, DART·위험률 예측 버튼만 비활성화됩니다.
- **네이버 Open API HUB Client ID & Client Secret (무료)** — NAVER API HUB 에서 발급 (맞춤형 AI 기사 추천 및 핫뉴스 기사 수집에 사용)
  1. Application 등록 후 NAVER 검색 → 뉴스 API 상품 추가
  2. 무료 한도: 일 25,000회 (월 최대 775,000회 제공)
  3. 인증 정보의 Client ID 및 Client Secret을 환경변수에 등록 (NAVER_API_KEY_ID, NAVER_API_KEY)
- **(선택) Python 3.10+** — `best_risk_model.pkl`을 새로 학습시키고 싶을 때만 필요합니다. 서비스를 그냥 실행만 할 거라면(모델 파일이 이미 저장소에 있다면) 설치 안 해도 됩니다. `predict.py`는 매 예측 요청마다 Python을 실행하므로, **서비스를 실제로 배포/운영하려면 Python 3는 필수**입니다.

> ⚠️ `DART_API_KEY`는 두 군데에서 쓰입니다 — 서비스 실행 중 DART 모달 조회(`services/dart.js`)와, `ml_pipeline/dart_prep.py`로 학습 데이터를 새로 수집할 때. `predict.py`(실시간 위험률 예측)는 이미 학습된 `final_dataset.csv`/`best_risk_model.pkl`만 읽으므로 예측 자체에는 DART API를 호출하지 않습니다.

## 2. 설치 및 실행

```bash
cd finance-reader
npm install
cp .env.example .env
```

`.env` 파일을 열어 키를 채워주세요:

```
GROQ_API_KEY=gsk_...
GROQ_MODEL=llama-3.3-70b-versatile
DART_API_KEY=발급받은키
PORT=3000
NAVER_API_KEY_ID=
NAVER_API_KEY=
```

서버 실행:

```bash
npm start
```

브라우저에서 `http://localhost:3000` 접속.

### (선택) AI 위험 예측 모델 준비/재학습

저장소에 `best_risk_model.pkl`, `final_dataset.csv`, `alert_thresholds.json`이 이미 포함되어 있다면 이 단계는 건너뛰어도 됩니다. 최신 공시로 다시 학습하고 싶다면:

```bash
cd ml_pipeline
python -m venv .venv && source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
python dart_prep.py      # DART 데이터 수집 (기업 수·기간에 따라 수 분~수십 분)
python merge_data.py     # 뉴스 감성분석 결합
python train_model.py    # 모델 학습 + 투트랙 임계값 산출
```

`predict.py`는 `ml_pipeline/` 폴더와 프로젝트 루트를 모두 자동으로 찾으므로, 결과 파일을 수동으로 옮길 필요는 없습니다.

## 3. 사용 흐름

1. **로그인/회원가입** — 아이디+비밀번호로 가입, 로그인 시 토큰이 발급되어 이후 모든 요청에 자동으로 실려갑니다.
2. **온보딩 (최초 1회)** — "평소 금융기사를 어떻게 읽으세요?"로 난이도(초급/중급/고급)를 정하고, 관심분야(주식·ETF, 금리·대출 등, 온톨로지 카테고리와 동일)를 선택합니다.
3. **홈** — 기사 URL을 붙여넣거나 "기사 본문 직접 붙여넣기"로 텍스트를 바로 넣을 수 있습니다. 관심분야·읽은 이력 기반 "오늘의 추천 기사"와, 점수·레벨·취약분야를 보여주는 "나의 금융 이해도" 패널이 있습니다.
4. **기사 리더** — 원문 기사(제목·기자명·날짜·대표사진·문단 구조)를 그대로 보여주고, 난이도에 맞는 금융 용어만 밑줄로 표시합니다. 오른쪽 스마트 통역가 패널에서 감지된 용어 전체 목록을 보고, 난이도 탭을 바꿔가며 볼 수 있습니다.
   - **📈 기사 흐름 보기** — 기사에서 뽑아낸 원인→결과 관계를 SVG 흐름도로 표시
   - **🏛 OO DART** — 기사에 언급된 기업의 DART 재무 그래프·최근 공시 조회 (기업마다 버튼 따로)
   - **🤖 OO 위험률 예측** — 같은 기업의 AI 재무 위험 예측 (안전 / 1차 주의 / 2차 고위험, 판단 근거 포함)
5. **마이페이지 / 내 학습현황** — 저장한 기사, 최근 조회 상품, 레벨 진행도, 학습 추이 그래프, 전국 순위 확인.

### 금융 이해도 점수 산정 방식
`점수 = min(100, 총 읽은 기사 수 × 5 + 총 익힌 용어 수 × 2)` 로 계산하고, 점수 구간에 따라 4단계 레벨(금융 입문자 → 초보 투자자 → 탐색가 → 고수)로 표시합니다. "취약분야"는 온톨로지 카테고리 기준으로, 지금까지 설명이 필요했던 용어들을 집계해 가장 자주 등장한 분야를 보여줍니다. 계산 로직은 `services/literacy.js`.

---

## AI 재무 위험 예측

기사에 언급된 기업의 DART 재무제표 시계열과 뉴스 감성 점수를 결합한 머신러닝 모델로, **"현재는 안전한 기업이 다음 분기에 위험해질 확률"**을 예측하는 기능입니다.

- **데이터**: DART Open API로 2015~2025년, 100여 개 기업(우량 대기업 + 실제 재무위기 이력이 있는 조선·해운·건설 업종)의 분기 재무제표 수집 (`ml_pipeline/dart_prep.py`)
- **감성분석**: Groq API(Llama 3.3 70B)로 기업별 최근 뉴스 논조를 -1.0~+1.0 점수로 정량화해 결합 (`ml_pipeline/merge_data.py`)
- **모델링**: "이미 위험한 기업이 다음도 위험할 확률"은 라벨-피처 정보 중복으로 예측이 부풀려 보이는 문제가 있어, **"현재 안전 → 다음 분기 위험 전환"만 예측**하도록 문제를 재정의. LightGBM/XGBoost/RandomForest를 GroupKFold(기업 단위 교차검증)로 비교해 자동 선정 (`ml_pipeline/train_model.py`)
- **투트랙(Two-Track) 경보**: Out-of-Fold 예측 확률을 0.02 단위로 세밀 스캔해, 목적이 다른 두 임계값을 자동 산출
  - **1차 주의 경보** — 넓은 안전망 (Recall 우선, 위험 기업을 최대한 놓치지 않음)
  - **2차 고위험 경보** — 정밀 알림 (F1 최대, 오탐을 줄여 신뢰도 높은 경고)
  - 재학습 시 `alert_thresholds.json`이 자동 갱신되어, 코드 수정 없이 새 임계값이 서비스에 바로 반영됩니다.
- **실시간 서빙**: 사용자가 "위험률 예측" 버튼을 누르면 Node 서버가 `predict.py`를 실행해 그 기업의 최신 데이터로 확률을 계산, 원형 게이지(안전/1차 주의/2차 고위험 3색 구간)로 즉시 표시합니다.

⚠️ 이 예측은 통계 모델 기반 참고 지표이며 투자 자문이 아닙니다. 위험 전환 사례 데이터가 아직 많지 않아(수십 건 수준) 예측 신뢰구간이 넓다는 점도 알아두세요.

---

## 4. 참고 / 한계

### 로그인 · 실제 가입자 기준 전국 순위
- **회원가입/로그인**: 아이디+비밀번호로 가입(`bcryptjs`로 해시 저장), 로그인하면 토큰 발급 → 브라우저 `localStorage`에 저장 → 이후 모든 API 요청에 `Authorization: Bearer <토큰>`으로 인증.
- **데이터 완전 분리**: 모든 읽기 이력·저장한 기사·이해도 점수·프로필이 로그인한 사용자별로 `data/users/<userId>.json`에 따로 저장됩니다. DART 조회, 위험률 예측, 오늘의 핫 기사만 로그인 없이도 접근 가능(공용 데이터라 개인화가 필요 없음).
- **전국 순위(`/api/leaderboard`)**: 이 서버에 **실제로 가입된 사용자들**의 진짜 점수를 계산해서 순위를 매깁니다. 가짜 사용자나 추정치는 전혀 없습니다.

⚠️ **꼭 알아두셔야 할 점**: `npm start`로 본인 PC에서만 띄우면, 그 서버에 가입할 수 있는 사람은 사실상 본인뿐이라 "전국 순위"가 통계적으로 의미 있으려면 **여러 사람이 접속 가능한 곳에 배포**해야 해요 (Render, Railway, 개인 클라우드 서버 등). 다만 AI 위험 예측 기능은 Node가 Python을 직접 실행하는 구조라, 배포 환경에 Node·Python이 둘 다 있어야 합니다.

### 전면 UI 개편 + 마이페이지 + 학습현황 대시보드
- **테마**: 네이비(#1B2044) + 크림(#F4F2EB) 배경 + 화이트 카드 + 컬러 태그 톤.
- **온보딩**: 좌측 네이비 소개 패널 + 우측 2단계 폼(이해수준 라디오 + 관심분야 태그).
- **마이페이지**: 프로필 카드, 저장한 기사(카테고리 필터), 최근 조회한 금융상품.
- **내 학습현황**: 레벨 링, 연속 학습일수, 누적 용어, 날짜별 점수 추이 꺾은선 그래프(SVG 직접 렌더링), 카테고리별 학습 분포 바, 최근 학습한 용어 태그.
  - ⚠️ 정직하게 밝히면: "이해도 퀴즈 횟수"나 "전국 상위 %"처럼 다른 사용자와 비교하거나 퀴즈 기능이 필요한 지표는 실제로 구현되어 있지 않아 넣지 않았습니다. 지금 나오는 모든 수치는 실제 읽기 이력 기반의 진짜 계산값입니다.
- **스마트 통역가 사이드 패널**: 감지된 용어 전체 목록, 초급/중급/고급 탭 즉시 전환(추가 API 호출 없음), "✓ 이해했어요" 학습 완료 기록.

### DART가 계속 안 될 때 — 터미널에서 바로 진단하기
```bash
cd finance-reader
node scripts/test-dart.js 삼성전자
```
- `DART_API_KEY 설정 여부: 없음` → `.env`에 `DART_API_KEY=발급받은키` 추가
- `등록되지 않은 키` 에러 → opendart.fss.or.kr에서 키 재확인/재발급 (새 키는 승인까지 시간 걸릴 수 있음)
- 타임아웃/네트워크 에러 → 인터넷/방화벽 확인
- `회사를 찾지 못했습니다` → corpCode 다운로드 자체는 성공한 것, 다른 회사명으로 재시도

위험률 예측이 안 뜰 때는 `node server.js`를 띄운 터미널에서 `[Prediction] predict.py stderr` 로그를 확인하세요 — `predict.py`가 실패 이유를 항상 여기에 남깁니다.

### 용어 중복 제거 / 원문 추출 개선 / 기업별 DART 버튼 / 상품 추천
- **중복 용어**: 같은 용어가 여러 번 나와도 처음 등장할 때 한 번만 밑줄+설명 (`highlightTerms`의 `seenTerms` Set).
- **원문 추출**: [Readability](https://github.com/mozilla/readability)를 1차로 사용, 실패 시 기존 셀렉터 방식 폴백.
- **기업별 버튼**: 여러 기업이 언급되면 기업마다 DART 버튼 + 위험률 예측 버튼이 따로 생깁니다. DART에서 못 찾으면 정식 명칭을 입력해 재조회하는 입력창이 뜹니다.
- **금융 상품 추천**: 온톨로지 카테고리로 관련 분야를 정하고, 그 분야와 어울리는 상품 "유형"을 안내합니다. ⚠️ 실시간 상품/금리 정보가 아니라 참고용 예시이며, 실제 조건은 반드시 공식 채널에서 확인해야 합니다.

### 기타
- 기사 본문은 원문 문단을 그대로 가져옵니다 (요약·재구성 없이 용어에만 밑줄). 유료 구독 기사나 특이한 구조의 사이트는 추출이 안 될 수 있습니다 (`services/articleExtractor.js`의 `CONTENT_SELECTORS`에 셀렉터 추가로 대응).
- DART 기업 고유번호 목록(corpCode)은 최초 조회 시 1회 다운로드해 `data/corpCode.json`에 캐싱합니다 (최초 1회는 최대 1분 정도 소요).
- "AI 추천"과 "오늘의 핫 기사"는 네이버 뉴스 검색 결과를 서버에서 스크레이핑합니다. 네이버가 마크업을 바꾸면 `services/newsFeed.js`의 셀렉터를 손봐야 할 수 있고, 일시적으로 403이 뜨면 구글 뉴스 RSS → 예시 데이터 순으로 자동 대체됩니다.
- 모든 API 호출은 서버(`server.js`)에서 이루어지므로 API 키가 브라우저에 노출되지 않습니다.

## 5. 커스터마이징 힌트

- 난이도별 설명 톤/용어 선택 기준: `services/llm.js`의 `LEVEL_CONFIG`
- 온톨로지 카테고리 추가/수정: `services/categories.js`의 `CATEGORIES` / `categorize()`
- 디자인 토큰(색상/폰트): `public/style.css` 상단 `:root` 변수
- 흐름도 레이아웃/글자 크기: `public/app.js`의 `renderFlowSVG` 함수와 `.flow-node text` / `.flow-edge-label` CSS
- 뉴스 카드 스크레이핑 셀렉터: `services/newsFeed.js`의 `CARD_SELECTORS`
- AI 위험 예측 피처/임계값 로직: `ml_pipeline/train_model.py`의 `FEATURE_COLS`, `predict.py`의 위험 등급 분류 부분
- 투트랙 경보 기준(Recall 최소 요구치 등): `ml_pipeline/train_model.py` 실행 시 `--min-recall` 옵션
