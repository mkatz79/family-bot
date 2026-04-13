require('dotenv').config();
const Anthropic = require('@anthropic-ai/sdk');
const https = require('https');
const { listEvents, createEvent, updateEvent, deleteEvent } = require('./calendar');
const fs = require('fs');
const path = require('path');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const CONTEXT_FILE = path.join(__dirname, 'family-context.json');
const chatHistories = {};
const MAX_HISTORY = 20;

function loadFamilyContext() {
  try { return JSON.parse(fs.readFileSync(CONTEXT_FILE, 'utf8')); }
  catch { return { family: { dad: 'Menachem', mom: 'Chen', kids: ['Ari','Isaac','Barack'], location: 'East Aurora, NY' } }; }
}

function getWeather(location) {
  return new Promise((resolve) => {
    https.get('https://wttr.in/' + encodeURIComponent(location) + '?format=3', (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => resolve(d.trim()));
    }).on('error', () => resolve('Weather unavailable'));
  });
}

const customTools = [
  { name: 'list_events', description: 'List calendar events for a time range', input_schema: { type: 'object', properties: { time_min: { type: 'string' }, time_max: { type: 'string' }, max_results: { type: 'number' } } } },
  { name: 'create_event', description: 'Create a calendar event', input_schema: { type: 'object', properties: { summary: { type: 'string' }, start: { type: 'string' }, end: { type: 'string' }, description: { type: 'string' } }, required: ['summary','start','end'] } },
  { name: 'delete_event', description: 'Delete a calendar event by ID', input_schema: { type: 'object', properties: { event_id: { type: 'string' } }, required: ['event_id'] } },
  { name: 'get_weather', description: 'Get current weather for a location', input_schema: { type: 'object', properties: { location: { type: 'string' } }, required: ['location'] } },
  { name: 'update_family_knowledge', description: 'Save important family info for future reference', input_schema: { type: 'object', properties: { key: { type: 'string' }, value: { type: 'string' } }, required: ['key','value'] } }
];

const allTools = [
  { type: 'web_search_20250305', name: 'web_search' },
  ...customTools
];

async function executeTool(name, input) {
  if (name === 'list_events') return listEvents(input.time_min, input.time_max, input.max_results);
  if (name === 'create_event') return createEvent(input.summary, input.start, input.end, input.description);
  if (name === 'delete_event') return deleteEvent(input.event_id);
  if (name === 'get_weather') return getWeather(input.location);
  if (name === 'update_family_knowledge') {
    const ctx = loadFamilyContext();
    ctx[input.key] = input.value;
    fs.writeFileSync(CONTEXT_FILE, JSON.stringify(ctx, null, 2));
    return { saved: true };
  }
}

async function processMessage(userMessage, chatId) {
  const familyContext = loadFamilyContext();
  const now = new Date().toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' });

  const system = 'You are the Katz family personal assistant on Telegram. Current time: ' + now + ' Eastern.\n\nFamily: Menachem (Dad, Co-CEO Steuben Foods & Elmhurst 1925), Chen (Mom), kids: Ari, Isaac, Barack. East Aurora NY.\nStored context: ' + JSON.stringify(familyContext) + '\n\nYou can: check calendar, add/delete events, get weather, search the web for news/info, answer anything.\n\nBe warm, direct and conversational - like Claude in a chat. No sign-offs or "Best,". Plain text, no heavy markdown.';

  if (!chatHistories[chatId]) chatHistories[chatId] = [];
  const history = chatHistories[chatId];
  history.push({ role: 'user', content: userMessage });
  while (history.length > MAX_HISTORY) history.shift();

  const messages = [...history];

  for (let i = 0; i < 8; i++) {
    const res = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
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
            const result = await executeTool(block.name, block.input);
            results.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(result) });
          } catch(e) {
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

module.exports = { processMessage };
