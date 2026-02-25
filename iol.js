const https = require('https');

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json'
};

let tokenCache = { access: null, refresh: null, expiry: 0 };

function iolRequest(options, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function iolGet(path, token) {
  return iolRequest({
    hostname: 'api.invertironline.com', path,
    method: 'GET',
    headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' }
  });
}

async function getToken(user, pass) {
  const now = Date.now();
  if (tokenCache.access && now < tokenCache.expiry) return tokenCache.access;

  if (tokenCache.refresh && now < tokenCache.expiry + 2 * 60 * 1000) {
    const body = `grant_type=refresh_token&refresh_token=${encodeURIComponent(tokenCache.refresh)}`;
    const res = await iolRequest({
      hostname: 'api.invertironline.com', path: '/token', method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) }
    }, body);
    if (res.status === 200) {
      const d = JSON.parse(res.body);
      tokenCache = { access: d.access_token, refresh: d.refresh_token, expiry: now + 13 * 60 * 1000 };
      return tokenCache.access;
    }
  }

  const body = `username=${encodeURIComponent(user)}&password=${encodeURIComponent(pass)}&grant_type=password`;
  const res = await iolRequest({
    hostname: 'api.invertironline.com', path: '/token', method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) }
  }, body);
  if (res.status !== 200) throw new Error('IOL auth failed: ' + res.status);
  const d = JSON.parse(res.body);
  tokenCache = { access: d.access_token, refresh: d.refresh_token, expiry: now + 13 * 60 * 1000 };
  return tokenCache.access;
}

module.exports = async (req, res) => {
  // CORS preflight
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const params = req.query;
  const action = params.action;

  try {
    if (action === 'cotizacion') {
      const { simbolo, mercado = 'bCBA' } = params;
      const token = await getToken(process.env.IOL_USER, process.env.IOL_PASS);
      const r = await iolGet(`/api/v2/${mercado}/Titulos/${simbolo}/cotizacion`, token);
      res.status(r.status).json(JSON.parse(r.body));
      return;
    }

    if (action === 'multi') {
      const body = req.body || {};
      const { simbolos = [], mercado = 'bCBA' } = body;
      const token = await getToken(process.env.IOL_USER, process.env.IOL_PASS);
      const results = {};
      await Promise.all(simbolos.map(async s => {
        try {
          const r = await iolGet(`/api/v2/${mercado}/Titulos/${s}/cotizacion`, token);
          results[s] = r.status === 200 ? JSON.parse(r.body) : { error: r.status };
        } catch(e) { results[s] = { error: e.message }; }
      }));
      res.status(200).json(results);
      return;
    }

    if (action === 'panel') {
      const mercado = params.mercado || 'bCBA';
      const panelParam = params.panel || 'acciones';
      const panel = panelParam === 'lideres' ? 'lider' : panelParam;
      const token = await getToken(process.env.IOL_USER, process.env.IOL_PASS);
      const r = await iolGet(`/api/v2/${mercado}/Titulos/${panel}/cotizacion/paneles`, token);
      res.status(r.status).json(JSON.parse(r.body));
      return;
    }

    if (action === 'portafolio') {
      const token = await getToken(process.env.IOL_USER, process.env.IOL_PASS);
      const r = await iolGet('/api/v2/micuenta/portafolio/arg', token);
      res.status(r.status).json(JSON.parse(r.body));
      return;
    }

    res.status(400).json({ error: 'Unknown action' });

  } catch(e) {
    res.status(500).json({ error: e.message });
  }
};
