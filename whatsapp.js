const twilio = require('twilio');

const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

/**
 * Send a WhatsApp message via Twilio.
 * @param {string} to - Recipient in "whatsapp:+1XXXXXXXXXX" format (or a group ID)
 * @param {string} message - Message body
 */
async function sendWhatsAppMessage(to, message) {
  if (!to) {
    console.warn('sendWhatsAppMessage: no recipient set (WHATSAPP_GROUP_ID missing?)');
    return;
  }

  const formattedTo = to.startsWith('whatsapp:') ? to : `whatsapp:${to}`;

  await client.messages.create({
    from: `whatsapp:${process.env.TWILIO_WHATSAPP_NUMBER}`,
    to: formattedTo,
    body: message
  });
}

module.exports = { sendWhatsAppMessage };
