require('dotenv').config();
const express = require('express');
const https = require('https');
const cron = require('node-cron');
const { processMessage, processMessageSafe, loadAndScheduleReminders, setSendMessage } = require('./agent');
const { sendMessage } = require('./telegram');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const FAMILY_GROUP_ID = '-5287014154';
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

setSendMessage(sendMessage);
loadAndScheduleReminders();

// Download a Telegram file as base64
function getTelegramFile(fileId) {
  return new Promise((resolve, reject) => {
    https.get(`https://api.telegram.org/bot${BOT_TOKEN}/getFile?file_id=${fileId}`, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        const filePath = JSON.parse(d).result?.file_path;
        if (!filePath) return reject(new Error('No file path'));
        https.get(`https://api.telegram.org/file/bot${BOT_TOKEN}/${filePath}`, res2 => {
          const chunks = [];
          res2.on('data', c => chunks.push(c));
          res2.on('end', () => resolve(Buffer.concat(chunks).toString('base64')));
        }).on('error', reject);
      });
    }).on('error', reject);
  });
}

app.use('/webhook', async (req, res) => {
  res.sendStatus(200);
  const update = req.body;
  if (!update.message) return;
  const msg = update.message;
  const chatId = msg.chat.id.toString();
  const senderName = msg.from.first_name || msg.from.username || 'Family member';

  if (msg.chat.type !== 'private' && chatId !== FAMILY_GROUP_ID) return;

  let userMessage = '';
  let imageBase64 = null;
  let imageMime = 'image/jpeg';

  // Handle text
  if (msg.text) {
    userMessage = msg.text;
  }

  // Handle photos
  if (msg.photo) {
    try {
      const photo = msg.photo[msg.photo.length - 1]; // highest res
      imageBase64 = await getTelegramFile(photo.file_id);
      userMessage = msg.caption || 'What do you see in this image?';
    } catch(e) {
      console.error('Photo download error:', e.message);
    }
  }

  // Handle documents (PDFs, screenshots saved as files)
  if (msg.document && msg.document.mime_type?.startsWith('image/')) {
    try {
      imageBase64 = await getTelegramFile(msg.document.file_id);
      imageMime = msg.document.mime_type;
      userMessage = msg.caption || 'What do you see in this image?';
    } catch(e) {
      console.error('Document download error:', e.message);
    }
  }

  if (!userMessage && !imageBase64) return;

  console.log(`[${msg.chat.type}] ${senderName}: ${userMessage.substring(0,80)}${imageBase64 ? ' [+image]' : ''}`);

  try {
    const response = await processMessageSafe(
      `[${senderName}]: ${userMessage}`,
      chatId,
      imageBase64 ? { base64: imageBase64, mime: imageMime } : null
    );
    if (response) await sendMessage(chatId, response);
  } catch (err) {
    console.error('Error:', err.message);
    try { await sendMessage(chatId, 'Hit a snag, try again.'); } catch(e) {}
  }
});

app.get('/', (req, res) => res.send('Katz Family Bot is running!'));

cron.schedule('0 7 * * *', async () => {
  try {
    const r = await processMessageSafe('[System]: Send the family their morning briefing â good morning, today\'s date, key events today and tomorrow, anything worth flagging, and a brief thought for the day. Warm and punchy.', FAMILY_GROUP_ID);
    if (r) await sendMessage(FAMILY_GROUP_ID, r);
  } catch(e) { console.error('Briefing error:', e.message); }
}, { timezone: 'America/New_York' });

cron.schedule('0 20 * * 0', async () => {
  try {
    const r = await processMessageSafe('[System]: Sunday evening weekly preview â what\'s coming up this week, key dates, motivational note. Conversational, not a formal report.', FAMILY_GROUP_ID);
    if (r) await sendMessage(FAMILY_GROUP_ID, r);
  } catch(e) { console.error('Weekly preview error:', e.message); }
}, { timezone: 'America/New_York' });



// Friday 9am — weekly shopping list
cron.schedule('0 9 * * 5', async () => {
  try {
    const r = await processMessageSafe('[System]: It is Friday morning. Generate the full family shopping list for the week. Start with "🛒 Weekly Shopping List:" then list every item currently on the shopping list, organized by category (produce, dairy, pantry, etc.) if possible. Add a note about how many items total. Keep it clean and easy to read — this is going to the grocery store.', FAMILY_GROUP_ID);
    if (r) await sendMessage(FAMILY_GROUP_ID, r);
  } catch(e) { console.error('Friday shopping cron error:', e.message); }
}, { timezone: 'America/New_York' });

app.listen(PORT, () => console.log(`Katz Family Bot running on port ${PORT}`));

// Memory backup/restore endpoint
app.get('/memory', (req, res) => {
  const memory = require('./memory');
  res.json(memory.getFullMemory());
});
