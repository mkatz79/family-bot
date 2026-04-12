const Anthropic = require('@anthropic-ai/sdk');
const fs = require('fs');
const path = require('path');
const { createEvent, getEvents, deleteEvent, updateEvent } = require('./calendar');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const CONTEXT_FILE = path.join(__dirname, 'family-context.json');

// In-memory conversation history per sender (persists for session)
const conversationHistory = new Map();

// ─── Family context: what the bot learns and remembers ──────────────────────

function loadFamilyContext() {
  try {
    return JSON.parse(fs.readFileSync(CONTEXT_FILE, 'utf8'));
  } catch {
    const blank = {
      family_name: '',
      members: [],
      routines: [],
      preferences: [],
      notes: []
    };
    saveFamilyContext(blank);
    return blank;
  }
}

function saveFamilyContext(context) {
  fs.writeFileSync(CONTEXT_FILE, JSON.stringify(context, null, 2));
}

// ─── Tool definitions for Claude ─────────────────────────────────────────────

const tools = [
  {
    name: 'create_calendar_event',
    description: 'Add a new event to the family Google Calendar.',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Event title' },
        start_datetime: { type: 'string', description: 'ISO 8601 datetime, e.g. 2026-04-15T09:00:00' },
        end_datetime: { type: 'string', description: 'ISO 8601 datetime' },
        description: { type: 'string', description: 'Optional notes or details about the event' },
        location: { type: 'string', description: 'Optional location' },
        attendees: {
          type: 'array',
          items: { type: 'string' },
          description: 'Family members involved, e.g. ["Ari", "Mom"]'
        },
        reminder_minutes_before: {
          type: 'number',
          description: 'Minutes before event to send a WhatsApp reminder. Default: 60'
        }
      },
      required: ['title', 'start_datetime', 'end_datetime']
    }
  },
  {
    name: 'get_calendar_events',
    description: 'Get events from the family calendar for a date range. Use this to answer questions like "what\'s happening this week" or "what does Saturday look like".',
    input_schema: {
      type: 'object',
      properties: {
        start_date: { type: 'string', description: 'Start of range, ISO 8601 date or datetime' },
        end_date: { type: 'string', description: 'End of range, ISO 8601 date or datetime' },
        search_query: { type: 'string', description: 'Optional keyword to filter events' }
      },
      required: ['start_date', 'end_date']
    }
  },
  {
    name: 'update_calendar_event',
    description: 'Update an existing calendar event by its ID.',
    input_schema: {
      type: 'object',
      properties: {
        event_id: { type: 'string', description: 'The Google Calendar event ID' },
        title: { type: 'string' },
        start_datetime: { type: 'string' },
        end_datetime: { type: 'string' },
        description: { type: 'string' },
        location: { type: 'string' }
      },
      required: ['event_id']
    }
  },
  {
    name: 'delete_calendar_event',
    description: 'Remove an event from the family calendar.',
    input_schema: {
      type: 'object',
      properties: {
        event_id: { type: 'string', description: 'The Google Calendar event ID' },
        event_title: { type: 'string', description: 'Title of the event (for confirmation message)' }
      },
      required: ['event_id', 'event_title']
    }
  },
  {
    name: 'update_family_knowledge',
    description: 'Store or update something you\'ve learned about the family — a person\'s schedule, a routine, a preference, or any useful context for future scheduling.',
    input_schema: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          enum: ['member', 'routine', 'preference', 'note'],
          description: '"member" to add/update a family member profile, "routine" for recurring patterns, "preference" for scheduling preferences, "note" for general observations'
        },
        data: {
          type: 'object',
          description: 'The information to store. For member: {name, role, schedule_notes}. For routine: {description, days, time}. For preference: {person, description}. For note: {text}.'
        }
      },
      required: ['type', 'data']
    }
  }
];

// ─── Core agent function ──────────────────────────────────────────────────────

async function processMessage(phoneNumber, senderName, userMessage) {
  const familyContext = loadFamilyContext();

  // Initialize or retrieve conversation history for this sender
  if (!conversationHistory.has(phoneNumber)) {
    conversationHistory.set(phoneNumber, []);
  }
  const history = conversationHistory.get(phoneNumber);
  history.push({ role: 'user', content: userMessage });

  // Build system prompt with everything we know about the family
  const systemPrompt = buildSystemPrompt(familyContext, senderName);

  let messages = [...history];
  let finalResponse = null;

  // Agentic loop: keep going until Claude stops using tools
  while (true) {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      system: systemPrompt,
      tools,
      messages
    });

    // Add assistant's response to the running messages
    messages.push({ role: 'assistant', content: response.content });

    if (response.stop_reason !== 'tool_use') {
      // Done — extract the text reply
      const textBlock = response.content.find(b => b.type === 'text');
      finalResponse = textBlock?.text || "Got it! Let me know if you need anything else.";
      break;
    }

    // Handle tool calls
    const toolResults = [];
    for (const block of response.content) {
      if (block.type !== 'tool_use') continue;

      let result;
      try {
        result = await executeTool(block.name, block.input);
      } catch (err) {
        result = { error: `Tool failed: ${err.message}` };
      }

      toolResults.push({
        type: 'tool_result',
        tool_use_id: block.id,
        content: JSON.stringify(result)
      });
    }

    messages.push({ role: 'user', content: toolResults });
  }

  // Trim history to last 30 messages to avoid context bloat
  conversationHistory.set(phoneNumber, messages.slice(-30));

  return finalResponse;
}

