const { google } = require('googleapis');
const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI
);
oauth2Client.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

const MASTER_CALENDAR_ID = 'e9e0dd4db1afa010ce95f6456fb8e6a59ccd0c834c0f94ff810453e3257b4f8a@group.calendar.google.com';

async function listMasterCalendar(timeMin, timeMax, maxResults) {
  try {
    const tMin = timeMin ? new Date(timeMin).toISOString() : new Date().toISOString();
    const tMax = timeMax ? new Date(timeMax).toISOString() : new Date(Date.now() + 14*24*60*60*1000).toISOString();
    const res = await calendar.events.list({
      calendarId: MASTER_CALENDAR_ID,
      timeMin: tMin, timeMax: tMax, maxResults: maxResults || 100,
      singleEvents: true, orderBy: 'startTime'
    });
    const items = res.data.items || [];
    if (items.length > 0) { console.log('Master calendar: ' + items.length + ' events'); return items; }
    console.log('Master calendar empty, falling back');
    return null;
  } catch(e) { console.log('Master cal error: ' + e.message); return null; }
}

async function listEvents(timeMin, timeMax, maxResults) {
  maxResults = maxResults || 50;
  const now = new Date();
  const tMin = timeMin ? new Date(timeMin).toISOString() : now.toISOString();
  const tMax = timeMax ? new Date(timeMax).toISOString() : new Date(now.getTime() + 14*24*60*60*1000).toISOString();
  const masterEvents = await listMasterCalendar(tMin, tMax, maxResults);
  if (masterEvents && masterEvents.length > 0) return masterEvents;
  const calList = await calendar.calendarList.list();
  const cals = calList.data.items || [];
  const perCal = Math.max(5, Math.ceil(maxResults / Math.max(cals.length, 1)));
  const results = await Promise.allSettled(
    cals.map(cal => calendar.events.list({
      calendarId: cal.id, timeMin: tMin, timeMax: tMax,
      maxResults: perCal, singleEvents: true, orderBy: 'startTime'
    }).then(res => (res.data.items || []).map(e => ({ ...e, calendarName: cal.summary }))))
  );
  const allEvents = [];
  for (const r of results) { if (r.status === 'fulfilled') allEvents.push(...r.value); }
  allEvents.sort((a,b) => (a.start?.dateTime||a.start?.date||'').localeCompare(b.start?.dateTime||b.start?.date||''));
  return allEvents.slice(0, maxResults);
}

async function createEvent(summary, start, end, description, calendarId) {
  const cal = calendarId || process.env.GOOGLE_CALENDAR_ID || 'primary';
  const res = await calendar.events.insert({ calendarId: cal, resource: { summary, description: description||'', start: { dateTime: start, timeZone: 'America/New_York' }, end: { dateTime: end, timeZone: 'America/New_York' } } });
  return res.data;
}

async function updateEvent(eventId, updates) {
  const calList = await calendar.calendarList.list();
  for (const cal of calList.data.items || []) {
    try { const res = await calendar.events.patch({ calendarId: cal.id, eventId, resource: updates }); return res.data; } catch(e) {}
  }
  throw new Error('Event not found');
}

async function deleteEvent(eventId) {
  const calList = await calendar.calendarList.list();
  for (const cal of calList.data.items || []) {
    try { await calendar.events.delete({ calendarId: cal.id, eventId }); return { success: true }; } catch(e) {}
  }
  return { success: false };
}

module.exports = { listEvents, listMasterCalendar, createEvent, updateEvent, deleteEvent };