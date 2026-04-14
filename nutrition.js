const https = require('https');
const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.RAILWAY_VOLUME_MOUNT_PATH || (process.env.RAILWAY_ENVIRONMENT ? '/app/data' : __dirname);
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

function getPersonDay(log, person, date) {
  const key = date || todayKey();
  if (!log[person]) log[person] = {};
  if (!log[person][key]) log[person][key] = { entries: [], totals: { calories: 0, protein: 0, carbs: 0, fat: 0 } };
  return log[person][key];
}

// Use Nutritionix API for food lookup
function lookupNutrition(foodQuery) {
  return new Promise((resolve, reject) => {
    const appId = process.env.NUTRITIONIX_APP_ID || '';
    const appKey = process.env.NUTRITIONIX_API_KEY || '';
    
    // Fall back to basic estimates if no API key
    if (!appId || !appKey) {
      resolve(null);
      return;
    }

    const body = JSON.stringify({ query: foodQuery, timezone: 'America/New_York' });
    const options = {
      hostname: 'trackapi.nutritionix.com',
      path: '/v2/natural/nutrients',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-app-id': appId,
        'x-app-key': appKey,
        'Content-Length': Buffer.byteLength(body)
      }
    };
    const req = https.request(options, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve(JSON.parse(d)); }
        catch(e) { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.write(body);
    req.end();
  });
}

async function logFood(person, foodDescription, meal) {
  const log = loadLog();
  const day = getPersonDay(log, person);
  
  let nutritionData = null;
  let calories = 0, protein = 0, carbs = 0, fat = 0;
  let foods = [];

  const result = await lookupNutrition(foodDescription);
  if (result?.foods) {
    foods = result.foods.map(f => ({
      name: f.food_name,
      quantity: f.serving_qty + ' ' + f.serving_unit,
      calories: Math.round(f.nf_calories || 0),
      protein: Math.round(f.nf_protein || 0),
      carbs: Math.round(f.nf_total_carbohydrate || 0),
      fat: Math.round(f.nf_total_fat || 0)
    }));
    calories = foods.reduce((s, f) => s + f.calories, 0);
    protein = foods.reduce((s, f) => s + f.protein, 0);
    carbs = foods.reduce((s, f) => s + f.carbs, 0);
    fat = foods.reduce((s, f) => s + f.fat, 0);
  }

  day.entries.push({
    meal: meal || 'snack',
    description: foodDescription,
    foods,
    calories, protein, carbs, fat,
    time: new Date().toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit' })
  });

  day.totals.calories += calories;
  day.totals.protein += protein;
  day.totals.carbs += carbs;
  day.totals.fat += fat;

  saveLog(log);

  return {
    logged: foodDescription,
    meal,
    calories, protein, carbs, fat,
    dailyTotals: day.totals,
    foods
  };
}

function getDailySummary(person, date) {
  const log = loadLog();
  const key = date || todayKey();
  const day = log[person]?.[key];
  if (!day || day.entries.length === 0) return null;
  return {
    person,
    date: key,
    entries: day.entries,
    totals: day.totals,
    entryCount: day.entries.length
  };
}

function getWeeklySummary(person) {
  const log = loadLog();
  if (!log[person]) return null;
  const days = Object.entries(log[person]).slice(-7);
  return days.map(([date, data]) => ({
    date,
    calories: data.totals.calories,
    protein: data.totals.protein,
    entries: data.entries.length
  }));
}

module.exports = { logFood, getDailySummary, getWeeklySummary };
