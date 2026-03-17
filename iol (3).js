const https = require('https');

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
  const body = 'username=' + encodeURIComponent(user) + '&password=' + encodeURIComponent(pass) + '&grant_type=password';
  const res = await iolRequest({
    hostname: 'api.invertironline.com',
    path: '/token',
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) }
  }, body);
  if (res.status !== 200) throw new Error('IOL auth failed: ' + res.status);
  const d = JSON.parse(res.body);
  tokenCache = { access: d.access_token, refresh: d.refresh_token, expiry: now + 13 * 60 * 1000 };
  return tokenCache.access;
}

function safeJson(str) {
  try { return JSON.parse(str); } catch(e) { return { raw: str.slice(0, 200), parseError: e.message }; }
}

function parseBody(req) {
  return new Promise(function(resolve) {
    var data = '';
    req.on('data', function(chunk) { data += chunk; });
    req.on('end', function() {
      try { resolve(JSON.parse(data)); } catch(e) { resolve({}); }
    });
  });
}

async function fetchExternal(hostname, path) {
  return iolRequest({
    hostname,
    path,
    method: 'GET',
    headers: {
      'User-Agent': 'Mozilla/5.0',
      'Accept': 'application/json',
      'Referer': 'https://www.ambito.com/'
    }
  });
}

module.exports = async function(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  var params = req.query;
  var action = params.action;

  try {
    if (action === 'cotizacion') {
      var simbolo = params.simbolo;
      var mercado = params.mercado || 'bCBA';
      var token = await getToken(process.env.IOL_USER, process.env.IOL_PASS);
      var r = await iolGet('/api/v2/' + mercado + '/Titulos/' + simbolo + '/cotizacion', token);
      res.status(r.status).json(safeJson(r.body));
      return;
    }

    if (action === 'panel') {
      var mercado2 = params.mercado || 'bCBA';
      var panelNombre = params.panel || 'Lider';
      var token2 = await getToken(process.env.IOL_USER, process.env.IOL_PASS);
      var r2 = await iolGet('/api/v2/' + mercado2 + '/Titulos/cotizacion/paneles/' + panelNombre, token2);
      res.status(r2.status).json(safeJson(r2.body));
      return;
    }

    if (action === 'multi') {
      var body = await parseBody(req);
      var simbolos = body.simbolos || [];
      var mercado3 = body.mercado || 'bCBA';
      var token3 = await getToken(process.env.IOL_USER, process.env.IOL_PASS);
      var results = {};
      await Promise.all(simbolos.map(async function(s) {
        try {
          var r3 = await iolGet('/api/v2/' + mercado3 + '/Titulos/' + s + '/cotizacion', token3);
          results[s] = r3.status === 200 ? JSON.parse(r3.body) : { error: r3.status };
        } catch(e) { results[s] = { error: e.message }; }
      }));
      res.status(200).json(results);
      return;
    }

    if (action === 'portafolio') {
      var token4 = await getToken(process.env.IOL_USER, process.env.IOL_PASS);
      var r4 = await iolGet('/api/v2/micuenta/portafolio/arg', token4);
      res.status(r4.status).json(safeJson(r4.body));
      return;
    }

    if (action === 'historico') {
      var simbolo2 = params.simbolo;
      var mercado4 = params.mercado || 'bCBA';
      var fechaDesde = params.fechaDesde;
      var fechaHasta = params.fechaHasta;
      var ajustada = params.ajustada || 'sinAjustar';
      var token5 = await getToken(process.env.IOL_USER, process.env.IOL_PASS);
      var path = '/api/v2/' + mercado4 + '/Titulos/' + simbolo2 + '/cotizacion/historica?fechaDesde=' + fechaDesde + '&fechaHasta=' + fechaHasta + '&ajustada=' + ajustada;
      var r5 = await iolGet(path, token5);
      res.status(r5.status).json(safeJson(r5.body));
      return;
    }

    // ROFEX futuros via Ambito (no CORS desde frontend)
    if (action === 'rofex') {
      var r6 = await fetchExternal('mercados.ambito.com', '/dolarfuturo/datos');
      if (r6.status === 200 && r6.body && r6.body.trim()[0] !== '<') {
        res.status(200).json(safeJson(r6.body));
      } else {
        // Try alternative Ambito endpoint
        var r7 = await fetchExternal('mercados.ambito.com', '/dolarfuturos/datos');
        if (r7.status === 200 && r7.body && r7.body.trim()[0] !== '<') {
          res.status(200).json(safeJson(r7.body));
        } else {
          res.status(200).json({ error: 'No data', preview: r6.body.slice(0,200) });
        }
      }
      return;
    }

    res.status(400).json({ error: 'Unknown action' });

  } catch(e) {
    res.status(500).json({ error: e.message });
  }
};