// ─── Tool execution ───────────────────────────────────────────────────────────

async function executeTool(name, input) {
  switch (name) {
    case 'create_calendar_event': {
      const event = await createEvent({
        title: input.title,
        startDatetime: input.start_datetime,
        endDatetime: input.end_datetime,
        description: input.description,
        location: input.location,
        attendees: input.attendees,
        reminderMinutes: input.reminder_minutes_before ?? 60
      });
      return { success: true, eventId: event.id, link: event.htmlLink, message: `Created: ${input.title}` };
    }

    case 'get_calendar_events': {
      const events = await getEvents(input.start_date, input.end_date, input.search_query);
      return { events: events.map(e => ({
        id: e.id,
        title: e.summary,
        start: e.start?.dateTime || e.start?.date,
        end: e.end?.dateTime || e.end?.date,
        location: e.location,
        description: e.description
      }))};
    }

    case 'update_calendar_event': {
      const updated = await updateEvent(input.event_id, {
        title: input.title,
        startDatetime: input.start_datetime,
        endDatetime: input.end_datetime,
        description: input.description,
        location: input.location
      });
      return { success: true, message: `Updated event` };
    }

    case 'delete_calendar_event': {
      await deleteEvent(input.event_id);
      return { success: true, message: `Deleted: ${input.event_title}` };
    }

    case 'update_family_knowledge': {
      const ctx = loadFamilyContext();
      const { type, data } = input;

      if (type === 'member') {
        if (!ctx.members) ctx.members = [];
        const idx = ctx.members.findIndex(m => m.name?.toLowerCase() === data.name?.toLowerCase());
        if (idx >= 0) {
          ctx.members[idx] = { ...ctx.members[idx], ...data };
        } else {
          ctx.members.push(data);
        }
      } else if (type === 'routine') {
        if (!ctx.routines) ctx.routines = [];
        ctx.routines.push({ ...data, added: new Date().toISOString() });
      } else if (type === 'preference') {
        if (!ctx.preferences) ctx.preferences = [];
        ctx.preferences.push({ ...data, added: new Date().toISOString() });
      } else if (type === 'note') {
        if (!ctx.notes) ctx.notes = [];
        ctx.notes.push({ text: data.text, added: new Date().toISOString() });
      }

      saveFamilyContext(ctx);
      return { success: true, message: 'Family knowledge updated' };
    }

    default:
      return { error: `Unknown tool: ${name}` };
  }
}

// ─── System prompt builder ────────────────────────────────────────────────────

function buildSystemPrompt(ctx, senderName) {
  const now = new Date();
  const dateStr = now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const timeStr = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'America/New_York' });

  const membersStr = ctx.members?.length
    ? ctx.members.map(m => `- ${m.name}${m.role ? ` (${m.role})` : ''}${m.schedule_notes ? ': ' + m.schedule_notes : ''}`).join('\n')
    : 'Not yet set up — learn as people introduce themselves.';

  const routinesStr = ctx.routines?.length
    ? ctx.routines.map(r => `- ${r.description}`).join('\n')
    : 'None recorded yet.';

  const prefsStr = ctx.preferences?.length
    ? ctx.preferences.map(p => `- ${p.person ? p.person + ': ' : ''}${p.description}`).join('\n')
    : 'None recorded yet.';

  return `You are a warm, smart family scheduling assistant running in a WhatsApp group chat${ctx.family_name ? ' for the ' + ctx.family_name + ' family' : ''}.

Today is ${dateStr}, ${timeStr} (Eastern Time).
The person messaging right now is: ${senderName}

YOUR JOB:
- Help coordinate the family calendar (add, view, update, delete events)
- Send reminders and keep everyone in sync
- Answer questions like "what's happening this week?" or "is Friday evening free?"
- Learn the family's routines and preferences over time — use update_family_knowledge whenever you pick up something useful
- Help find times that work for everyone

FAMILY MEMBERS:
${membersStr}

KNOWN ROUTINES:
${routinesStr}

PREFERENCES:
${prefsStr}

TONE AND FORMAT:
- This is WhatsApp, not email. Be warm and concise.
- Use *bold* for event names and times. Use emojis sparingly (a clock ⏰ for reminders, 📅 for events is fine).
- If you're adding something to the calendar, confirm it clearly: what, when, and who.
- If you're not sure about a time (like "next Tuesday"), clarify before adding.
- When you learn something new about a routine or preference, quietly use update_family_knowledge to store it.
- Never expose event IDs to users — use titles and times in conversation.
- If someone cancels or changes something, ask which event they mean if it's ambiguous.

Remember: you're a trusted household helper, not a formal assistant. Friendly is good.`;
}

module.exports = { processMessage };
