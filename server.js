require('dotenv').config();
const express = require('express');
const cron = require('node-cron');
const { processMessage, processMessageSafe, loadAndScheduleReminders, setSendMessage } = require("./agent");
const { sendMessage } = require('./telegram');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const FAMILY_GROUP_ID = '-5287014154';

// Wire sendMessage into agent for reminders
setSendMessage(sendMessage);
loadAndScheduleReminders();

app.use('/webhook', async (req, res) => {
  res.sendStatus(200);
  const update = req.body;
  if (!update.message || !update.message.text) return;
  const msg = update.message;
  const chatId = msg.chat.id.toString();
  const senderName = msg.from.first_name || msg.from.username || 'Family member';
  const text = msg.text;
  if (msg.chat.type !== 'private' && chatId !== FAMILY_GROUP_ID) return;
  console.log(`[${msg.chat.type}] ${senderName}: ${text.substring(0,80)}`);
  try {
    const response = await processMessageSafe(`[${senderName}]: ${text}`, chatId);
    if (response) await sendMessage(chatId, response);
  } catch (err) {
    console.error('Error:', err.message);
    try { await sendMessage(chatId, 'Hit an error, try again.'); } catch(e) {}
  }
});

app.get('/', (req, res) => res.send('Katz Family Bot is running!'));

// 7am daily briefing
cron.schedule('0 7 * * *', async () => {
  try {
    const r = await processMessage('[System]: Send the family their morning briefing — good morning, today\'s date, Menachem\'s key events today and tomorrow, anything worth flagging, and a brief thought for the day. Keep it warm and punchy, like a text from a helpful friend.', FAMILY_GROUP_ID);
    if (r) await sendMessage(FAMILY_GROUP_ID, r);
  } catch(e) { console.error('Briefing error:', e.message); }
}, { timezone: 'America/New_York' });

// Sunday 8pm weekly preview
cron.schedule('0 20 * * 0', async () => {
  try {
    const r = await processMessage('[System]: Give the family a Sunday evening weekly preview — what\'s coming up this week for Menachem, any key dates or deadlines, and a motivational note to kick off the week. Conversational, not a formal report.', FAMILY_GROUP_ID);
    if (r) await sendMessage(FAMILY_GROUP_ID, r);
  } catch(e) { console.error('Weekly preview error:', e.message); }
}, { timezone: 'America/New_York' });

app.listen(PORT, () => console.log(`Katz Family Bot running on port ${PORT}`));
