const fs = require('fs');
const path = require('path');

const RAW_DIR = path.join(__dirname, 'raw_dashboards');
const PUBLIC_DIR = path.join(__dirname, 'public');

// Ensure public directory exists
if (!fs.existsSync(PUBLIC_DIR)) {
    fs.mkdirSync(PUBLIC_DIR, { recursive: true });
}

// Copy static assets
['chatbot.js', 'chatbot.css'].forEach(file => {
    if (fs.existsSync(file)) {
        fs.copyFileSync(file, path.join(PUBLIC_DIR, file));
        console.log(`Copied ${file} to public/`);
    }
});

// The standard chatbot injection snippet
const CHATBOT_INJECTION = `
<!-- ============================================== -->
<!-- 🤖 Auto-injected Chatbot by Build System       -->
<!-- ============================================== -->
<link rel="stylesheet" href="chatbot.css">
<script src="chatbot.js"></script>
<script>
    window.addEventListener('DOMContentLoaded', () => {
        if (typeof GeminiLlmProvider !== 'undefined') {
            const geminiProvider = new GeminiLlmProvider({
                // TODO: Replace with secure API endpoint in production
                apiKey: 'AIzaSyCm3yBFjXDuTDJ5A1vGt-30G88zET21gOk', 
                model: 'gemini-2.5-flash'
            });

            const bot = new DashboardChatbot({
                llmProvider: geminiProvider,
                actions: {
                    'changeStock': (params) => {
                        if (window.DashboardAPI && window.DashboardAPI.changeStock) {
                            window.DashboardAPI.changeStock(params.ticker);
                        } else {
                            console.warn('DashboardAPI.changeStock is not implemented in this HTML.');
                        }
                    },
                    'analyzeStock': async (params) => {
                        if (window.DashboardAPI && window.DashboardAPI.changeStock && window.DashboardAPI.getCurrentData) {
                            window.DashboardAPI.changeStock(params.ticker);
                            const dbData = window.DashboardAPI.getCurrentData();
                            const loadingBubble = bot.appendMessage('bot loading', '데이터 분석 중...');
                            const analysisText = await geminiProvider.generateAnalysis(dbData);
                            bot.messages.removeChild(loadingBubble);
                            return analysisText;
                        }
                        return "이 대시보드에서는 데이터 분석 기능을 지원하지 않습니다 (DashboardAPI 누락).";
                    }
                }
            });
            console.log('✅ Chatbot successfully embedded!');
        }
    });
</script>
</body>`;

// Process HTML files
fs.readdirSync(RAW_DIR).forEach(file => {
    if (file.endsWith('.html')) {
        const filePath = path.join(RAW_DIR, file);
        let content = fs.readFileSync(filePath, 'utf-8');

        // Check if already injected to prevent duplication
        if (!content.includes('Auto-injected Chatbot')) {
            // Inject right before </body>
            if (content.includes('</body>')) {
                content = content.replace('</body>', CHATBOT_INJECTION);
            } else {
                // Fallback: append to end if no </body> is found
                content += CHATBOT_INJECTION;
            }
        }

        const outPath = path.join(PUBLIC_DIR, file);
        fs.writeFileSync(outPath, content);
        console.log(`Injected chatbot into: ${file}`);
    }
});

console.log('🎉 Build completed successfully!');
