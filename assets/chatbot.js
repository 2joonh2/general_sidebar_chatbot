// 1. GeminiLlmProvider 클래스의 프롬프트 수정
class GeminiLlmProvider {
    constructor(config) {
        this.apiKey = config.apiKey;
        this.model = config.model || 'gemini-2.5-flash';
        this.apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`;
        
        this.chatHistory = []; 
        const pageTitle = document.title || "웹페이지";

        // [수정됨] 대화와 함수 실행을 모두 지원하는 하이브리드 프롬프트
        this.systemPrompt = config.systemPrompt || `
You are an AI assistant embedded in a web page. Current Page Title: "${pageTitle}"

CRITICAL CAPABILITY: You have FULL access to execute any global functions defined on the \`window\` object of this HTML page. The dashboard's data, charts, and global database (e.g., global variables or APIs attached to \`window\`) can be manipulated by returning the exact name of the global function in the "action" field. 

You must output ONLY a JSON object. No markdown code blocks.
You have two modes:
1. Function Execution Mode: If the user asks to perform an action on the dashboard (e.g., change view, analyze data, or run a specific global function), identify the intent and return the function name.
2. General Chat Mode: If the user asks a general question, greets, or just chats.

Return format:
{
    "thoughtProcess": ["Reasoning step 1", "Reasoning step 2"],
    "action": "The name of the function to execute (e.g., 'changeStock', 'myGlobalFunction'). Use 'generalChat' if no action is needed.",
    "ticker": "Extract ticker if applicable, otherwise omit",
    "message": "사용자에게 보여줄 친절한 한국어 응답 메시지"
}
        `;
    }
    /**
     * 사용자의 입력을 분석하고 대화 문맥을 포함하여 응답을 반환합니다.
     */
    async analyzeCommand(userInput) {
        // 1. 사용자의 새로운 질문을 히스토리에 추가
        this.chatHistory.push({ role: "user", parts: [{ text: userInput }] });

        // 2. API 요청 데이터 구성 (시스템 프롬프트 + 지금까지의 대화 기록)
        const requestBody = {
            contents: [
                // 시스템 프롬프트를 첫 대화의 맥락으로 주입
                { role: "user", parts: [{ text: this.systemPrompt }] },
                { role: "model", parts: [{ text: "Understood. I will act as a general AI assistant and output ONLY JSON as requested." }] },
                // 이후 누적된 사용자-AI 대화 기록 전개
                ...this.chatHistory 
            ],
            generationConfig: {
                temperature: 0.7, // 자연스럽고 창의적인 대화를 위해 온도 상승
                topK: 40,
                topP: 0.95,
                responseMimeType: "application/json" // 강제로 유효한 JSON 포맷을 반환하도록 설정
            }
        };

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 60000); // 일반 대화는 60초면 충분함

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
                console.error("Gemini API Error:", response.status, errorData);
                // 에러 발생 시 히스토리에서 방금 넣은 질문 제거 (재시도를 위해)
                this.chatHistory.pop(); 
                return { message: "API 통신 중 오류가 발생했어요." };
            }

            const data = await response.json();
            const textResponse = data.candidates[0].content.parts[0].text.trim();
            
            const jsonMatch = textResponse.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                const parsedResult = JSON.parse(jsonMatch[0]);
                
                // 3. AI가 정상적으로 답변했다면, 그 답변도 히스토리에 추가 (기억력 유지)
                // JSON 전체를 텍스트로 저장하여 AI가 본인이 어떤 포맷으로 대답했는지 기억하게 함
                this.chatHistory.push({ role: "model", parts: [{ text: JSON.stringify(parsedResult) }] });
                
                return parsedResult;
            } else {
                throw new Error("JSON format not found");
            }
            
        } catch (error) {
            this.chatHistory.pop(); // 에러 시 마지막 사용자 입력 롤백
            console.error("LLM Error:", error);
            return { message: "응답을 처리하는 중 문제가 생겼어요. 다시 말씀해주시겠어요?" };
        }
    }

    /**
     * 대화 기록을 초기화합니다.
     */
    clearHistory() {
        this.chatHistory = [];
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
        
        const requestBody = {
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.7 }
        };

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 180000);

        try {
            const response = await fetch(this.apiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(requestBody),
                signal: controller.signal
            });
            clearTimeout(timeoutId);
            
            if (!response.ok) {
                const errorData = await response.json();
                console.error("API 응답 에러:", errorData);
                return "데이터 분석 요청 중 서버 오류가 발생했습니다.";
            }

            const data = await response.json();
            
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



