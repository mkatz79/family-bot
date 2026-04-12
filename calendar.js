const { google } = require('googleapis');

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI
);

oauth2Client.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

async function getAllCalendarIds() {
  const res = await calendar.calendarList.list();
  return res.data.items.map(c => ({ id: c.id, name: c.summary }));
}

async function listEvents(timeMin, timeMax, maxResults = 20) {
  const cals = await getAllCalendarIds();
  const allEvents = [];
  for (const cal of cals) {
    try {
      const res = await calendar.events.list({
        calendarId: cal.id,
        timeMin: timeMin || new Date().toISOString(),
        timeMax: timeMax,
        maxResults: maxResults,
        singleEvents: true,
        orderBy: 'startTime',
      });
      const events = (res.data.items || []).map(e => ({ ...e, calendarName: cal.name }));
      allEvents.push(...events);
    } catch(e) {
      // skip calendars we can't read
    }
  }
  allEvents.sort((a, b) => {
    const aTime = a.start?.dateTime || a.start?.date || '';
    const bTime = b.start?.dateTime || b.start?.date || '';
    return aTime.localeCompare(bTime);
  });
  return allEvents.slice(0, maxResults);
}

async function createEvent(summary, start, end, description = '') {
  const res = await calendar.events.insert({
    calendarId: process.env.GOOGLE_CALENDAR_ID || 'primary',
    resource: {
      summary, description,
      start: { dateTime: start, timeZone: 'America/New_York' },
      end: { dateTime: end, timeZone: 'America/New_York' },
    }
  });
  return res.data;
}

async function updateEvent(eventId, updates) {
  const res = await calendar.events.patch({
    calendarId: process.env.GOOGLE_CALENDAR_ID || 'primary',
    eventId, resource: updates
  });
  return res.data;
}

async function deleteEvent(eventId) {
  await calendar.events.delete({
    calendarId: process.env.GOOGLE_CALENDAR_ID || 'primary',
    eventId
  });
  return { success: true };
}

module.exports = { listEvents, createEvent, updateEvent, deleteEvent };
