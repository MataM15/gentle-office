import { open, stat, readdir } from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';

export const encodeCwd = cwd => `--${path.resolve(cwd).replace(/^\/+|\/+$/g, '').replaceAll('/', '-')}--`;
export async function newestSession(dir) {
  try {
    const files = await readdir(dir);
    const entries = await Promise.all(files.filter(f => f.endsWith('.jsonl')).map(async f => {
      const file = path.join(dir, f);
      try { const s = await stat(file); return s.isFile() ? {file, time:s.mtimeMs} : null; } catch { return null; }
    }));
    return entries.filter(Boolean).sort((a,b) => b.time-a.time || b.file.localeCompare(a.file))[0]?.file ?? null;
  } catch { return null; }
}
function label(name) {
  if (/^mem_/.test(name)) {
    return ['mem_save', 'mem_update', 'mem_session_summary', 'mem_capture_passive'].includes(name)
      ? 'Saving to memory' : 'Checking memory';
  }
  if (/^gentle_review/.test(name)) return 'Reviewing code';
  if (/^(?:web_search|fetch_content|source_check|get_search_content)$/.test(name)) return 'Searching the web';
  return {
    read:'Reading files', find:'Finding files', grep:'Searching code', ls:'Browsing folders',
    bash:'Running command', edit:'Editing', write:'Writing file', subagent_run:'Delegating',
  }[name] ?? 'Using a tool';
}
// Closed set of animated props; anything else has no prop.
export const toolKind = name => /^gentle_review/.test(name) ? 'review'
  : /^(?:web_search|fetch_content|source_check|get_search_content)$/.test(name) ? 'web'
  : ['bash', 'read', 'grep', 'find', 'ls', 'edit', 'write'].includes(name) ? name : null;
