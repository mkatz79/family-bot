require('dotenv').config();
const express = require('express');
const cron = require('node-cron');
const { processMessage } = require('./agent');
const { sendMessage } = require('./telegram');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const GROUP_CHAT_ID = process.env.TELEGRAM_GROUP_CHAT_ID;

app.use('/webhook', async (req, res) => {
  res.sendStatus(200);
  const update = req.body;
  if (!update.message || !update.message.text) return;
  const msg = update.message;
  const chatId = msg.chat.id.toString();
  const senderName = msg.from.first_name || msg.from.username || 'Family member';
  const text = msg.text;

  // In groups, respond to @mentions OR any message (since it's a family group)
  if (msg.chat.type !== 'private') {
    const botMentioned = text.toLowerCase().includes('@katzfamilybot');
    const isReply = msg.reply_to_message?.from?.is_bot;
    // Also respond if it looks like a question or command directed at the bot
    const looksDirected = text.includes('?') || text.toLowerCase().startsWith('add') || 
      text.toLowerCase().startsWith('what') || text.toLowerCase().startsWith('when') ||
      text.toLowerCase().startsWith('schedule') || text.toLowerCase().startsWith('remind');
    if (!botMentioned && !isReply && !looksDirected) return;
  }

  console.log(`Message from ${senderName} in ${msg.chat.type}: ${text}`);
  try {
    const response = await processMessage(`[${senderName}]: ${text}`, chatId);
    if (resp
cd ~/Downloads/family-bot
# Fix server.js to respond to ALL messages in the group (not just @mentions)
cat > server.js << 'EOF'
require('dotenv').config();
const express = require('express');
const cron = require('node-cron');
const { processMessage } = require('./agent');
const { sendMessage } = require('./telegram');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const GROUP_CHAT_ID = process.env.TELEGRAM_GROUP_CHAT_ID;

app.use('/webhook', async (req, res) => {
  res.sendStatus(200);
  const update = req.body;
  if (!update.message || !update.message.text) return;
  const msg = update.message;
  const chatId = msg.chat.id.toString();
  const senderName = msg.from.first_name || msg.from.username || 'Family member';
  const text = msg.text;

  // In groups, respond to @mentions OR any message (since it's a family group)
  if (msg.chat.type !== 'private') {
    const botMentioned = text.toLowerCase().includes('@katzfamilybot');
    const isReply = msg.reply_to_message?.from?.is_bot;
    // Also respond if it looks like a question or command directed at the bot
    const looksDirected = text.includes('?') || text.toLowerCase().startsWith('add') || 
      text.toLowerCase().startsWith('what') || text.toLowerCase().startsWith('when') ||
      text.toLowerCase().startsWith('schedule') || text.toLowerCase().startsWith('remind');
    if (!botMentioned && !isReply && !looksDirected) return;
  }

  console.log(`Message from ${senderName} in ${msg.chat.type}: ${text}`);
  try {
    const response = await processMessage(`[${senderName}]: ${text}`, chatId);
    if (response) await sendMessage(chatId, response);
  } catch (err) {
    console.error('Error:', err.message);
    try { await sendMessage(chatId, 'Sorry, ran into an error. Try again!'); } catch(e) {}
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

app.listen(PORT, () => console.log(`Katz Family Bot running on port ${PORT}`));
