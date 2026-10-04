// Minimal in-memory stand-in for the Supabase REST API (PostgREST) -
// just enough for supabase-js's select/eq/single/maybeSingle/upsert/insert/delete
// against the tables this app uses. Nothing here touches a real database.
//
//   GET  /__ctl?down=1|0     simulate the database being unreachable
//   GET  /__ctl?reset=1      wipe all tables
//   GET  /__dump             dump all tables
const http = require('http');

const PK = {
  kv_store: ['key'],
  email_settings: ['id'],
  payment_settings: ['id'],
  razorpay_settings: ['id'],
  login_email_log: ['phone', 'ts'],
  user_directory: ['phone'],
};
let tables = {};
let down = false;
const reset = () => { tables = {}; for (const t of Object.keys(PK)) tables[t] = []; };
reset();

function parseFilters(q) {
  const f = [];
  for (const [k, v] of q.entries()) {
    if (['select', 'on_conflict', 'columns', 'order', 'limit', 'offset'].includes(k)) continue;
    const m = /^eq\.(.*)$/.exec(v);
    if (m) f.push([k, m[1]]);
    const l = /^like\.(.*)$/.exec(v);
    if (l) f.push([k, new RegExp('^' + l[1].replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/[%*]/g, '.*') + '$')]);
  }
  return f;
}
const match = (row, f) => f.every(([k, v]) => (v instanceof RegExp ? v.test(String(row[k])) : String(row[k]) === v));
function project(row, select) {
  if (!select || select === '*') return row;
  const out = {};
  for (const c of select.split(',').map((s) => s.trim())) out[c] = row[c] === undefined ? null : row[c];
  return out;
}

const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/__ctl') {
    if (u.searchParams.has('down')) down = u.searchParams.get('down') === '1';
    if (u.searchParams.has('reset')) reset();
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ down }));
  }
  if (u.pathname === '/__dump') {
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify(tables));
  }
  if (down) return req.socket.destroy(); // -> "TypeError: fetch failed" in the caller

  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    const m = /^\/rest\/v1\/([a-z_]+)$/.exec(u.pathname);
    const send = (code, obj) => {
      res.writeHead(code, { 'content-type': 'application/json' });
      res.end(obj === undefined ? '' : JSON.stringify(obj));
    };
    if (!m || !tables[m[1]]) return send(404, { code: 'PGRST205', message: 'table not found: ' + u.pathname });
    const t = m[1];
    const rows = tables[t];
    const filters = parseFilters(u.searchParams);
    const wantObject = String(req.headers.accept || '').includes('vnd.pgrst.object');
    const prefer = String(req.headers.prefer || '');

    if (req.method === 'GET' || req.method === 'HEAD') {
      const found = rows.filter((r) => match(r, filters)).map((r) => project(r, u.searchParams.get('select')));
      if (wantObject) {
        if (found.length !== 1) {
          return send(406, {
            code: 'PGRST116',
            details: `The result contains ${found.length} rows`,
            hint: null,
            message: 'JSON object requested, multiple (or no) rows returned',
          });
        }
        return send(200, found[0]);
      }
      return send(200, found);
    }

    if (req.method === 'POST') {
      let incoming;
      try { incoming = JSON.parse(body || '[]'); } catch (e) { return send(400, { message: 'bad json' }); }
      if (!Array.isArray(incoming)) incoming = [incoming];
      const merge = prefer.includes('resolution=merge-duplicates');
      const pk = (u.searchParams.get('on_conflict') || PK[t].join(',')).split(',');
      for (const row of incoming) {
        const idx = rows.findIndex((r) => pk.every((k) => String(r[k]) === String(row[k])));
        if (idx >= 0) {
          if (!merge) return send(409, { code: '23505', message: 'duplicate key value violates unique constraint', details: null, hint: null });
          rows[idx] = Object.assign({}, rows[idx], row);
        } else {
          rows.push(Object.assign({}, row));
        }
      }
      return prefer.includes('return=representation') ? send(201, incoming) : send(201);
    }

    if (req.method === 'PATCH') {
      let patch;
      try { patch = JSON.parse(body || '{}'); } catch (e) { return send(400, { message: 'bad json' }); }
      rows.forEach((r, i) => { if (match(r, filters)) rows[i] = Object.assign({}, r, patch); });
      return send(204);
    }

    if (req.method === 'DELETE') {
      tables[t] = rows.filter((r) => !match(r, filters));
      return send(204);
    }
    return send(405, { message: 'method not allowed' });
  });
});

server.listen(Number(process.env.FAKE_PORT) || 54321, '127.0.0.1', () => console.log('fake supabase on', server.address().port));