// 2. DashboardChatbot 클래스의 sendMessage 로직 수정
class DashboardChatbot {
    constructor(config) {
        this.llmProvider = config.llmProvider;
        this.actions = config.actions || {};
        
        // 챗봇 초기화 시점에 현재 HTML에 등록된 모든 함수들을 스캔하여 프롬프트에 동적 주입
        this.injectDynamicPrompt();
        
        this.initUI();
    }

    /**
     * 현재 웹페이지의 DOM과 전역 객체를 스캔하여 사용 가능한 액션(메뉴판)을
     * LLM 시스템 프롬프트에 명시적으로 추가합니다. (할루시네이션 방지)
     */
    injectDynamicPrompt() {
        const registeredActions = Object.keys(this.actions);
        
        // 1. DashboardAPI 객체 내부의 함수들 스캔
        const apiActions = [];
        if (window.DashboardAPI) {
            for (const key in window.DashboardAPI) {
                if (typeof window.DashboardAPI[key] === 'function') {
                    apiActions.push(key);
                }
            }
        }

        // 2. 순수 전역 커스텀 함수들 스캔 (브라우저 내장 native code 제외)
        const customGlobalFunctions = [];
        for (const key in window) {
            try {
                if (typeof window[key] === 'function') {
                    const funcStr = window[key].toString();
                    // 내장 함수가 아니고, 챗봇 클래스 자체가 아닌 커스텀 함수만 추출
                    if (!funcStr.includes('[native code]') && 
                        key !== 'GeminiLlmProvider' && 
                        key !== 'DashboardChatbot') {
                        customGlobalFunctions.push(key);
                    }
                }
            } catch(e) {}
        }

        // 중복 제거 후 하나의 배열로 통합
        const allAvailableActions = [...new Set([...registeredActions, ...apiActions, ...customGlobalFunctions])];

        const dynamicInstruction = `
CRITICAL RESTRICTION: You MUST ONLY use the following explicitly available function names in the "action" field:
[ ${allAvailableActions.length > 0 ? allAvailableActions.join(', ') : 'None'} ]

If the user's request requires an action, choose EXACTLY from the list above. DO NOT invent, guess, or hallucinate any other function names (e.g., do not use 'showStockDetails' unless it is exactly in the list). 
If the request doesn't match any available actions, use 'generalChat' in the "action" field.
`;
        
        // LLM 프로바이더의 시스템 프롬프트 하단에 메뉴판(명세서) 추가
        this.llmProvider.systemPrompt += `\n\n${dynamicInstruction}`;
        console.log("✅ 챗봇 동적 프롬프트 주입 완료 (사용 가능한 함수 목록):", allAvailableActions);
    }

