# General Sidebar Chatbot 연동 가이드 (For AI Assistants)

이 문서는 AI 어시스턴트(Gemini, ChatGPT, Claude 등)가 사용자의 HTML 파일에 사이드바 챗봇을 자동으로 분석하고 연동하기 위해 작성된 **메타 프롬프트(Meta-Prompt)** 및 가이드입니다. 

사용자가 이 README 파일과 자신의 HTML 코드를 함께 제공하며 챗봇 연동을 요청할 경우, AI는 아래의 **[AI Action 지침]**에 따라 HTML 파일을 수정하여 제공해야 합니다.

---

## 🤖 [AI Action 지침] 챗봇 임베딩 수행 방법

당신(AI)은 사용자가 제공한 대상 HTML 코드를 분석하고, 다음 4가지 단계를 거쳐 수정된 HTML 코드를 반환해야 합니다.

### Step 1: HTML 문서 컨텍스트 분석
사용자가 제공한 HTML 코드를 읽고 다음 사항을 파악하세요.
- 이 웹페이지의 목적 (예: 주식 대시보드, 논문 뷰어, 이력서, 쇼핑몰 등)
- 화면에서 사용자가 조작 가능한 요소나 조회할 수 있는 데이터 구조
- 챗봇이 화면을 조작하거나 데이터를 분석하기 위해 연동해야 할 기능적 요소 (필터링, 뷰 변경, 데이터 조회 등)

### Step 2: 전역 API(Global API) 생성 및 HTML 코드 리팩토링 (핵심)
비개발자 사용자가 제공한 원본 HTML 코드는 챗봇이 직접 제어할 수 없는 구조일 확률이 높습니다. 챗봇이 화면을 조작하고 현재 뷰의 데이터를 읽어올 수 있도록 기존 Javascript 코드를 리팩토링하세요.
- 화면의 상태 변경(필터링, 탭 전환, 검색 등)이나 데이터 추출(현재 화면의 차트나 테이블 데이터 등 DB 역할) 로직을 찾아 `window.DashboardAPI` (또는 적절한 이름)와 같은 전역 객체(Global Object)로 노출하세요.
- 기존에 버튼이나 Select Box의 이벤트 리스너(익명 함수) 안에만 하드코딩 되어 있던 로직을 기명 함수로 분리하여, 챗봇이 `window.DashboardAPI.changeFilter(param)`나 `window.DashboardAPI.getCurrentData()` 형태로 호출할 수 있게 만들어야 합니다.
- 리팩토링 시 원본 HTML의 기본 기능이 깨지지 않도록 유의하세요.

### Step 3: CSS 파일 삽입
HTML의 `<head>` 태그가 닫히기 직전(`</head>`)에 챗봇 스타일시트를 추가하세요.
```html
<link rel="stylesheet" href="chatbot.css">
```

### Step 3: 맞춤형 시스템 프롬프트(System Prompt) 작성
Step 1의 분석 결과를 바탕으로 챗봇이 수행할 역할을 정의하는 시스템 프롬프트를 영어로 작성하세요.
- **필수 규칙:** 챗봇의 최종 출력은 **반드시 JSON 형식**이어야 하며 마크다운 코드 블록(```json ... ```)을 포함해서는 안 됩니다.
- JSON 구조는 화면 조작이 필요 없을 땐 `{"action": "none", "message": "답변 내용"}` 형태여야 합니다.
- 화면 조작이나 데이터 분석이 필요할 땐 `{"action": "액션명", "파라미터": "값", "message": "사용자에게 보여줄 로딩/결과 메시지"}` 형태여야 합니다.

### Step 4: Javascript 파일 삽입 및 초기화 코드 작성
HTML의 `<body>` 태그가 닫히기 직전(`</body>`)에 `chatbot.js`를 불러오고 챗봇을 초기화하는 코드를 삽입하세요. 
이때 `systemPrompt`는 Step 3에서 작성한 내용으로 채우고, `actions` 객체에는 Step 1에서 파악한 전역 함수들을 맵핑하세요.

**삽입할 코드 템플릿:**
```html
<script src="chatbot.js"></script>
<script>
    window.addEventListener('DOMContentLoaded', () => {
        // 1. LLM 프로바이더 초기화
        const geminiProvider = new GeminiLlmProvider({
            apiKey: 'AIzaSyCm3yBFjXDuTDJ5A1vGt-30G88zET21gOk', // 사용자의 API 키 (제공된 경우) 또는 Placeholder
            model: 'gemini-2.5-flash',
            // AI가 컨텍스트를 분석하여 작성한 맞춤형 프롬프트 입력
            systemPrompt: \`[AI가 작성한 맞춤형 시스템 프롬프트 삽입 (JSON 출력 필수 규칙 포함)]\`
        });

        // 2. 챗봇 인스턴스 생성 및 액션 맵핑
        const bot = new DashboardChatbot({
            llmProvider: geminiProvider,
            actions: {
                // AI가 분석한 HTML 내의 조작 가능한 기능들을 여기에 맵핑합니다.
                // 예시: 'changeView': (params) => { window.updateGraph(params.type); }
                // 화면 조작 기능이 없다면 비워두어도 됩니다.
            }
        });
    });
</script>
```

---

## 🙋‍♂️ 일반 사용자용 설명

LLM(Gemini, ChatGPT 등)에게 본인의 HTML 파일에 챗봇을 달아달라고 요청하실 때, 이 `README.md` 파일의 텍스트와 본인의 HTML 코드를 함께 복사해서 붙여넣으세요. 

**프롬프트 예시:**
> "이 README 파일의 가이드를 참고해서, 아래 첨부한 내 HTML 파일에 챗봇을 연동한 코드를 짜줘. 내 HTML은 [간단한 설명] 기능을 하는 페이지야."