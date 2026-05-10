const { google } = require('googleapis');

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI
);
oauth2Client.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

async function listEvents(timeMin, timeMax, maxResults = 50) {
  const now = new Date();
  const tMin = timeMin ? new Date(timeMin).toISOString() : now.toISOString();
  const tMax = timeMax ? new Date(timeMax).toISOString() : new Date(now.getTime() + 14*24*60*60*1000).toISOString();
  const calList = await calendar.calendarList.list();
  const cals = calList.data.items || [];
  const allEvents = [];
  for (const cal of cals) {
    try {
      const res = await calendar.events.list({ calendarId: cal.id, timeMin: tMin, timeMax: tMax, maxResults, singleEvents: true, orderBy: 'startTime' });
      const events = (res.data.items || []).map(e => ({ ...e, calendarName: cal.summary }));
      allEvents.push(...events);
    } catch(e) {}
  }
  allEvents.sort((a,b) => (a.start?.dateTime||a.start?.date||'').localeCompare(b.start?.dateTime||b.start?.date||''));
  return allEvents.slice(0, maxResults);
}

async function createEvent(summary, start, end, description='', calendarId) {
  const cal = calendarId || process.env.GOOGLE_CALENDAR_ID || 'primary';
  const res = await calendar.events.insert({
    calendarId: cal,
    resource: { summary, description, start: { dateTime: start, timeZone: 'America/New_York' }, end: { dateTime: end, timeZone: 'America/New_York' } }
  });
  return res.data;
}

async function updateEvent(eventId, updates) {
  // Find which calendar has this event
  const calList = await calendar.calendarList.list();
  for (const cal of calList.data.items || []) {
    try {
      const res = await calendar.events.patch({ calendarId: cal.id, eventId, resource: updates });
      return res.data;
    } catch(e) {}
  }
  throw new Error('Event not found in any calendar');
}

async function deleteEvent(eventId) {
  const calList = await calendar.calendarList.list();
  for (const cal of calList.data.items || []) {
    try { await calendar.events.delete({ calendarId: cal.id, eventId }); return { success: true }; }
    catch(e) {}
  }
  return { success: false, error: 'Event not found' };
}

module.exports = { listEvents, createEvent, updateEvent, deleteEvent };
