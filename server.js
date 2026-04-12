require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const twilio = require('twilio');
const cron = require('node-cron');
const { processMessage } = require('./agent');
const { getUpcomingReminders } = require('./calendar');
const { sendWhatsAppMessage } = require('./whatsapp');

const app = express();
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

const PORT = process.env.PORT || 3000;

// ─── Twilio webhook — receives incoming WhatsApp messages ───────────────────
app.post('/webhook', async (req, res) => {
  // Twilio sends form-encoded data
  const from = req.body.From;        // e.g. "whatsapp:+15551234567"
  const body = req.body.Body?.trim();
  const profileName = req.body.ProfileName || 'Family member';

  if (!body) return res.sendStatus(200);

  console.log(`[${new Date().toISOString()}] Message from ${profileName} (${from}): ${body}`);

  try {
    const reply = await processMessage(from, profileName, body);
    await sendWhatsAppMessage(process.env.WHATSAPP_GROUP_ID, reply);
  } catch (err) {
    console.error('Error processing message:', err);
  }

  // Always respond 200 quickly so Twilio doesn't retry
  res.sendStatus(200);
});

// ─── Health check ────────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  res.json({ status: 'ok', bot: 'family-scheduler', time: new Date().toISOString() });
});

// ─── Reminder cron — runs every 15 minutes, checks for upcoming events ───────
cron.schedule('*/15 * * * *', async () => {
  try {
    const reminders = await getUpcomingReminders();
    for (const reminder of reminders) {
      const msg = formatReminderMessage(reminder);
      await sendWhatsAppMessage(process.env.WHATSAPP_GROUP_ID, msg);
      console.log(`Sent reminder: ${reminder.summary}`);
    }
  } catch (err) {
    console.error('Reminder cron error:', err);
  }
});

function formatReminderMessage(event) {
  const when = new Date(event.start.dateTime || event.start.date);
  const minutesUntil = Math.round((when - new Date()) / 60000);
  const timeStr = when.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });

  if (minutesUntil <= 60) {
    return `⏰ Reminder: *${event.summary}* is in ${minutesUntil} minutes (${timeStr})${event.description ? '\n' + event.description : ''}`;
  } else {
    const hoursUntil = Math.round(minutesUntil / 60);
    return `📅 Coming up: *${event.summary}* in ~${hoursUntil} hour${hoursUntil > 1 ? 's' : ''} at ${timeStr}${event.description ? '\n' + event.description : ''}`;
  }
}

app.listen(PORT, () => {
  console.log(`Family scheduler bot running on port ${PORT}`);
  console.log(`Webhook URL: POST /webhook`);
});
