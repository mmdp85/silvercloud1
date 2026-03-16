javascriptconst https = require('https');

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
    hostname: 'api.invertironline.com',
    path,
    method: 'GET',
    headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' }
  });
}

async function getToken(user, pass) {
  const now = Date.now();
  if (tokenCache.access && now < tokenCache.expiry) return tokenCache.access;
  const body = `username=${encodeURIComponent(user)}&password=${encodeURIComponent(pass)}&grant_type=password`;
  const res = await iolRequest({
    hostname: 'api.invertironline.com',
    path: '/token',
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) }
  }, body);
  if (res.status !== 200) throw new Error('IOL auth failed: ' + res.status + ' ' + res.body);
  const d = JSON.parse(res.body);
  tokenCache = { access: d.access_token, refresh: d.refresh_token, expiry: now + 13 * 60 * 1000 };
  return tokenCache.access;
}

function safeJson(str) {
  try { return JSON.parse(str); } catch(e) { return { raw: str, parseError: e.message }; }
}

function parseBody(req) {
  return new Promise(resolve => {
    let data = '';
    req.on('data', chunk => data += chunk);
    req.on('end', () => {
      try { resolve(JSON.parse(data)); } catch(e) { resolve({}); }
    });
  });
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const params = req.query;
  const action = params.action;

  try {
    if (action === 'cotizacion') {
      const simbolo = params.simbolo;
      const mercado = params.mercado || 'bCBA';
      const token = await getToken(process.env.IOL_USER, process.env.IOL_PASS);
      const r = await iolGet('/api/v2/' + mercado + '/Titulos/' + simbolo + '/cotizacion', token);
      res.status(r.status).json(safeJson(r.body));
      return;
    }

    if (action === 'multi') {
      const body = await parseBody(req);
      const simbolos = body.simbolos || [];
      const mercado = body.mercado || 'bCBA';
      const token = await getToken(process.env.IOL_USER, process.env.IOL_PASS);
      const results = {};
      await Promise.all(simbolos.map(async function(s) {
        try {
          const r = await iolGet('/api/v2/' + mercado + '/Titulos/' + s + '/cotizacion', token);
          results[s] = r.status === 200 ? JSON.parse(r.body) : { error: r.status };
        } catch(e) { results[s] = { error: e.message }; }
      }));
      res.status(200).json(results);
      return;
    }

    if (action === 'panel') {
      const mercado = params.mercado || 'bCBA';
      const panel = params.panel === 'lideres' ? 'lider' : (params.panel || 'acciones');
      const token = await getToken(process.env.IOL_USER, process.env.IOL_PASS);
      const r = await iolGet('/api/v2/' + mercado + '/Titulos/' + panel + '/cotizacion/paneles', token);
      res.status(r.status).json(safeJson(r.body));
      return;
    }

    if (action === 'portafolio') {
      const token = await getToken(process.env.IOL_USER, process.env.IOL_PASS);
      const r = await iolGet('/api/v2/micuenta/portafolio/arg', token);
      res.status(r.status).json(safeJson(r.body));
      return;
    }

    if (action === 'historico') {
      const simbolo = params.simbolo;
      const mercado = params.mercado || 'bCBA';
      const fechaDesde = params.fechaDesde;
      const fechaHasta = params.fechaHasta;
      const token = await getToken(process.env.IOL_USER, process.env.IOL_PASS);
      const r = await iolGet('/api/v2/Cotizaciones/' + simbolo + '/' + mercado + '/historico?fechaDesde=' + fechaDesde + '&fechaHasta=' + fechaHasta + '&ajustada=sinAjustar', token);
      res.status(r.status).json(safeJson(r.body));
      return;
    }

    res.status(400).json({ error: 'Unknown action' });

  } catch(e) {
    res.status(500).json({ error: e.message });
  }
};
