// chatbot.js

/**
 * Gemini API 통신을 담당하는 Provider 클래스 (General Chatbot 버전)
 */
class GeminiLlmProvider {
    constructor(config) {
        this.apiKey = config.apiKey;
        this.model = config.model || 'gemini-2.5-flash';
        this.apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`;
        
        // [핵심 추가] 챗봇의 기억력을 담당할 배열
        this.chatHistory = []; 
        
        const pageTitle = document.title || "웹페이지";

        // 범용 대화를 위한 시스템 프롬프트
        this.systemPrompt = config.systemPrompt || `
You are a friendly, knowledgeable, and highly capable AI assistant embedded in a web page.
Current Page Title: "${pageTitle}"

Your primary goal is to engage in natural, helpful conversations with the user. You can answer general knowledge questions, assist with coding, summarize text, or just chat.

CRITICAL INSTRUCTION:
You MUST output ONLY a valid JSON object. No markdown code blocks (like \`\`\`json) outside the JSON structure.
Format your response exactly like this:
{
    "thoughtProcess": [
        "1. 질문의 의도를 파악합니다.",
        "2. 어떤 정보를 제공할지 생각합니다."
    ],
    "message": "사용자에게 전달할 실제 한국어 답변. 여기에 자연스럽고 친절하게 대답하세요. 줄바꿈이나 간단한 마크다운 기호를 써도 좋습니다."
}
        `;
    }

    /**
     * 대화 기록을 초기화하는 함수 (필요시 호출)
     */
    clearHistory() {
        this.chatHistory = [];
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
                topP: 0.95
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
}

/**
 * 대시보드 챗봇 UI 클래스
 */
class DashboardChatbot {
    constructor(config) {
        this.llmProvider = config.llmProvider;
        this.initUI();
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

        // Action 분기 없이 무조건 AI가 작성한 message를 출력
        this.appendMessage('bot', result.message || '요청을 처리했습니다.');
    }
}