require('dotenv').config();
const Anthropic = require('@anthropic-ai/sdk');
const https = require('https');
const http = require('http');
const { listEvents, createEvent, updateEvent, deleteEvent } = require('./calendar');
const fs = require('fs');
const path = require('path');
const cron = require('node-cron');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const DATA_DIR = __dirname;
const CONTEXT_FILE = path.join(DATA_DIR, 'family-context.json');
const TODOS_FILE = path.join(DATA_DIR, 'todos.json');
const SHOPPING_FILE = path.join(DATA_DIR, 'shopping.json');
const REMINDERS_FILE = path.join(DATA_DIR, 'reminders.json');

const chatHistories = {};
const MAX_HISTORY = 30;
const activeReminders = {};

// ── Data helpers ──
const load = (file, def) => { try { return JSON.parse(fs.readFileSync(file,'utf8')); } catch { return def; } };
const save = (file, data) => fs.writeFileSync(file, JSON.stringify(data, null, 2));
const loadContext = () => load(CONTEXT_FILE, { family: { dad:'Menachem', mom:'Chen', kids:['Ari','Isaac','Barack'], location:'East Aurora, NY' } });

// ── HTTP fetch helper ──
function fetch(url) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    mod.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => resolve(d));
    }).on('error', reject);
  });
}

// ── Weather ──
async function getWeather(location) {
  try {
    const raw = await fetch('https://wttr.in/' + encodeURIComponent(location) + '?format=j1');
    const data = JSON.parse(raw);
    const current = data.current_condition[0];
    const days = data.weather.slice(0, 3).map(d => {
      const date = new Date(d.date).toLocaleDateString('en-US', { weekday:'short', month:'short', day:'numeric' });
      const desc = d.hourly[4]?.weatherDesc[0]?.value || '';
      return date + ': ' + desc + ', high ' + d.maxtempF + '°F / low ' + d.mintempF + '°F';
    });
    return 'Right now: ' + current.weatherDesc[0].value + ', ' + current.temp_F + '°F (feels like ' + current.FeelsLikeF + '°F), ' + current.humidity + '% humidity\n3-day forecast:\n' + days.join('\n');
  } catch { return 'Weather unavailable'; }
}

