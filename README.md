# KrishiDesk Agent: unattended ticket resolution for farm help desks

**Vultr Agent Rush (lablab.ai) entry. Challenge 2: Powering the Future of Work. Use case: Customer Support, "resolve tickets across systems, take actions and escalate when human input is needed".**

> Built by Tab, an AI assistant, for team lead Akshay Wagh (team "Tab x Akshay"). Tab wrote the code; Akshay set the goal and reviews the entry. MIT licensed.

**Live demo:** https://krishidesk-agent.sites.tab.bot · **Demo video:** https://youtu.be/H4vLOJi4dL4

> **Deployment status (honest note):** the code is built for a Vultr Cloud Compute VM and ships with the one-paste startup script `deploy/cloud-init.sh`. Tab's Vultr account was created, but Vultr's console asks for a payment method before it accepts the hackathon gift code, and Tab does not enter cards, so the VM could not be launched. The live demo above therefore runs the identical code on Tab's own app host (same `node src/server.js`). If you want it on Vultr, run the setup below on any Vultr instance.

## What it does

India's agriculture advice centres get farmer queries by phone, SMS and web: pest and disease questions, scheme status (PM-KISAN, PMFBY, KCC), input complaints, and sometimes emergencies (someone drank pesticide). A human officer handles all of it today.

This agent runs on a server with nobody watching, and for every ticket it:

1. **Triages** it (category, crop, urgency) with the KrishiDesk core (pure JS, rules plus a vetted knowledge base with citations).
2. **Looks up** vetted advisories and drafts a reply.
3. **Acts across systems**: routes it to a queue with an SLA, sends a notification (SMS/WhatsApp/officer-pager adapters), links it to similar tickets, and raises a **district outbreak alert** when three or more pest reports on one crop arrive from one district within 24 hours.
4. **Resolves it alone** only when the advice is vetted, non-chemical and crop-specific. Everything else is **escalated to a human** with the reason and a due time.

## Safety floor (never overridden)

| Ticket | What the agent does |
|---|---|
| Pesticide swallowed or poisoning symptoms | Emergency queue (15-min SLA), sends only "call 108 / go to hospital with the label", human must call back. **No crop advice is generated.** |
| Self-harm words | Helpline (Tele-MANAS 14416, 112), human call-back now. |
| Chemical name, dose or tank-mix question | Never answered by the agent; a human expert replies with an approved product and dose. |
| Suspected fake or substandard input | Input-quality queue, human officer. |
| Anything unexpected (error, step budget) | **Fails safe to a human**, never to the farmer. |

The rules are code, not a prompt: an optional LLM hook can only **add** a note, it cannot remove an escalation. Run in this deployment: **rules-only, no LLM** (health endpoint says so).

## Containment and control

* **Tool allow-list**: the agent can call exactly eight tools (`triage_ticket`, `lookup_advisory`, `draft_reply`, `route_ticket`, `escalate_to_human`, `notify`, `resolve_ticket`, `link_duplicates`). Anything else is blocked and audited.
* **Budgets**: at most 8 tool calls per ticket, 5 tickets per tick, 2,000 characters per ticket, 40 writes per minute per IP.
* **Kill switch**: `POST /api/kill` halts the agent at the very next tool call (mid-ticket included); the ticket stays untouched. The public demo auto-resumes after 90 s; set `DEMO_OPEN_KILL=0` and `ADMIN_TOKEN=...` to require a token.
* **Tamper-evident audit log**: every tool call and decision is a row whose hash chains to the previous one. `GET /api/audit/verify` recomputes the chain.
* **No secrets in the agent**: no API keys, no shell, no network calls except an optional notification webhook.
* The systemd unit runs it as an unprivileged user with a read-only filesystem except its data directory, a 300 MB memory cap and `NoNewPrivileges`.

## Architecture

```
 farmer (web / SMS / WhatsApp / email)         officer (browser)
          |                                         ^  reply
          v                                         |
  +------------------- one VM (Vultr Cloud Compute target; Ubuntu, systemd) ---------------------+
  |  HTTP server (Node, no dependencies)                                                   |
  |    /api/tickets  /api/status  /api/audit  /api/outbox  /api/alerts  /api/kill  /       |
  |         |                                                                              |
  |   Ticket queue (JSON store, atomic writes) <---- agent loop every 3 s (unattended) ----+
  |                                                    |                                   |
  |        KrishiDesk core: triage + safety floor      | tool allow-list + budgets         |
  |        vetted knowledge base (cited advisories)    | kill switch checked on each call  |
  |                                                    v                                   |
  |   systems the agent acts on:  queue/SLA router | notification outbox | outbreak desk  |
  |                              hash-chained audit log | human escalation inbox          |
  +----------------------------------------------------------------------------------------+
```

## How Vultr is used

* **Vultr Cloud Compute (regular, Ubuntu) is the deployment target** and would host the whole backend: the ticket store, the agent loop, the API and the web UI. It deploys from `deploy/cloud-init.sh` (Vultr "Startup Script" or cloud-init user-data) and is managed by systemd (`Restart=always`), so it keeps resolving tickets with nobody logged in. The script was tested in logic only on this build (see the deployment note above).
* The design makes the VM the control layer: the server that accepts tickets, decides, acts and records is one process on one VM; there is no static hosting.
* Vultr Serverless Inference is optional for this challenge and **not enabled**; the agent is deterministic and auditable (a deliberate choice for a safety-critical farm help desk). `src/agent.js` has a single `llm` hook for advisory notes if you want to add one.

## Setup in under 15 minutes

On a fresh Vultr Cloud Compute instance (Ubuntu 22.04 or 24.04, 1 vCPU / 1 GB is enough), paste `deploy/cloud-init.sh` into the **Startup Script** field when you deploy, or SSH in and run:

```bash
curl -fsSL https://raw.githubusercontent.com/tab-for-akshay/krishidesk-agent-rush/main/deploy/cloud-init.sh | sudo bash
curl http://YOUR_VM_IP/api/health
```

Open `http://YOUR_VM_IP/`, press **Load 9 demo tickets** and watch the agent work. To update later: `sudo bash /opt/agentrush/app/deploy/update.sh`.

Local run (Node 18+, no `npm install` needed): `PORT=8080 node src/server.js`, then open http://localhost:8080. Tests: `npm test` (10 tests: safety floor, kill switch mid-flight, allow-list, audit tamper detection, outbreak alert, full HTTP flow).

## API

`GET /api/health` · `GET /api/status` · `GET /api/tickets` · `POST /api/tickets {text, farmer:{district}}` · `POST /api/tickets/:id/officer-reply {officer, message}` · `GET /api/audit` · `GET /api/audit/verify` · `GET /api/outbox` · `GET /api/alerts` · `POST /api/seed` · `POST /api/kill` · `POST /api/resume`

## Honest limits

* Notification channels (SMS, WhatsApp, officer pager) are **simulated adapters** that write to the outbox; set `NOTIFY_WEBHOOK` to push them to a real endpoint.
* The knowledge base is a small vetted set (each entry cites its source); anything outside it escalates to a human instead of guessing.
* Demo tickets use made-up farmers. Do not enter real personal data into the public demo.
* Rules-only matching is keyword based (English plus a few Hindi/Marathi words); an LLM could widen coverage but must never remove a safety escalation.

## Credits

KrishiDesk core and knowledge base originate from Tab's earlier Atlassian Codegeist entry (`tab-for-akshay/krishidesk`, MIT). New in this repo: the unattended agent loop, tool allow-list, queue/SLA router, outbreak desk, hash-chained audit log, kill switch, web console and Vultr deployment.
