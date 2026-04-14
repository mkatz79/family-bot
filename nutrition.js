const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.RAILWAY_VOLUME_MOUNT_PATH || 
  (process.env.RAILWAY_ENVIRONMENT ? '/app/data' : __dirname);

try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch(e) {}

const NUTRITION_FILE = path.join(DATA_DIR, 'nutrition_log.json');

function loadLog() {
  try { return JSON.parse(fs.readFileSync(NUTRITION_FILE, 'utf8')); }
  catch { return {}; }
}

function saveLog(data) {
  fs.writeFileSync(NUTRITION_FILE, JSON.stringify(data, null, 2));
}

function todayKey() {
  return new Date().toLocaleDateString('en-US', { timeZone: 'America/New_York' }).replace(/\//g, '-');
}

function logFood(person, foodDescription, meal, nutrition) {
  const log = loadLog();
  const key = todayKey();
  if (!log[person]) log[person] = {};
  if (!log[person][key]) log[person][key] = { entries: [], totals: { calories: 0, protein: 0, carbs: 0, fat: 0 } };
  const day = log[person][key];
  const entry = {
    meal: meal || 'snack',
    description: foodDescription,
    calories: nutrition.calories || 0,
    protein: nutrition.protein || 0,
    carbs: nutrition.carbs || 0,
    fat: nutrition.fat || 0,
    time: new Date().toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit' })
  };
  day.entries.push(entry);
  day.totals.calories += entry.calories;
  day.totals.protein += entry.protein;
  day.totals.carbs += entry.carbs;
  day.totals.fat += entry.fat;
  saveLog(log);
  return { logged: true, entry, dailyTotals: day.totals };
}

function getDailySummary(person, date) {
  const log = loadLog();
  const key = date || todayKey();
  const day = log[person]?.[key];
  if (!day || day.entries.length === 0) return null;
  return { person, date: key, entries: day.entries, totals: day.totals };
}

function getWeeklySummary(person) {
  const log = loadLog();
  if (!log[person]) return null;
  return Object.entries(log[person]).slice(-7).map(([date, data]) => ({
    date, calories: data.totals.calories, protein: data.totals.protein, entries: data.entries.length
  }));
}

module.exports = { logFood, getDailySummary, getWeeklySummary };
