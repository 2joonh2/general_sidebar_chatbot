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
Walmart: WMT
Broadcom: AVGO

Your job is to match the user's input to one of these tickers and return a JSON object ONLY, with no markdown formatting or other text.

If the user JUST wants to see or change the view (e.g., "보여줘", "바꿔줘"), return:
{
    "action": "changeStock",
    "ticker": "AAPL",
    "message": "Apple 주식 뷰로 변경되었습니다."
}

If the user wants to ANALYZE the stock data (e.g., "분석해줘", "추세가 어때", "데이터 어때"), return:
{
    "action": "analyzeStock",
    "ticker": "AAPL",
    "message": "Apple 주식 데이터를 불러와 분석을 시작합니다..."
}

If you cannot understand or the stock is not in the list, return:
{
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

        try {
            const response = await fetch(this.apiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(requestBody)
            });

            if (!response.ok) {
                console.error("Gemini API Error:", response.status, response.statusText);
                return { action: "none", message: "API 호출 중 오류가 발생했습니다." };
            }

            const data = await response.json();
            const textResponse = data.candidates[0].content.parts[0].text.trim();
            
            // JSON 파싱 (마크다운 \`\`\`json ... \`\`\` 등이 붙어있을 수 있으므로 제거)
            const jsonStr = textResponse.replace(/```json/g, '').replace(/```/g, '').trim();
            return JSON.parse(jsonStr);
            
        } catch (error) {
            console.error("LLM Parsing Error:", error);
            return { action: "none", message: "응답을 처리하는 중 오류가 발생했습니다." };
        }
    }

    /**
     * 화면에서 추출한 데이터를 바탕으로 데이터 분석을 수행합니다.
     */
    async generateAnalysis(dbData) {
        const prompt = `
You are an expert financial data analyst.
Analyze the following stock data representing the last 30 days of prices.
Stock: ${dbData.label}
Prices: ${dbData.data.join(', ')}

Please provide a short, professional analysis in Korean. Mention the highest and lowest price points, overall trend, and volatility. Keep it to 3-4 sentences. Do NOT output any markdown blocks like \`\`\`json, just pure text.
`;
        
        try {
            const response = await fetch(this.apiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ role: "user", parts: [{ text: prompt }] }],
                    generationConfig: { temperature: 0.7 }
                })
            });
            const data = await response.json();
            return data.candidates[0].content.parts[0].text.trim();
        } catch (err) {
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
