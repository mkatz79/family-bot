const fs = require('fs');
const path = require('path');

const MEMORY_FILE = path.join(__dirname, 'memory.json');

function load() {
  try { return JSON.parse(fs.readFileSync(MEMORY_FILE, 'utf8')); }
  catch { return { histories: {}, facts: {} }; }
}

function save(data) {
  try { fs.writeFileSync(MEMORY_FILE, JSON.stringify(data)); }
  catch(e) { console.error('Memory save error:', e.message); }
}

function getHistory(chatId) {
  const data = load();
  return data.histories[chatId] || [];
}

function saveHistory(chatId, history) {
  const data = load();
  data.histories[chatId] = history.slice(-100);
  save(data);
}

function saveFact(key, value) {
  const data = load();
  data.facts[key] = { value, saved: new Date().toISOString() };
  save(data);
}

function getAllFacts() {
  return load().facts;
}

function getFullMemory() {
  return load();
}

module.exports = { getHistory, saveHistory, saveFact, getAllFacts, getFullMemory };
