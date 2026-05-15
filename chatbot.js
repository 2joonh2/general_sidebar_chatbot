// chatbot.js

/**
 * Gemini API 통신을 담당하는 Provider 클래스
 */
class GeminiLlmProvider {
    constructor(config) {
        this.apiKey = config.apiKey;
        this.model = config.model || 'gemini-2.5-flash';
        this.apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`;
        
        // 동적 시스템 프롬프트 지원
        this.systemPrompt = config.systemPrompt || `
You are an AI assistant controlling a stock dashboard. 
The user will input natural language to view a stock.
The available stocks and their tickers are:
Apple: AAPL
Microsoft: MSFT
Alphabet/Google: GOOGL
Amazon: AMZN
NVIDIA: NVDA
Meta: META
Tesla: TSLA
Berkshire Hathaway: BRK.B
Eli Lilly: LLY
Broadcom: AVGO

First, think step-by-step about what the user wants and output each reasoning step as an array of strings in the "thoughtProcess" field.
Then, determine the action.
Your job is to match the user's input to one of these tickers and return a JSON object ONLY, with no markdown formatting or other text.

If the user JUST wants to see or change the view (e.g., "보여줘", "바꿔줘"), return:
{
    "thoughtProcess": [
        "사용자가 화면을 변경해 달라고 요청했습니다.",
        "입력된 종목 기호를 확인하고 매핑합니다."
    ],
    "action": "changeStock",
    "ticker": "AAPL",
    "message": "Apple 주식 뷰로 변경되었습니다."
}

If the user wants to ANALYZE the stock data (e.g., "분석해줘", "추세가 어때", "데이터 어때"), return:
{
    "thoughtProcess": [
        "사용자가 특정 주식의 데이터 분석을 요청했습니다.",
        "현재 주가 동향과 패턴을 파악해야 합니다.",
        "데이터를 바탕으로 분석 액션을 실행하도록 결정합니다."
    ],
    "action": "analyzeStock",
    "ticker": "AAPL",
    "message": "Apple 주식 데이터를 불러와 분석을 시작합니다..."
}

If you cannot understand or the stock is not in the list, return:
{
    "thoughtProcess": [
        "입력된 문장에서 적절한 종목이나 의도를 찾을 수 없습니다.",
        "요청을 수행할 수 없으므로 거절 메시지를 준비합니다."
    ],
    "action": "none",
    "message": "죄송합니다. 지원하지 않는 종목이거나 이해할 수 없는 명령입니다."
}
        `;
    }

    setSystemPrompt(newPrompt) {
        this.systemPrompt = newPrompt;
    }

    /**
     * 사용자의 입력을 분석하여 JSON 명령 형태로 반환합니다.
     */
    async analyzeCommand(userInput) {
        const requestBody = {
            contents: [
                {
                    role: "user",
                    parts: [
                        { text: this.systemPrompt },
                        { text: `User input: ${userInput}` }
                    ]
                }
            ],
            generationConfig: {
                temperature: 0.1, // 일관된 JSON 출력을 위해 낮춤
            }
        };

        // 명령 분석 타임아웃: 120초 (관용적 적용)
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 120000);

        try {
            const response = await fetch(this.apiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(requestBody),
                signal: controller.signal
            });
            clearTimeout(timeoutId);

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                console.error("Gemini API Error:", response.status, response.statusText, errorData);
                return { action: "none", message: `API 호출 중 오류가 발생했습니다 (코드: ${response.status}). F12를 눌러 콘솔의 에러 메시지(API 키 등)를 확인해주세요.` };
            }

            const data = await response.json();
            const textResponse = data.candidates[0].content.parts[0].text.trim();
            
            // JSON 파싱 (정규식을 사용하여 JSON 블록만 추출, 그 외의 텍스트 무시)
            const jsonMatch = textResponse.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                return JSON.parse(jsonMatch[0]);
            } else {
                throw new Error("JSON format not found in response.");
            }
            
        } catch (error) {
            if (error.name === 'AbortError') {
                console.error("LLM Timeout Error: Request took too long.");
                return { action: "none", message: "생각이 너무 길어져서 응답을 완료하지 못했습니다 (시간 초과)." };
            }
            console.error("LLM Parsing Error:", error);
            return { action: "none", message: "응답을 처리하는 중 오류가 발생했습니다." };
        }
    }

    /**
     * 화면에서 추출한 데이터를 바탕으로 데이터 분석을 수행합니다.
     */
    async generateAnalysis(dbData, userQuery = "") {
        // 1. 데이터 검증 (오류 방지)
        if (!dbData || !dbData.label || !Array.isArray(dbData.data)) {
            return "데이터 분석에 필요한 주가 정보가 올바르지 않거나 누락되었습니다.";
        }

        const prompt = `
You are an expert financial data analyst.
The user has specifically asked: "${userQuery || 'Analyze the data'}"
Analyze the following stock data representing the recent ${dbData.data.length} periods (e.g., days or months) of prices to answer the user's specific request.

Stock: ${dbData.label}
Prices: ${dbData.data.join(', ')}

First, perform a detailed data analysis internally (identify trends, highest/lowest points, and volatility).
Then, provide a professional and insightful analysis report in Korean.
Structure your response starting with "[데이터 분석 결과]".
Make sure to mention the highest and lowest price points, overall trend, and provide a brief future outlook or summary. 
Keep it to 4-5 sentences. Do NOT output any markdown blocks like \`\`\`json, just pure text.
`;
        
        // 심층 분석 타임아웃: 180초 (3분, 더 긴 분석 시간을 위해 관용적 적용)
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 180000);

