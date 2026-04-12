const https = require('https');
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
function apiRequest(method, data) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(data);
    const options = { hostname: 'api.telegram.org', path: `/bot${BOT_TOKEN}/${method}`, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } };
    const req = https.request(options, (res) => { let d = ''; res.on('data', c => d += c); res.on('end', () => resolve(JSON.parse(d))); });
    req.on('error', reject); req.write(body); req.end();
  });
}
async function sendMessage(chatId, text) { return apiRequest('sendMessage', { chat_id: chatId, text, parse_mode: 'Markdown' }); }
async function setWebhook(url) { return apiRequest('setWebhook', { url }); }
module.exports = { sendMessage, setWebhook };
