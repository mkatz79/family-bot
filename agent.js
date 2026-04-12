require('dotenv').config();
const Anthropic = require('@anthropic-ai/sdk');
const { listEvents, createEvent, updateEvent, deleteEvent } = require('./calendar');
const fs = require('fs');
const path = require('path');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const CONTEXT_FILE = path.join(__dirname, 'family-context.json');

function loadFamilyContext() {
  try { return JSON.parse(fs.readFileSync(CONTEXT_FILE, 'utf8')); }
  catch { return { family: { dad: 'Menachem', mom: 'Chen', kids: ['Ari','Isaac','Barack'], location: 'East Aurora, NY' }, preferences: {}, notes: [] }; }
}

const tools = [
  { name: 'list_events', description: 'List calendar events', input_schema: { type: 'object', properties: { time_min: { type: 'string' }, time_max: { type: 'string' }, max_results: { type: 'number' } } } },
  { name: 'create_event', description: 'Create a calendar event', input_schema: { type: 'object', properties: { summary: { type: 'string' }, start: { type: 'string' }, end: { type: 'string' }, description: { type: 'string' } }, required: ['summary','start','end'] } },
  { name: 'delete_event', description: 'Delete a calendar event', input_schema: { type: 'object', properties: { event_id: { type: 'string' } }, required: ['event_id'] } },
  { name: 'update_family_knowledge', description: 'Save family info', input_schema: { type: 'object', properties: { key: { type: 'string' }, value: { type: 'string' } }, required: ['key','value'] } }
];

async function executeTool(name, input) {
  if (name === 'list_events') return listEvents(input.time_min, input.time_max, input.max_results);
  if (name === 'create_event') return createEvent(input.summary, input.start, input.end, input.description);
  if (name === 'delete_event') return deleteEvent(input.event_id);
  if (name === 'update_family_knowledge') {
    const ctx = loadFamilyContext();
    ctx[input.key] = input.value;
    fs.writeFileSync(CONTEXT_FILE, JSON.stringify(ctx, null, 2));
    return { saved: true };
  }
}

async function processMessage(userMessage, chatId) {
  const familyContext = loadFamilyContext();
  const now = new Date().toLocaleString('en-US', { timeZone: 'America/New_York' });
  const system = `You are the Katz family assistant. Current time: ${now}. Family: Menachem (Dad), Chen (Mom), kids: Ari, Isaac, Barack. Location: East Aurora, NY. Context: ${JSON.stringify(familyContext)}. Help with calendar, scheduling, reminders. Be warm and concise.`;
  const messages = [{ role: 'user', content: userMessage }];
  for (let i = 0; i < 5; i++) {
    const res = await anthropic.messages.create({ model: 'claude-sonnet-4-20250514', max_tokens: 1024, system, tools, messages });
    if (res.stop_reason === 'end_turn') {
      const t = res.content.find(b => b.type === 'text');
      return t ? t.text : null;
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
            results.push({ type: 'tool_result', tool_use_id: block.id, content: `Error: ${e.message}`, is_error: true });
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