// ── Stocks ──
async function getStockPrice(symbol) {
  try {
    const data = JSON.parse(await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=1d`));
    const q = data.chart.result[0];
    const price = q.meta.regularMarketPrice;
    const prev = q.meta.chartPreviousClose;
    const change = ((price - prev) / prev * 100).toFixed(2);
    return `${symbol}: $${price.toFixed(2)} (${change > 0 ? '+' : ''}${change}%)`;
  } catch { return `Could not fetch ${symbol}`; }
}

// ── Sports ──
async function getSportsScores(league) {
  try {
    const leagueMap = { nba:'basketball/nba', nfl:'football/nfl', mlb:'baseball/mlb', nhl:'hockey/nhl' };
    const l = leagueMap[league.toLowerCase()] || 'basketball/nba';
    const data = JSON.parse(await fetch(`https://site.api.espn.com/apis/site/v2/sports/${l}/scoreboard`));
    const games = data.events?.slice(0,5).map(e => {
      const comps = e.competitions[0];
      const teams = comps.competitors.map(c => `${c.team.abbreviation} ${c.score}`).join(' vs ');
      const status = comps.status.type.shortDetail;
      return `${teams} (${status})`;
    }) || [];
    return games.length ? games.join('\n') : 'No games found';
  } catch { return 'Scores unavailable'; }
}

// ── Todo list ──
function manageTodo(action, item, id) {
  const data = load(TODOS_FILE, { todos: [] });
  if (action === 'list') return data.todos.length ? data.todos : 'No todos yet';
  if (action === 'add') {
    const todo = { id: Date.now(), text: item, done: false, created: new Date().toISOString() };
    data.todos.push(todo);
    save(TODOS_FILE, data);
    return `Added: "${item}"`;
  }
  if (action === 'complete') {
    const todo = data.todos.find(t => t.id == id || t.text.toLowerCase().includes(item?.toLowerCase()));
    if (todo) { todo.done = true; save(TODOS_FILE, data); return `Done: "${todo.text}"`; }
    return 'Todo not found';
  }
  if (action === 'delete') {
    const before = data.todos.length;
    data.todos = data.todos.filter(t => t.id != id && !t.text.toLowerCase().includes(item?.toLowerCase()));
    save(TODOS_FILE, data);
    return `Removed ${before - data.todos.length} item(s)`;
  }
  return 'Unknown action';
}

// ── Shopping list ──
function manageShoppingList(action, item) {
  const data = load(SHOPPING_FILE, { list: [] });
  if (action === 'list') return data.list.length ? data.list.map(i => `${i.done ? '✓' : '○'} ${i.item}`).join('\n') : 'Shopping list is empty';
  if (action === 'add') {
    data.list.push({ item, done: false });
    save(SHOPPING_FILE, data);
    return `Added "${item}" to shopping list`;
  }
  if (action === 'check') {
    const found = data.list.find(i => i.item.toLowerCase().includes(item.toLowerCase()));
    if (found) { found.done = true; save(SHOPPING_FILE, data); return `Checked off "${found.item}"`; }
    return 'Item not found';
  }
  if (action === 'clear') { data.list = data.list.filter(i => !i.done); save(SHOPPING_FILE, data); return 'Cleared completed items'; }
  return 'Unknown action';
}

// ── Reminders ──
let sendMessageFn = null;
function setSendMessage(fn) { sendMessageFn = fn; }

function scheduleReminder(reminder) {
  const fireTime = new Date(reminder.fireAt);
  const now = new Date();
  if (fireTime <= now) return;
  const delay = fireTime - now;
  const timer = setTimeout(async () => {
    if (sendMessageFn) {
      try { await sendMessageFn(reminder.chatId, `⏰ Reminder: ${reminder.text}`); }
      catch(e) { console.error('Reminder send error:', e.message); }
    }
    const data = load(REMINDERS_FILE, { reminders: [] });
    data.reminders = data.reminders.filter(r => r.id !== reminder.id);
    save(REMINDERS_FILE, data);
    delete activeReminders[reminder.id];
  }, delay);
  activeReminders[reminder.id] = timer;
}

function loadAndScheduleReminders() {
  const data = load(REMINDERS_FILE, { reminders: [] });
  const now = new Date();
  data.reminders = data.reminders.filter(r => new Date(r.fireAt) > now);
  save(REMINDERS_FILE, data);
  data.reminders.forEach(scheduleReminder);
  console.log(`Loaded ${data.reminders.length} pending reminder(s)`);
}

function setReminder(chatId, text, fireAt) {
  const reminder = { id: Date.now(), chatId, text, fireAt: new Date(fireAt).toISOString() };
  const data = load(REMINDERS_FILE, { reminders: [] });
  data.reminders.push(reminder);
  save(REMINDERS_FILE, data);
  scheduleReminder(reminder);
  return `Reminder set for ${new Date(fireAt).toLocaleString('en-US', { timeZone: 'America/New_York' })}`;
}

function listReminders(chatId) {
  const data = load(REMINDERS_FILE, { reminders: [] });
  const mine = data.reminders.filter(r => r.chatId === chatId);
  if (!mine.length) return 'No pending reminders';
  return mine.map(r => `• ${r.text} — ${new Date(r.fireAt).toLocaleString('en-US', { timeZone: 'America/New_York' })}`).join('\n');
}

// ── Find free time ──
async function findFreeTime(date, durationMinutes) {
  const day = new Date(date);
  const start = new Date(day); start.setHours(8, 0, 0, 0);
  const end = new Date(day); end.setHours(19, 0, 0, 0);
  const events = await listEvents(start.toISOString(), end.toISOString(), 50);
  const busy = events.map(e => ({
    start: new Date(e.start?.dateTime || e.start?.date),
    end: new Date(e.end?.dateTime || e.end?.date)
  })).sort((a,b) => a.start - b.start);

  const slots = [];
  let cursor = start;
  for (const b of busy) {
    if (b.start - cursor >= durationMinutes * 60000) {
      slots.push(`${cursor.toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit',hour12:true,timeZone:'America/New_York'})} – ${b.start.toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit',hour12:true,timeZone:'America/New_York'})}`);
    }
    if (b.end > cursor) cursor = b.end;
  }
  if (end - cursor >= durationMinutes * 60000) {
    slots.push(`${cursor.toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit',hour12:true,timeZone:'America/New_York'})} – ${end.toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit',hour12:true,timeZone:'America/New_York'})}`);
  }
  return slots.length ? slots.join(', ') : 'No free slots found';
}

// ── Tools definition ──
const customTools = [
  { name: 'list_events', description: 'List calendar events. Use broad ranges to avoid missing events.', input_schema: { type:'object', properties: { time_min:{type:'string',description:'ISO datetime'}, time_max:{type:'string',description:'ISO datetime'}, max_results:{type:'number'} } } },
  { name: 'create_event', description: 'Create a calendar event', input_schema: { type:'object', properties: { summary:{type:'string'}, start:{type:'string',description:'ISO datetime in ET'}, end:{type:'string',description:'ISO datetime in ET'}, description:{type:'string'}, calendar:{type:'string',description:'primary or email of target calendar'} }, required:['summary','start','end'] } },
  { name: 'update_event', description: 'Update/reschedule an existing calendar event', input_schema: { type:'object', properties: { event_id:{type:'string'}, summary:{type:'string'}, start:{type:'string'}, end:{type:'string'}, description:{type:'string'} }, required:['event_id'] } },
  { name: 'delete_event', description: 'Delete a calendar event', input_schema: { type:'object', properties: { event_id:{type:'string'} }, required:['event_id'] } },
  { name: 'find_free_time', description: 'Find free time slots on a given day', input_schema: { type:'object', properties: { date:{type:'string',description:'ISO date'}, duration_minutes:{type:'number'} }, required:['date','duration_minutes'] } },
  { name: 'get_weather', description: 'Get weather for a location', input_schema: { type:'object', properties: { location:{type:'string'} }, required:['location'] } },
  { name: 'get_stock', description: 'Get stock price and daily change', input_schema: { type:'object', properties: { symbol:{type:'string',description:'Stock ticker e.g. AAPL'} }, required:['symbol'] } },
  { name: 'get_sports_scores', description: 'Get sports scores. Leagues: nba, nfl, mlb, nhl', input_schema: { type:'object', properties: { league:{type:'string'} }, required:['league'] } },
  { name: 'manage_todo', description: 'Manage todo list. Actions: list, add, complete, delete', input_schema: { type:'object', properties: { action:{type:'string'}, item:{type:'string'}, id:{type:'number'} }, required:['action'] } },
  { name: 'manage_shopping', description: 'Manage shopping list. Actions: list, add, check, clear', input_schema: { type:'object', properties: { action:{type:'string'}, item:{type:'string'} }, required:['action'] } },
  { name: 'set_reminder', description: 'Set a reminder to fire at a specific time', input_schema: { type:'object', properties: { text:{type:'string'}, fire_at:{type:'string',description:'ISO datetime in ET'} }, required:['text','fire_at'] } },
  { name: 'list_reminders', description: 'List pending reminders', input_schema: { type:'object', properties: {} } },
  { name: 'update_family_knowledge', description: 'Save important info for future use', input_schema: { type:'object', properties: { key:{type:'string'}, value:{type:'string'} }, required:['key','value'] } },
  { name: 'draft_message', description: 'Draft an email or message for review', input_schema: { type:'object', properties: { to:{type:'string'}, subject:{type:'string'}, body:{type:'string'}, type:{type:'string',description:'email or text'} }, required:['to','body'] } }
];

const allTools = [
  { type: 'web_search_20250305', name: 'web_search' },
  ...customTools
];

// ── Execute tools ──
async function executeTool(name, input, chatId) {
  if (name === 'list_events') return listEvents(input.time_min, input.time_max, input.max_results);
  if (name === 'create_event') return createEvent(input.summary, input.start, input.end, input.description, input.calendar);
  if (name === 'update_event') return updateEvent(input.event_id, { summary: input.summary, start: input.start ? { dateTime: input.start, timeZone: 'America/New_York' } : undefined, end: input.end ? { dateTime: input.end, timeZone: 'America/New_York' } : undefined, description: input.description });
  if (name === 'delete_event') return deleteEvent(input.event_id);
  if (name === 'find_free_time') return findFreeTime(input.date, input.duration_minutes);
  if (name === 'get_weather') return getWeather(input.location);
  if (name === 'get_stock') return getStockPrice(input.symbol);
  if (name === 'get_sports_scores') return getSportsScores(input.league);
  if (name === 'manage_todo') return manageTodo(input.action, input.item, input.id);
  if (name === 'manage_shopping') return manageShoppingList(input.action, input.item);
  if (name === 'set_reminder') return setReminder(chatId, input.text, input.fire_at);
  if (name === 'list_reminders') return listReminders(chatId);
  if (name === 'draft_message') return `DRAFT (${input.type || 'message'}) to ${input.to}:\n${input.subject ? 'Subject: ' + input.subject + '\n' : ''}${input.body}`;
  if (name === 'update_family_knowledge') {
    const ctx = loadContext();
    ctx[input.key] = input.value;
    save(CONTEXT_FILE, ctx);
    return { saved: true };
  }
}

// ── Main process ──
async function processMessage(userMessage, chatId) {
  const ctx = loadContext();
  const now = new Date().toLocaleString('en-US', {
    timeZone: 'America/New_York', weekday:'long', year:'numeric',
    month:'long', day:'numeric', hour:'2-digit', minute:'2-digit'
  });

  const system = `You are the Katz family's personal assistant, running in their private Telegram. Right now it's ${now} (Eastern Time).

About the family:
- Menachem: Dad, Co-CEO of Steuben Foods (aseptic contract manufacturing, ~800 employees, Elma NY) and Elmhurst 1925 (plant-based milks). Deeply involved in a $335M SIG partnership deal. Very busy, direct, no-fluff communication style.
- Chen: Mom. Has her own calendar.
- Kids: Ari, Isaac, Barack
- Home: East Aurora, NY 14052

Stored info: ${JSON.stringify(ctx)}

Your capabilities:
- Full calendar access via list_events tool which reads ALL connected calendars automatically (Menachem Steuben Outlook, Google Calendar, Chen Katz calendar, Family calendar). NEVER try to access calendars by email address directly - always use list_events.
- Create, update, reschedule, delete events
- Find free time slots
- Set and manage reminders
- Todo list and shopping list
- Live weather, stock prices, sports scores
- Web search for news, research, anything current
- Draft emails and messages
- Answer any question, do any task

How to respond:
- Talk like a smart friend who happens to be incredibly capable and organized. Not like a bot.
- Match the energy of the message — casual gets casual, urgent gets direct.
- Never use sign-offs like "Best," or "— Your assistant" or "Claude"
- Skip the headers and bullet formatting for simple conversational replies. Use it only when a list genuinely helps (e.g. a full day's schedule).
- When someone asks "what's on my calendar" give the actual highlights, not just a time dump.
- If you notice a conflict or something worth flagging, just say it naturally.
- For news: actually summarize what's happening, don't just list sources.
- For Hebrew text in calendar events: translate naturally in context.`;

  if (!chatHistories[chatId]) chatHistories[chatId] = [];
  const history = chatHistories[chatId];
  history.push({ role: 'user', content: userMessage });
  while (history.length > MAX_HISTORY) history.shift();
  const messages = [...history];

  for (let i = 0; i < 10; i++) {
    const res = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      system,
      tools: allTools,
      messages
    });

    if (res.stop_reason === 'end_turn') {
      const t = res.content.find(b => b.type === 'text');
      const reply = t ? t.text : null;
      if (reply) {
        history.push({ role: 'assistant', content: reply });
        while (history.length > MAX_HISTORY) history.shift();
      }
      return reply;
    }

    if (res.stop_reason === 'tool_use') {
      messages.push({ role: 'assistant', content: res.content });
      const results = [];
      for (const block of res.content) {
        if (block.type === 'tool_use') {
          try {
            const result = await executeTool(block.name, block.input, chatId);
            results.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(result) });
          } catch(e) {
            console.error('Tool error:', block.name, e.message);
            results.push({ type: 'tool_result', tool_use_id: block.id, content: 'Error: ' + e.message, is_error: true });
          }
        }
      }
      messages.push({ role: 'user', content: results });
    } else {
      const t = res.content.find(b => b.type === 'text');
      return t ? t.text : null;
    }
  }
}

module.exports = { processMessage, loadAndScheduleReminders, setSendMessage };

// Export timeout wrapper
async function processMessageSafe(userMessage, chatId) {
  const timeout = new Promise((_, reject) => 
    setTimeout(() => reject(new Error('timeout')), 25000)
  );
  return Promise.race([processMessage(userMessage, chatId), timeout]);
}
module.exports.processMessageSafe = processMessageSafe;
