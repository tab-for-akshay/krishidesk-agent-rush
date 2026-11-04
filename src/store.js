// Tiny JSON-file store with atomic writes and a hash-chained audit log.
// Built by Tab, an AI assistant, for team lead Akshay Wagh.
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class Store {
  constructor(file) {
    this.file = file;
    this.state = { seq: 0, tickets: [], outbox: [], audit: [], alerts: [], killed: false, killedReason: null, counters: { ticketsIn: 0, autoResolved: 0, escalated: 0, toolCalls: 0, blockedCalls: 0 } };
    if (file && fs.existsSync(file)) {
      try { this.state = Object.assign(this.state, JSON.parse(fs.readFileSync(file, 'utf8'))); } catch (e) { /* start fresh */ }
    }
  }
  save() {
    if (!this.file) return;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.state));
    fs.renameSync(tmp, this.file);
  }
  nextId(prefix) { this.state.seq += 1; return prefix + '-' + String(this.state.seq).padStart(4, '0'); }
  // Every tool call and decision goes here. Each row hashes the previous row, so edits are detectable.
  audit(actor, action, detail) {
    const a = this.state.audit;
    const prev = a.length ? a[a.length - 1].hash : 'genesis';
    const row = { n: a.length + 1, ts: new Date().toISOString(), actor, action, detail };
    row.hash = crypto.createHash('sha256').update(prev + JSON.stringify([row.n, row.ts, actor, action, detail])).digest('hex').slice(0, 24);
    row.prev = prev === 'genesis' ? prev : prev.slice(0, 8);
    a.push(row);
    if (a.length > 5000) a.splice(0, a.length - 5000);
    return row;
  }
  verifyAudit() {
    const a = this.state.audit;
    let prev = null;
    for (let i = 0; i < a.length; i++) {
      const r = a[i];
      if (i === 0) { prev = r.hash; continue; } // first retained row is the anchor after truncation
      const expect = crypto.createHash('sha256').update(prev + JSON.stringify([r.n, r.ts, r.actor, r.action, r.detail])).digest('hex').slice(0, 24);
      if (expect !== r.hash) return { ok: false, brokenAt: r.n, rows: a.length };
      prev = r.hash;
    }
    return { ok: true, rows: a.length, head: a.length ? a[a.length - 1].hash : null };
  }
}
module.exports = { Store };