        try {
            const response = await fetch(this.apiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ role: "user", parts: [{ text: prompt }] }],
                    generationConfig: { temperature: 0.7 }
                }),
                signal: controller.signal
            });
            clearTimeout(timeoutId);
            
            // 2. API 응답 에러 처리
            if (!response.ok) {
                const errorData = await response.json();
                console.error("API 응답 에러:", errorData);
                return "데이터 분석 요청 중 서버 오류가 발생했습니다.";
            }

            const data = await response.json();
            
            // 3. 안전한 데이터 추출
            if (data.candidates && data.candidates.length > 0) {
                return data.candidates[0].content.parts[0].text.trim();
            } else {
                return "분석 결과를 생성할 수 없습니다 (데이터 차단 또는 구조 이상).";
            }
        } catch (err) {
            if (err.name === 'AbortError') {
                console.error("Analysis Timeout Error:", err);
                return "데이터 분석 과정이 너무 오래 걸려 시간 초과되었습니다.";
            }
            console.error(err);
            return "데이터 분석 중 오류가 발생했습니다.";
        }
    }
}

/**
 * 대시보드 챗봇 UI 및 로직 통합 클래스
 */
class DashboardChatbot {
    constructor(config) {
        this.llmProvider = config.llmProvider;
        this.actions = config.actions || {};
        
        this.initUI();
    }

    initUI() {
        // 챗봇 컨테이너 생성
        this.container = document.createElement('div');
        this.container.id = 'chatbot-container';

        // 토글 버튼
        this.toggleBtn = document.createElement('button');
        this.toggleBtn.id = 'chatbot-toggle-btn';
        this.toggleBtn.innerHTML = '💬';
        this.toggleBtn.onclick = () => this.toggleWindow();

        // 챗봇 윈도우
        this.window = document.createElement('div');
        this.window.id = 'chatbot-window';

        // 헤더
        const header = document.createElement('div');
        header.id = 'chatbot-header';
        header.innerHTML = `
            <span>대시보드 AI 어시스턴트</span>
            <button id="chatbot-close-btn">&times;</button>
        `;
        header.querySelector('#chatbot-close-btn').onclick = () => this.toggleWindow();
        
        // 메시지 영역
        this.messages = document.createElement('div');
        this.messages.id = 'chatbot-messages';
        
        // 초기 인사말
        this.appendMessage('bot', '안녕하세요! S&P 500 대시보드 어시스턴트입니다. "애플 주가 보여줘" 와 같이 입력해보세요.');

        // 입력 영역
        const inputArea = document.createElement('div');
        inputArea.id = 'chatbot-input-area';
        
        this.input = document.createElement('input');
        this.input.id = 'chatbot-input';
        this.input.type = 'text';
        this.input.placeholder = '명령을 입력하세요...';
        this.input.onkeypress = (e) => {
            if (e.key === 'Enter') this.sendMessage();
        };

        const sendBtn = document.createElement('button');
        sendBtn.id = 'chatbot-send-btn';
        sendBtn.innerHTML = '➤';
        sendBtn.onclick = () => this.sendMessage();

        inputArea.appendChild(this.input);
        inputArea.appendChild(sendBtn);

        this.window.appendChild(header);
        this.window.appendChild(this.messages);
        this.window.appendChild(inputArea);

        this.container.appendChild(this.window);
        this.container.appendChild(this.toggleBtn);

        document.body.appendChild(this.container);
    }

    toggleWindow() {
        this.window.classList.toggle('open');
    }

    appendMessage(role, text) {
        const bubble = document.createElement('div');
        bubble.className = `chat-bubble ${role}`;
        bubble.innerText = text;
        this.messages.appendChild(bubble);
        this.messages.scrollTop = this.messages.scrollHeight;
        return bubble;
    }

    async sendMessage() {
        const text = this.input.value.trim();
        if (!text) return;

        // 사용자 메시지 표시
        this.appendMessage('user', text);
        this.input.value = '';

        // 로딩 메시지
        const loadingBubble = this.appendMessage('bot loading', '생각하는 중...');

        // LLM 분석
        const result = await this.llmProvider.analyzeCommand(text);

        // 로딩 제거
        this.messages.removeChild(loadingBubble);

        // AI의 생각하는 흐름(Thought Process)을 사용자에게 시각적으로 보여주기
        if (result.thoughtProcess) {
            const thoughts = Array.isArray(result.thoughtProcess) ? result.thoughtProcess : [result.thoughtProcess];
            for (const thought of thoughts) {
                const thoughtBubble = this.appendMessage('bot', `💡 생각: ${thought}`);
                thoughtBubble.style.fontSize = '0.85em';
                thoughtBubble.style.opacity = '0.8';
                thoughtBubble.style.fontStyle = 'italic';
            }
        }

        // 액션 함수에서 사용자의 원본 질문을 활용할 수 있도록 결과에 포함
        result.originalQuery = text;

        // 액션 실행
        if (result.action && this.actions[result.action]) {
            try {
                // 비동기 액션(예: DB 분석)이 텍스트 결과를 반환할 수 있도록 await 처리
                const actionResult = await this.actions[result.action](result);
                
                // 액션에서 명시적으로 응답 텍스트를 반환한 경우 (예: 분석 결과)
                if (typeof actionResult === 'string' && actionResult.length > 0) {
                    this.appendMessage('bot', actionResult);
                    return; // 기본 메시지 출력 건너뜀
                }
            } catch (err) {
                console.error("Action Execution Error:", err);
                this.appendMessage('bot', '명령 실행 중 오류가 발생했습니다.');
                return;
            }
        }

        // 봇 응답 표시 (액션에서 별도로 반환한 텍스트가 없을 때 기본 메시지 출력)
        this.appendMessage('bot', result.message || '완료되었습니다.');
    }
}
