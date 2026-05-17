require('dotenv').config();
const fs = require('fs');
const path = require('path');

const RAW_DIR = path.join(__dirname, 'raw_dashboards');
const DIST_DIR = path.join(__dirname, 'dist');
const DIST_DASHBOARDS_DIR = path.join(DIST_DIR, 'dashboards');
const ASSETS_DIR = path.join(__dirname, 'assets');

// Ensure directories exist
if (!fs.existsSync(DIST_DASHBOARDS_DIR)) {
    fs.mkdirSync(DIST_DASHBOARDS_DIR, { recursive: true });
}

// Get API Key from environment variable
const apiKey = process.env.GEMINI_API_KEY || 'YOUR_API_KEY_HERE';

// Copy static assets to dashboards directory so relative paths work perfectly
['chatbot.js', 'chatbot.css', 'sp500_top10_daily_prices_2026_q1.csv'].forEach(file => {
    const srcPath = path.join(ASSETS_DIR, file);
    if (fs.existsSync(srcPath)) {
        fs.copyFileSync(srcPath, path.join(DIST_DASHBOARDS_DIR, file));
        console.log(`Copied ${file} to dist/dashboards/`);
    } else {
        console.warn(`Warning: Asset ${file} not found in assets/ directory.`);
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
                apiKey: '${apiKey}', 
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
const processedFiles = [];
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

        const outPath = path.join(DIST_DASHBOARDS_DIR, file);
        fs.writeFileSync(outPath, content);
        console.log(`Injected chatbot into: ${file}`);
        processedFiles.push(file);
    }
});

// Generate index.html in the root of dist/
const indexContent = `
<!DOCTYPE html>
<html lang="ko">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>대시보드 포털</title>
    <style>
        body { font-family: sans-serif; padding: 2rem; background: #f4f7f6; }
        .container { max-width: 800px; margin: 0 auto; background: white; padding: 2rem; border-radius: 8px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); }
        h1 { color: #2c3e50; }
        ul { list-style: none; padding: 0; }
        li { margin-bottom: 10px; }
        a { text-decoration: none; color: #3498db; font-size: 1.1rem; padding: 10px; display: block; background: #eef2f5; border-radius: 5px; transition: background 0.2s;}
        a:hover { background: #dcdcdc; }
    </style>
</head>
<body>
    <div class="container">
        <h1>📊 대시보드 목록</h1>
        <p>팀원들이 생성한 대시보드(챗봇 자동 주입 완료)에 접속하세요:</p>
        <ul>
            ${processedFiles.map(f => `<li><a href="dashboards/${f}">📄 ${f}</a></li>`).join('')}
        </ul>
    </div>
</body>
</html>
`;
fs.writeFileSync(path.join(DIST_DIR, 'index.html'), indexContent);
console.log('Generated index.html (Portal)');

console.log('🎉 Build completed successfully!');