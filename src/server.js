// HTTP server (no dependencies). Built by Tab, an AI assistant, for team lead Akshay Wagh.
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { Store } = require('./store');
const { Agent } = require('./agent');
const seed = require('./seed');

const PORT = Number(process.env.PORT || 8080);
const DATA = process.env.DATA_FILE || path.join(__dirname, '..', 'data', 'state.json');
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';     // if set, kill/resume need it
const DEMO_OPEN = process.env.DEMO_OPEN_KILL !== '0';  // demo: anyone may press the kill switch (auto-resumes)
const PUB = path.join(__dirname, '..', 'public');
const started = Date.now();

function createApp(opts = {}) {
  const store = new Store(opts.dataFile === undefined ? DATA : opts.dataFile);
  const agent = new Agent(store, opts);
  const hits = new Map();
  const limited = (ip) => { const now = Date.now(); const a = (hits.get(ip) || []).filter(x => now - x < 60000); a.push(now); hits.set(ip, a); return a.length > 40; };
  const send = (res, code, obj, type) => { const body = type ? obj : JSON.stringify(obj); res.writeHead(code, { 'content-type': type || 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }); res.end(body); };
  const body = (req) => new Promise((ok, no) => { let b = ''; req.on('data', c => { b += c; if (b.length > 8000) { no(new Error('body too large')); req.destroy(); } }); req.on('end', () => { try { ok(b ? JSON.parse(b) : {}); } catch (e) { no(new Error('bad json')); } }); });
  const authed = (req) => DEMO_OPEN || (ADMIN_TOKEN && req.headers['x-admin-token'] === ADMIN_TOKEN);
  let autoResume = null;

  const server = http.createServer(async (req, res) => {
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '?';
    const url = new URL(req.url, 'http://x'); const p = url.pathname;
    try {
      if (req.method === 'GET' && (p === '/' || p === '/index.html')) return send(res, 200, fs.readFileSync(path.join(PUB, 'index.html')), 'text/html; charset=utf-8');
      if (req.method === 'GET' && p === '/api/health') return send(res, 200, { ok: true, service: 'krishidesk-agent-rush', agent: store.state.killed ? 'killed' : 'running', uptimeSec: Math.round((Date.now() - started) / 1000), tickets: store.state.tickets.length, llm: agent.llm ? 'optional advisory on' : 'rules-only (no LLM)', node: process.version, builtBy: 'Tab, an AI assistant, for team lead Akshay Wagh' });
      if (req.method === 'GET' && p === '/api/status') return send(res, 200, { killed: store.state.killed, killedReason: store.state.killedReason, counters: store.state.counters, queues: countBy(store.state.tickets, 'queue'), statuses: countBy(store.state.tickets, 'status'), alerts: store.state.alerts.length });
      if (req.method === 'GET' && p === '/api/tickets') return send(res, 200, { tickets: store.state.tickets.slice(0, 100) });
      if (req.method === 'GET' && p.startsWith('/api/tickets/')) { const t = store.state.tickets.find(x => x.id === p.split('/')[3]); return t ? send(res, 200, t) : send(res, 404, { error: 'not found' }); }
      if (req.method === 'GET' && p === '/api/audit') return send(res, 200, { rows: store.state.audit.slice(-Number(url.searchParams.get('n') || 100)).reverse(), verify: store.verifyAudit() });
      if (req.method === 'GET' && p === '/api/audit/verify') return send(res, 200, store.verifyAudit());
      if (req.method === 'GET' && p === '/api/outbox') return send(res, 200, { messages: store.state.outbox.slice(-100).reverse(), note: 'channel adapters are simulated unless NOTIFY_WEBHOOK is set' });
      if (req.method === 'GET' && p === '/api/alerts') return send(res, 200, { alerts: store.state.alerts });
      if (req.method === 'POST') {
        if (limited(ip)) return send(res, 429, { error: 'slow down' });
        const b = await body(req);
        if (p === '/api/tickets') { const t = agent.submit(b); return send(res, 201, { id: t.id, status: t.status }); }
        if (p === '/api/seed') { seed.forEach(s => agent.submit(Object.assign({ source: 'seed' }, s))); return send(res, 201, { added: seed.length }); }
        if (p === '/api/tick') { return send(res, 200, await agent.tick()); }
        if (p === '/api/kill') { if (!authed(req)) return send(res, 401, { error: 'admin token required' }); agent.kill('operator', b.reason || 'pressed in UI'); if (DEMO_OPEN) { clearTimeout(autoResume); autoResume = setTimeout(() => agent.resume('demo-auto'), 90000); autoResume.unref && autoResume.unref(); } return send(res, 200, { killed: true, autoResumeSec: DEMO_OPEN ? 90 : null }); }
        if (p === '/api/resume') { if (!authed(req)) return send(res, 401, { error: 'admin token required' }); clearTimeout(autoResume); agent.resume('operator'); return send(res, 200, { killed: false }); }
        if (p.startsWith('/api/tickets/') && p.endsWith('/officer-reply')) { const t = agent.officerReply(p.split('/')[3], b.officer, b.message); return send(res, 200, { id: t.id, status: t.status }); }
      }
      send(res, 404, { error: 'not found' });
    } catch (e) { send(res, 400, { error: e.message }); }
  });
  return { server, store, agent };
}
function countBy(arr, k) { const o = {}; arr.forEach(x => { const v = x[k] || '(none)'; o[v] = (o[v] || 0) + 1; }); return o; }

if (require.main === module) {
  const { server, agent, store } = createApp();
  agent.start(3000);
  server.listen(PORT, () => console.log('krishidesk-agent-rush on :' + PORT));
  if (!store.state.tickets.length && process.env.SEED_ON_EMPTY !== '0') { seed.forEach(s => agent.submit(Object.assign({ source: 'seed' }, s))); }
}
module.exports = { createApp };
