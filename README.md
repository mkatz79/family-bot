# Family Scheduler Bot 🗓️

A WhatsApp group bot that manages your family's schedule, powered by Claude AI + Google Calendar.

**What it does:**
- Add and view events on a shared Google Calendar
- Send automatic reminders 60 minutes before events
- Answer questions like "What's happening this week?" or "Is Saturday free?"
- Help coordinate who's available when
- Learn your family's routines over time

---

## Setup Guide

### Prerequisites
- Node.js 18+
- A Google account (for Calendar)
- A free Twilio account

---

### Step 1 — Install dependencies

```bash
npm install
cp .env.example .env
```

---

### Step 2 — Get your Anthropic API key

1. Go to https://console.anthropic.com
2. Create an API key
3. Add it to `.env`:  `ANTHROPIC_API_KEY=sk-ant-...`

---

### Step 3 — Set up Twilio WhatsApp Sandbox

This gives you a WhatsApp number for free (no approval needed for testing).

1. Sign up at https://twilio.com (free account)
2. In the Twilio console, go to **Messaging → Try it out → Send a WhatsApp message**
3. You'll see a sandbox number (e.g. `+14155238886`) and a join code
4. **On every phone** that should use the bot: send the join code to the sandbox number in WhatsApp  
   (e.g., `join <your-code>` to `+14155238886`)
5. Add to `.env`:
   ```
   TWILIO_ACCOUNT_SID=AC...        ← from Twilio console dashboard
   TWILIO_AUTH_TOKEN=...           ← from Twilio console dashboard
   TWILIO_WHATSAPP_NUMBER=+14155238886
   WHATSAPP_GROUP_ID=+1XXXXXXXXXX  ← your own phone number (for sandbox)
   ```

> **Note on groups:** Twilio's sandbox works with individual numbers. For a true WhatsApp group,
> you'll need a Twilio-approved WhatsApp Business number (takes ~1 day to set up via Twilio's 
> channel approval). For now, the bot responds to and messages individual numbers.

---

### Step 4 — Set up Google Calendar API

**4a. Create a Google Cloud project:**
1. Go to https://console.cloud.google.com
2. Create a new project (e.g., "Family Bot")
3. Go to **APIs & Services → Enable APIs**
4. Search for and enable **Google Calendar API**

**4b. Create OAuth2 credentials:**
1. Go to **APIs & Services → Credentials**
2. Click **Create Credentials → OAuth client ID**
3. Application type: **Desktop app**
4. Name it "Family Bot"
5. Download the JSON — copy `client_id` and `client_secret` to `.env`

**4c. Configure OAuth consent screen:**
1. Go to **APIs & Services → OAuth consent screen**
2. Set to **External**, fill in app name
3. Under **Scopes**, add `https://www.googleapis.com/auth/calendar`
4. Under **Test users**, add your Google account email

**4d. Get your refresh token:**
```bash
node scripts/google-auth.js
```
Follow the prompts — it opens a URL, you authorize, paste the code back, and it prints your `GOOGLE_REFRESH_TOKEN`. Add it to `.env`.

**4e. Set your calendar ID:**
- Use `primary` for your main calendar
- Or go to Google Calendar → Settings → click a calendar → scroll to "Calendar ID"
- Add to `.env`: `GOOGLE_CALENDAR_ID=primary`

---

### Step 5 — Run locally (for testing)

```bash
npm run dev
```

The server starts on `http://localhost:3000`.

To receive Twilio webhooks locally, use ngrok:
```bash
npx ngrok http 3000
```

Copy the `https://...ngrok.io` URL. In Twilio console:
- Go to **Messaging → Settings → WhatsApp Sandbox Settings**
- Set **"When a message comes in"** to: `https://your-ngrok-url/webhook`
- Method: POST

Send a WhatsApp message to the sandbox number and you should get a reply!

---

### Step 6 — Deploy to Railway (free hosting)

1. Push your code to a GitHub repo (make sure `.env` is in `.gitignore`)
2. Go to https://railway.app and sign in with GitHub
3. New Project → Deploy from GitHub repo
4. Add all your environment variables from `.env` in Railway's Variables tab
5. Railway gives you a public URL — set that as your Twilio webhook:  
   `https://your-app.railway.app/webhook`

---

### Step 7 — Tell the bot about your family

Send a message like:
> "Hey, our family is the Katz family — I'm Menachem, my wife is Chen, and our kids are Ari, Isaac, and Barack."

The bot will remember this and use it when coordinating schedules.

---

## Example conversations

**Adding events:**
> "Add soccer practice for Ari this Saturday at 10am, should be done by noon"

**Viewing schedule:**
> "What's happening this week?"

**Checking availability:**
> "Is next Friday evening free for everyone?"

**Reminders:**
> Automatically sent 60 min before each event (configurable in `.env`)

**Learning routines:**
> "Ari has school Monday through Friday, 8am to 3pm"  
> The bot stores this and won't schedule conflicts.

---

## Troubleshooting

**Bot not responding:** Check that your Twilio webhook URL is correct and the server is running.

**Calendar errors:** Re-run `node scripts/google-auth.js` — your refresh token may have expired if you didn't complete setup.

**"Message not delivered":** In sandbox mode, all phones need to have joined the sandbox (Step 3, send the join code).

---

## Upgrading to a real WhatsApp number

For a permanent setup (no sandbox join required):
1. In Twilio console, go to **Messaging → Senders → WhatsApp Senders**
2. Apply for a WhatsApp Business number (~$0.005/message after free tier)
3. Update `TWILIO_WHATSAPP_NUMBER` in your `.env`
