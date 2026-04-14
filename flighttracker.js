const https = require('https');

// Uses AviationStack free API - 500 free requests/month
const API_KEY = process.env.AVIATIONSTACK_API_KEY || '';

function fetchFlight(flightNumber, date) {
  return new Promise((resolve, reject) => {
    const dateStr = date || new Date().toISOString().split('T')[0];
    const url = `http://api.aviationstack.com/v1/flights?access_key=${API_KEY}&flight_iata=${flightNumber}&flight_date=${dateStr}`;
    https.get(url.replace('http://', 'https://'), res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve(JSON.parse(d)); }
        catch(e) { reject(e); }
      });
    }).on('error', reject);
  });
}

async function getFlightStatus(flightNumber, date) {
  try {
    const data = await fetchFlight(flightNumber, date);
    const flight = data.data?.[0];
    if (!flight) return null;
    return {
      flight: flight.flight?.iata,
      airline: flight.airline?.name,
      status: flight.flight_status,
      departure: {
        airport: flight.departure?.airport,
        iata: flight.departure?.iata,
        scheduled: flight.departure?.scheduled,
        estimated: flight.departure?.estimated,
        actual: flight.departure?.actual,
        delay: flight.departure?.delay
      },
      arrival: {
        airport: flight.arrival?.airport,
        iata: flight.arrival?.iata,
        scheduled: flight.arrival?.scheduled,
        estimated: flight.arrival?.estimated,
        actual: flight.arrival?.actual,
        delay: flight.arrival?.delay
      }
    };
  } catch(e) {
    return { error: e.message };
  }
}

module.exports = { getFlightStatus };
