require('dotenv').config();
const express = require('express');
const cron = require('node-cron');
const { processMessage } = require('./agent');
const { sendMessage } = require('./telegram');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const GROUP_CHAT_ID = process.env.TELEGRAM_GROUP_CHAT_ID;
const ALLOWED_GROUP_ID = '-5287014154';

app.use('/webhook', async (req, res) => {
  res.sendStatus(200);
  const update = req.body;
  if (!update.message || !update.message.text) return;
  const msg = update.message;
  const chatId = msg.chat.id.toString();
  const senderName = msg.from.first_name || msg.from.username || 'Family member';
  const text = msg.text;

  // In groups, only respond in the authorized family group, to all messages
  if (msg.chat.type !== 'private') {
    if (chatId !== ALLOWED_GROUP_ID) return;
  }

  console.log('Message from ' + senderName + ' [' + msg.chat.type + ']: ' + text);
  try {
    const response = await processMessage('[' + senderName + ']: ' + text, chatId);
    if (response) await sendMessage(chatId, response);
  } catch (err) {
    console.error('Error:', err.message);
    try { await sendMessage(chatId, 'Sorry, ran into an error!'); } catch(e) {}
  }
});

app.get('/', (req, res) => res.send('Katz Family Bot is running!'));

cron.schedule('0 7 * * *', async () => {
  const groupId = GROUP_CHAT_ID || ALLOWED_GROUP_ID;
  try {
    const r = await processMessage('Give the Katz family a brief morning briefing: todays date, key events today and tomorrow, and a short motivational note.', groupId);
    if (r) await sendMessage(groupId, r);
  } catch (e) { console.error(e); }
}, { timezone: 'America/New_York' });

app.listen(PORT, () => console.log('Katz Family Bot running on port ' + PORT));
