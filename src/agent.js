// The ticket agent: a bounded tool loop. Built by Tab, an AI assistant, for team lead Akshay Wagh.
// Brain = KrishiDesk core (rules + vetted knowledge base). An optional LLM may only ADD caution, never remove an escalation.
'use strict';
const core = require('./core');
const kb = require('./kb.json');

const QUEUES = { emergency: 'Emergency (15-min SLA)', expert: 'Expert review (4-hour SLA)', input: 'Input-quality complaints', approve: 'Auto-draft, officer approves', outbreak: 'District outbreak desk' };
const SLA_MIN = { emergency: 15, expert: 240, input: 480, approve: 240, outbreak: 120 };
const LIMITS = { ticketsPerTick: 5, stepsPerTicket: 8, textMax: 2000 };

class Agent {
  constructor(store, opts = {}) {
    this.store = store;
    this.llm = opts.llm || null; // optional async (text, draft) => { note } ; advisory only
    this.timer = null;
    this.notifyWebhook = opts.notifyWebhook || process.env.NOTIFY_WEBHOOK || null;
  }
  get S() { return this.store.state; }

  // ---------- containment: the ONLY things the agent may do ----------
  tools() {
    const self = this;
    return {
      triage_ticket: (t) => core.triage(t.text),
      lookup_advisory: (t, tri) => (tri.safety || tri.safetyLevel === 'input-quality') ? [] : core.lookup(kb, t.text, tri.crop),
      draft_reply: (t) => core.draftReply(t.text, kb),
      route_ticket: (t, queue, why) => { t.queue = QUEUES[queue]; t.queueKey = queue; t.dueAt = new Date(Date.now() + SLA_MIN[queue] * 60000).toISOString(); return { queue: t.queue, dueAt: t.dueAt, why }; },
      escalate_to_human: (t, reason) => { t.status = 'escalated'; t.escalation = { reason, at: new Date().toISOString(), officer: null }; self.S.counters.escalated++; return { escalated: true, reason }; },
      notify: (t, channel, message) => {
        const row = { id: self.store.nextId('MSG'), ticket: t.id, channel, to: t.farmer.contact || 'caller', message, ts: new Date().toISOString(), simulated: !self.notifyWebhook };
        self.S.outbox.push(row); if (self.S.outbox.length > 500) self.S.outbox.shift();
        if (self.notifyWebhook) { try { fetch(self.notifyWebhook, { method: 'POST', body: JSON.stringify({ ticket: t.id, channel, message }), headers: { 'content-type': 'application/json' } }).catch(() => {}); } catch (e) { /* ignore */ } }
        return { sent: row.id, channel, simulated: row.simulated };
      },
      resolve_ticket: (t, by) => { t.status = 'resolved'; t.resolvedBy = by; t.resolvedAt = new Date().toISOString(); self.S.counters.autoResolved += by === 'agent' ? 1 : 0; return { resolved: true, by }; },
      link_duplicates: (t) => {
        const since = Date.now() - 24 * 3600 * 1000;
        const sibs = self.S.tickets.filter(x => x.id !== t.id && x.crop && x.crop === t.crop && x.farmer.district && x.farmer.district === t.farmer.district && (x.category === 'pest' || x.category === 'disease') && Date.parse(x.createdAt) > since);
        return { siblings: sibs.map(s => s.id) };
      },
    };
  }
  // Wrapper: kill-switch check + step budget + audit on every single tool call.
  call(ctx, name, ...args) {
    const tools = this.tools();
    if (this.S.killed) { this.S.counters.blockedCalls++; this.store.audit('agent', 'BLOCKED', { tool: name, ticket: ctx.ticket.id, reason: 'kill switch on' }); throw new Error('KILLED'); }
    if (!tools[name]) { this.S.counters.blockedCalls++; this.store.audit('agent', 'BLOCKED', { tool: name, ticket: ctx.ticket.id, reason: 'tool not on allow-list' }); throw new Error('TOOL_NOT_ALLOWED'); }
    if (++ctx.steps > LIMITS.stepsPerTicket) { this.store.audit('agent', 'BLOCKED', { tool: name, ticket: ctx.ticket.id, reason: 'step budget exceeded' }); throw new Error('STEP_BUDGET'); }
    this.S.counters.toolCalls++;
    const out = tools[name](ctx.ticket, ...args);
    this.store.audit('agent', name, { ticket: ctx.ticket.id, args: args.map(a => typeof a === 'object' ? '[obj]' : String(a).slice(0, 80)), result: summarize(out) });
    return out;
  }