export const roleFor = name => /explor|scout/i.test(name) ? 'scout' : /verify|verifier/i.test(name) ? 'verifier' : 'writer';
// Export only the first sentence of a task, shortened and scrubbed: absolute paths
// become basenames and anything that looks like a key, token or assignment value is masked.
export function taskSummary(task) {
  const first = String(task ?? '').split(/(?<=[.!?])\s|\n/)[0].slice(0, 300);
  const clean = first
    .replace(/(?<![\w.])(?:~|\/)[\w.@-]*(?:\/[\w.@-]+)+\/?/g, p => path.basename(p) || '…')
    .replace(/\b(\w*(?:key|token|secret|password|passwd|auth)\w*)\s*[:=]\s*\S+/gi, '$1=…')
    .replace(/\b(?:sk|pk|ghp|gho|xox[a-z])[-_][\w-]{8,}|\b[\w-]{32,}\b/gi, '…')
    .replace(/\s+/g, ' ')
    .replace(/[.!?]$/, '')
    .trim();
  if (!clean) return 'Delegated task';
  return clean.length > 60 ? clean.slice(0, 59).trimEnd() + '…' : clean;
}
// Accept only explicit terminal declarations, never prose mentioning success.
export function terminalEvidence(message, identity) {
  const statuses = {completed:'completed', failed:'failed', error:'failed', aborted:'aborted', cancelled:'aborted', blocked:'blocked', interaction_required:'blocked', partial:'partial'};
  const details = message.details ?? {};
  if (Array.isArray(details.members) || Array.isArray(details.results)) {
    // Member evidence takes precedence over aggregate flags and prose. Never
    // infer identity from array order: results can arrive in completion order.
    if (identity && !identity.unique) return null;
    const matching = records => (Array.isArray(records) ? records : [])
      .filter(record => record && (!identity || record.agent === identity.name));
    const members = matching(details.members), results = matching(details.results);
    if (members.length > 1 || results.length > 1) return null;
    const member = members[0], result = results[0];
    if (member && result && (member.agent !== result.agent ||
        (member.task_id != null && result.id != null && member.task_id !== result.id))) return null;
    const evidence = [];
    if (member) evidence.push(statuses[member.state] ?? null);
    if (result) evidence.push(statuses[result.status] ?? null);
    return evidence.length && evidence.every(state => state && state === evidence[0]) ? evidence[0] : null;
  }
  if (message.isError === true) return 'failed';
  const structured = message.details?.status;
  if (typeof structured === 'string') return statuses[structured] ?? null;
  const text = (Array.isArray(message.content) ? message.content : [])
    .filter(p => p.type === 'text').map(p => p.text).join('\n');
  // A launch acknowledgment may quote a task containing a status line.
  if (/\b(background|launched|running|queued)\b/i.test(text)) return null;
  const match = text.trim().match(/^status:\s*(completed|failed|error|aborted|cancelled|blocked|interaction_required|partial)\s*(?:\n|$)/i);
  return match ? statuses[match[1].toLowerCase()] : null;
}
// Only protocol fields are evidence. stderr and human-readable content are not.
export function toolResultFailed(message) {
  return message.isError === true || ['error', 'failed'].includes(message.details?.status)
    || (Number.isFinite(message.details?.exitCode) && message.details.exitCode !== 0);
}
export class Status {
  constructor() {
    this.turn = false; this.started = null; this.tools = new Map(); this.agents = new Map();
    this.epoch = randomUUID(); this.sequence = 0; this.events = []; this.nextAgent = 0;
    this.outcome = null; this.seenCalls = new Set();
    this.agentIdentities = new WeakMap();
    // Memory calls often finish between polls, so count them instead of relying on live activity.
    this.memory = {count:0, kind:null};
    this.tool = {count:0, kind:null};
    this.action = {count:0, kind:null, label:null};
    this.errorCount = 0; this.errorCalls = new Set();
  }
  emit(type, agent) {
    this.events.push({sequence:++this.sequence, type, id:agent.id, role:agent.role, state:agent.state});
    if (this.events.length > 128) this.events.shift();
  }
  ingest(row) {
    const m = row?.message;
    if (row?.type !== 'message' || !m) return;
    const raw = m.timestamp ?? row.timestamp;
    const time = typeof raw === 'number' ? raw : Date.parse(raw);
    const started = Number.isFinite(time) ? time : Date.now();
    if (m.role === 'user') {
      this.turn = true; this.started = started; this.outcome = null;
      this.tools.clear();
      this.action = {count:this.action.count + 1, kind:null, label:null};
    }
    if (m.role === 'toolResult') {
      if (this.seenCalls.has(m.toolCallId) && !this.errorCalls.has(m.toolCallId) && toolResultFailed(m)) {
        this.errorCalls.add(m.toolCallId);
        this.errorCount++;
      }
      this.tools.delete(m.toolCallId);
      const group = this.agents.get(m.toolCallId);
      if (group) {
        const pending = [];
        for (const agent of group) {
          const terminal = terminalEvidence(m, this.agentIdentities.get(agent));
          agent.state = terminal ?? 'unknown';
          if (terminal) this.emit('result', agent);
          else pending.push(agent);
        }
        if (pending.length) this.agents.set(m.toolCallId, pending);
        else this.agents.delete(m.toolCallId);
      }
    }
    if (m.role !== 'assistant') return;
    const calls = (Array.isArray(m.content) ? m.content : []).filter(p => p.type === 'toolCall');
    for (const c of calls) {
      if (this.seenCalls.has(c.id)) continue;
      this.seenCalls.add(c.id);
      this.turn = true;
      this.tools.set(c.id, {label:label(c.name), kind:toolKind(c.name)});
      this.action = {count:this.action.count + 1,
        kind:/^mem_/.test(c.name) ? 'memory' : toolKind(c.name), label:label(c.name)};
      if (/^mem_/.test(c.name)) this.memory = {count:this.memory.count + 1, kind:label(c.name)};
      const kind = toolKind(c.name);
      if (kind) this.tool = {count:this.tool.count + 1, kind};
      if (c.name === 'subagent_run') {
        const args = c.arguments ?? {};
        const entries = Array.isArray(args.agents) ? args.agents : [args];
        this.agents.set(c.id, entries.slice(0, 32).map(a => {
          const name = typeof a === 'string' ? a : a?.agent;
          const role = roleFor(String(name ?? ''));
          // Canonical names also prevent arbitrary agent identifiers leaking secrets.
          const agent = role === 'scout' ? 'explore' : role === 'verifier' ? 'verify' : 'worker';
          const entry = {id:++this.nextAgent, role, agent, task:taskSummary(a?.task ?? args.task), started, state:'delegated'};
          this.agentIdentities.set(entry, {name, unique:entries.filter(a =>
            (typeof a === 'string' ? a : a?.agent) === name).length === 1});
          this.emit('arrival', entry);
          return entry;
        }));
      }
    }
    if (['error','aborted'].includes(m.stopReason)) {
      this.turn = false; this.tools.clear(); this.outcome = m.stopReason;
      // Parent interruption is not evidence that background children completed.
      for (const group of this.agents.values()) for (const agent of group) agent.state = 'unknown';
    } else if (!calls.length && (m.stopReason === 'stop' || !m.stopReason)) {
      this.turn = false; this.tools.clear();
    }
    if (!this.turn) this.action = {...this.action, kind:null, label:null};
  }
  snapshot(cwd, session = true) {
    const working = this.turn || this.tools.size > 0;
    const current = [...this.tools.values()].at(-1);
    const activity = working ? current?.label ?? 'Thinking'
      : this.outcome === 'error' ? 'Error observed' : this.outcome === 'aborted' ? 'Turn interrupted' : 'Waiting';
    return {
      cwd:path.basename(cwd), session, epoch:this.epoch, sequence:this.sequence,
      events:this.events.map(e => ({...e})),
      orchestrator:{working, activity, kind:current?.kind ?? null, started:working ? this.started : null, memory:{...this.memory}, tool:{...this.tool}, action:{...this.action}, errorCount:this.errorCount},
      agents:[...this.agents.values()].flat(),
    };
  }
}
export class Tail {
  constructor() { this.identity = null; this.reset(null); }
  reset(file) {
    this.file = file;
    this.offset = 0;
    this.pending = Buffer.alloc(0);
    this.anchor = Buffer.alloc(0);
    this.status = new Status();
  }
  async poll(file) {
    if (file !== this.file) this.reset(file);
    if (!file) return false;
    let handle;
    try {
      handle = await open(file, 'r');
      const s = await handle.stat();
      const identity = `${s.dev}:${s.ino}`;
      let changed = false;
      if (this.offset && s.size >= this.offset) {
        const check = Buffer.alloc(this.anchor.length);
        await handle.read(check, 0, check.length, this.offset-check.length);
        changed = !check.equals(this.anchor);
      }
      if (identity !== this.identity || s.size < this.offset || changed) this.reset(file);
      this.identity = identity;
      while (this.offset < s.size) {
        const chunk = Buffer.alloc(Math.min(65536, s.size-this.offset));
        const {bytesRead} = await handle.read(chunk, 0, chunk.length, this.offset);
        if (!bytesRead) break;
        this.offset += bytesRead;
        this.anchor = Buffer.concat([this.anchor,chunk.subarray(0,bytesRead)]).subarray(-64);
        const data = Buffer.concat([this.pending,chunk.subarray(0,bytesRead)]);
        let from = 0;
        for (let i=0;i<data.length;i++) if (data[i] === 10) {
          try { this.status.ingest(JSON.parse(data.subarray(from,i).toString('utf8'))); } catch { /* Ignore invalid complete lines. */ }
          from = i+1;
        }
        this.pending = Buffer.from(data.subarray(from));
      }
      return true;
    } catch { this.reset(null); return false; }
    finally { await handle?.close(); }
  }
}
