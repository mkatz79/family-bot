const { google } = require('googleapis');

// ─── OAuth2 client setup ──────────────────────────────────────────────────────

function getCalendarClient() {
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/auth/callback'
  );

  oauth2Client.setCredentials({
    refresh_token: process.env.GOOGLE_REFRESH_TOKEN
  });

  return google.calendar({ version: 'v3', auth: oauth2Client });
}

const CALENDAR_ID = process.env.GOOGLE_CALENDAR_ID || 'primary';

// ─── Create event ─────────────────────────────────────────────────────────────

async function createEvent({ title, startDatetime, endDatetime, description, location, attendees, reminderMinutes = 60 }) {
  const calendar = getCalendarClient();

  const event = {
    summary: title,
    description: description || '',
    location: location || '',
    start: { dateTime: startDatetime, timeZone: 'America/New_York' },
    end: { dateTime: endDatetime, timeZone: 'America/New_York' },
    reminders: {
      useDefault: false,
      overrides: [
        { method: 'popup', minutes: reminderMinutes }
      ]
    }
  };

  // Store attendees in description if provided (simpler than email-based attendees)
  if (attendees?.length) {
    event.description = `Attendees: ${attendees.join(', ')}${description ? '\n\n' + description : ''}`;
  }

  const response = await calendar.events.insert({
    calendarId: CALENDAR_ID,
    resource: event
  });

  return response.data;
}

// ─── Get events ───────────────────────────────────────────────────────────────

async function getEvents(startDate, endDate, searchQuery) {
  const calendar = getCalendarClient();

  const params = {
    calendarId: CALENDAR_ID,
    timeMin: new Date(startDate).toISOString(),
    timeMax: new Date(endDate).toISOString(),
    singleEvents: true,
    orderBy: 'startTime',
    maxResults: 25
  };

  if (searchQuery) {
    params.q = searchQuery;
  }

  const response = await calendar.events.list(params);
  return response.data.items || [];
}

// ─── Update event ─────────────────────────────────────────────────────────────

async function updateEvent(eventId, updates) {
  const calendar = getCalendarClient();

  // First get existing event
  const existing = await calendar.events.get({ calendarId: CALENDAR_ID, eventId });
  const event = existing.data;

  if (updates.title) event.summary = updates.title;
  if (updates.description) event.description = updates.description;
  if (updates.location) event.location = updates.location;
  if (updates.startDatetime) event.start = { dateTime: updates.startDatetime, timeZone: 'America/New_York' };
  if (updates.endDatetime) event.end = { dateTime: updates.endDatetime, timeZone: 'America/New_York' };

  const response = await calendar.events.update({
    calendarId: CALENDAR_ID,
    eventId,
    resource: event
  });

  return response.data;
}

// ─── Delete event ─────────────────────────────────────────────────────────────

async function deleteEvent(eventId) {
  const calendar = getCalendarClient();
  await calendar.events.delete({ calendarId: CALENDAR_ID, eventId });
  return { success: true };
}

// ─── Get upcoming events that need reminders ──────────────────────────────────
// Called every 15 minutes by the cron job. Returns events starting in the
// next 15-75 minutes that haven't already been reminded.

const remindedEvents = new Set(); // In-memory dedup; resets on server restart

async function getUpcomingReminders() {
  const now = new Date();
  const windowStart = new Date(now.getTime() + 15 * 60000);   // 15 min from now
  const windowEnd = new Date(now.getTime() + 75 * 60000);     // 75 min from now

  const events = await getEvents(windowStart.toISOString(), windowEnd.toISOString());

  const toRemind = events.filter(e => {
    if (remindedEvents.has(e.id)) return false;
    remindedEvents.add(e.id);
    return true;
  });

  return toRemind;
}

module.exports = { createEvent, getEvents, updateEvent, deleteEvent, getUpcomingReminders };
