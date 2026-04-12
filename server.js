require('dotenv').config();
const express = require('express');
const cron = require('node-cron');
const { processMessage } = require('./agent');
const { sendMessage, setWebhook } = require('./telegram');
const app = express();
app.use(express.json());
const PORT = process.env.PORT || 3000;
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const GROUP_CHAT_ID = process.env.TELEGRAM_GROUP_CHAT_ID;
app.post(`/webhook/${BOT_TOKEN}`, async (req, res) => {
  res.sendStatus(200);
  const update = req.body;
  if (!update.message || !update.message.text) return;
  const msg = update.message;
  const chatId = msg.chat.id.toString();
  const senderName = msg.from.first_name || msg.from.username || 'Family member';
  const text = msg.text;
  if (msg.chat.type !== 'private') {
    const botMentioned = text.toLowerCase().includes('@katzfamilybot');
    const isReply = msg.reply_to_message?.from?.is_bot;
    if (!botMentioned && !isReply) return;
  }
  try {
    const response = await processMessage(`[${senderName}]: ${text}`, chatId);
    if (response) await sendMessage(chatId, response);
  } catch (err) {
    console.error('Error:', err);
    await sendMessage(chatId, 'Sorry, ran into an error. Try again!');
  }
});
app.get('/', (req, res) => res.send('Katz Family Bot is running!'));
cron.schedule('0 7 * * *', async () => {
  if (!GROUP_CHAT_ID) return;
  try {
    const r = await processMessage('Give the family a brief morning briefing: date, events today/tomorrow, motivational note.', GROUP_CHAT_ID);
    if (r) await sendMessage(GROUP_CHAT_ID, r);
  } catch (e) { console.error(e); }
}, { timezone: 'America/New_York' });
app.listen(PORT, async () => {
  console.log(`Bot running on port ${PORT}`);
  const domain = process.env.RAILWAY_PUBLIC_DOMAIN;
  if (domain && BOT_TOKEN) {
    const result = await setWebhook(`https://${domain}/webhook/${BOT_TOKEN}`);
    console.log('Webhook:', result.description);
  }
});