  // ---------- intake ----------
  submit({ text, source = 'web', farmer = {} }) {
    text = String(text || '').trim().slice(0, LIMITS.textMax);
    if (!text) throw new Error('empty ticket');
    const t = { id: this.store.nextId('KD'), source, text, farmer: { name: String(farmer.name || '').slice(0, 60), district: String(farmer.district || '').slice(0, 60), contact: String(farmer.contact || '').slice(0, 40) }, status: 'new', createdAt: new Date().toISOString(), history: [] };
    this.S.tickets.unshift(t); this.S.counters.ticketsIn++;
    if (this.S.tickets.length > 400) this.S.tickets.pop();
    this.store.audit('intake', 'ticket_created', { ticket: t.id, source, chars: text.length });
    this.store.save();
    return t;
  }

  // ---------- one ticket, start to finish ----------
  async work(t) {
    const ctx = { ticket: t, steps: 0 };
    try {
      const tri = this.call(ctx, 'triage_ticket');
      Object.assign(t, { category: tri.category, crop: tri.crop, urgency: tri.urgency, labels: tri.labels, safetyLevel: tri.safetyLevel, requestType: tri.requestType });
      t.safetyReasons = tri.safetyReasons;
      const draft = this.call(ctx, 'draft_reply');
      t.matches = draft.matches.map(m => ({ id: m.id, title: m.title, source: m.source }));
      t.reply = draft.reply;
      // Safety floor first: rules decide, nothing downstream can undo it.
      if (tri.safety) {
        this.call(ctx, 'route_ticket', 'emergency', 'safety floor: ' + (tri.safetyKind || 'poisoning'));
        this.call(ctx, 'escalate_to_human', 'SAFETY: ' + tri.safetyReasons.join('; '));
        this.call(ctx, 'notify', 'sms', t.reply); // emergency instruction only (call 108 / hospital), never crop advice
        t.status = 'escalated'; t.agentNote = 'Safety floor: emergency instructions sent, human officer must call back. No crop advice was generated.';
      } else if (tri.safetyLevel === 'input-quality') {
        this.call(ctx, 'route_ticket', 'input', 'fake/substandard input complaint');
        this.call(ctx, 'escalate_to_human', 'input-quality complaint: ' + tri.safetyReasons.join('; '));
        this.call(ctx, 'notify', 'sms', t.reply);
      } else if (draft.needsHuman) {
        this.call(ctx, 'route_ticket', 'expert', draft.queue);
        this.call(ctx, 'escalate_to_human', tri.safetyLevel === 'chemical' ? 'chemical name/dose/mix: human expert must answer' : draft.matches.length ? 'advisory needs expert sign-off or crop unclear' : 'no vetted advisory matches');
        this.call(ctx, 'notify', 'sms', 'We received your query (' + t.id + '). An expert will reply. Meanwhile use only label-approved products, wear gloves and a mask.');
      } else {
        // Vetted, non-chemical, crop-specific: the agent resolves it on its own and tells the farmer.
        this.call(ctx, 'route_ticket', 'approve', 'vetted advisory, no human needed');
        this.call(ctx, 'notify', 'sms', t.reply);
        this.call(ctx, 'resolve_ticket', 'agent');
      }
      // Cross-ticket check: three or more pest/disease reports on one crop in one district in 24 h = possible outbreak.
      if (t.category === 'pest' || t.category === 'disease') {
        const d = this.call(ctx, 'link_duplicates');
        if (d.siblings.length >= 2) this.raiseOutbreak(t, d.siblings);
      }
      if (this.llm) { try { const adv = await this.llm(t.text, draft); if (adv && adv.note) { t.llmNote = String(adv.note).slice(0, 400); this.store.audit('llm', 'advisory_note', { ticket: t.id }); } } catch (e) { /* advisory only */ } }
    } catch (e) {
      if (e.message === 'KILLED') { t.status = 'new'; return 'killed'; }
      // Fail safe: anything unexpected goes to a human, never to a farmer.
      t.status = 'escalated'; t.queue = QUEUES.expert; t.escalation = { reason: 'agent error: ' + e.message, at: new Date().toISOString() };
      this.store.audit('agent', 'fail_safe_escalation', { ticket: t.id, error: e.message });
    }
    return t.status;
  }
  raiseOutbreak(t, sibs) {
    const key = 'outbreak:' + t.crop + ':' + t.farmer.district;
    if (this.S.alerts.find(a => a.key === key && Date.now() - Date.parse(a.ts) < 24 * 3600 * 1000)) return;
    const alert = { id: this.store.nextId('ALERT'), key, ts: new Date().toISOString(), crop: t.crop, district: t.farmer.district, tickets: [t.id, ...sibs], note: 'Three or more pest/disease reports on ' + t.crop + ' in ' + t.farmer.district + ' within 24 h. District outbreak desk should check the fields.' };
    this.S.alerts.unshift(alert);
    this.store.audit('agent', 'outbreak_alert', { alert: alert.id, crop: t.crop, district: t.farmer.district, tickets: alert.tickets.length });
    const row = { id: this.store.nextId('MSG'), ticket: t.id, channel: 'officer-pager', to: 'district officer', message: alert.note, ts: alert.ts, simulated: !this.notifyWebhook };
    this.S.outbox.push(row);
  }