    initUI() {
        this.container = document.createElement('div');
        this.container.id = 'chatbot-container';

        this.toggleBtn = document.createElement('button');
        this.toggleBtn.id = 'chatbot-toggle-btn';
        this.toggleBtn.innerHTML = '💬';
        this.toggleBtn.onclick = () => this.toggleWindow();

        this.window = document.createElement('div');
        this.window.id = 'chatbot-window';

        const header = document.createElement('div');
        header.id = 'chatbot-header';
        header.innerHTML = `
            <span>AI 어시스턴트</span>
            <div>
                <button id="chatbot-clear-btn" style="margin-right: 8px; font-size: 12px;">새 대화</button>
                <button id="chatbot-close-btn">&times;</button>
            </div>
        `;
        
        // 새 대화 버튼 기능 연결 (기억 초기화)
        header.querySelector('#chatbot-clear-btn').onclick = () => {
            this.llmProvider.clearHistory();
            this.messages.innerHTML = '';
            this.appendMessage('bot', '대화 기록이 초기화되었습니다. 새로운 주제로 이야기해 볼까요?');
        };
        header.querySelector('#chatbot-close-btn').onclick = () => this.toggleWindow();
        
        this.messages = document.createElement('div');
        this.messages.id = 'chatbot-messages';
        
        this.appendMessage('bot', '안녕하세요! 무엇이든 물어보세요.');

        const inputArea = document.createElement('div');
        inputArea.id = 'chatbot-input-area';
        
        this.input = document.createElement('input');
        this.input.id = 'chatbot-input';
        this.input.type = 'text';
        this.input.placeholder = '질문을 입력하세요...';
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
        // 간단한 텍스트 렌더링 (보안 및 마크다운 처리를 위해 실제 환경에서는 marked.js 같은 라이브러리 사용 권장)
        bubble.innerText = text; 
        this.messages.appendChild(bubble);
        this.messages.scrollTop = this.messages.scrollHeight;
        return bubble;
    }
   async sendMessage() {
        const text = this.input.value.trim();
        if (!text) return;

        this.appendMessage('user', text);
        this.input.value = '';

        const loadingBubble = this.appendMessage('bot loading', '생각하는 중...');
        const result = await this.llmProvider.analyzeCommand(text);
        this.messages.removeChild(loadingBubble);

        if (result.thoughtProcess) {
            const thoughts = Array.isArray(result.thoughtProcess) ? result.thoughtProcess : [result.thoughtProcess];
            for (const thought of thoughts) {
                const thoughtBubble = this.appendMessage('bot', `💡 생각: ${thought}`);
                thoughtBubble.style.fontSize = '0.85em';
                thoughtBubble.style.opacity = '0.7';
                thoughtBubble.style.fontStyle = 'italic';
            }
        }

        result.originalQuery = text;

        // [수정됨] 전역 함수 및 내부 액션 실행 로직 부활
        if (result.action && result.action !== 'generalChat' && result.action !== 'none') {
            try {
                let actionResult = null;

                // Case A: 챗봇 생성 시 등록한 내부 actions 객체에 해당 함수가 있는 경우
                if (this.actions && typeof this.actions[result.action] === 'function') {
                    actionResult = await this.actions[result.action](result);
                } 
                // Case B: HTML 웹 페이지에 선언된 전역 함수(Global Function)인 경우
                else if (typeof window[result.action] === 'function') {
                    actionResult = await window[result.action](result);
                } 
                // Case C: DashboardAPI 내부 함수인 경우
                else if (window.DashboardAPI && typeof window.DashboardAPI[result.action] === 'function') {
                    actionResult = await window.DashboardAPI[result.action](result);
                }
                else {
                    console.warn(`명령어 실행 실패: '${result.action}' 함수를 찾을 수 없습니다.`);
                }

                // 함수에서 명시적으로 텍스트를 반환했다면 해당 텍스트를 봇 응답으로 출력
                if (typeof actionResult === 'string' && actionResult.length > 0) {
                    this.appendMessage('bot', actionResult);
                    return;
                }
            } catch (err) {
                console.error("Action Execution Error:", err);
                this.appendMessage('bot', '명령(함수)을 실행하는 중 오류가 발생했습니다.');
                return; // 에러 발생 시 여기서 종료
            }
        }

        // 함수 실행 후 반환값이 없거나, 일반 대화(generalChat)인 경우 기본 메시지 출력
        this.appendMessage('bot', result.message || '요청을 처리했습니다.');
    }
}