  // ---------- the unattended loop ----------
  async tick() {
    if (this.S.killed) return { processed: 0, killed: true };
    const todo = this.S.tickets.filter(t => t.status === 'new').slice(-LIMITS.ticketsPerTick);
    for (const t of todo) { const r = await this.work(t); if (r === 'killed') break; }
    if (todo.length) this.store.save();
    return { processed: todo.length, killed: this.S.killed };
  }
  start(ms = 3000) { if (this.timer) return; this.timer = setInterval(() => this.tick().catch(e => this.store.audit('agent', 'tick_error', { error: String(e.message) })), ms); this.timer.unref && this.timer.unref(); this.store.audit('system', 'agent_started', { everyMs: ms }); }
  stop() { clearInterval(this.timer); this.timer = null; }
  kill(who, reason) { this.S.killed = true; this.S.killedReason = reason || 'manual'; this.S.killedAt = new Date().toISOString(); this.store.audit(who, 'KILL_SWITCH_ON', { reason }); this.store.save(); }
  resume(who) { this.S.killed = false; this.S.killedReason = null; this.store.audit(who, 'KILL_SWITCH_OFF', {}); this.store.save(); }
  officerReply(id, officer, message) {
    const t = this.S.tickets.find(x => x.id === id); if (!t) throw new Error('no such ticket');
    if (t.status !== 'escalated') throw new Error('ticket is not waiting for a human');
    message = String(message || '').trim().slice(0, 1000); if (!message) throw new Error('empty reply');
    t.escalation.officer = String(officer || 'officer').slice(0, 40); t.officerReply = message;
    this.tools().notify(t, 'sms', message); this.tools().resolve_ticket(t, 'human:' + t.escalation.officer);
    this.store.audit('human:' + t.escalation.officer, 'officer_reply', { ticket: t.id }); this.store.save();
    return t;
  }
}
function summarize(o) { try { const s = JSON.stringify(o); return s.length > 160 ? s.slice(0, 157) + '...' : s; } catch (e) { return '[unprintable]'; } }
module.exports = { Agent, QUEUES };
