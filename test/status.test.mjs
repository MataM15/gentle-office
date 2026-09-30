import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir, writeFile, appendFile} from 'node:fs/promises';
import path from 'node:path';
import {Status, toolKind, taskSummary, Tail, encodeCwd, newestSession} from '../src/status.mjs';
import * as sceneModule from '../public/office_scene.mjs';
import {lifecycleRoute, observeLifecycle, stepJourney} from '../public/office_scene.mjs';
import {root, row, user, call, result, final, line} from './helpers/fixtures.mjs';

test('turn and tool activity lifecycle', () => {
  const s = new Status();
  s.ingest(user);
  assert.equal(s.snapshot('/project').orchestrator.working, true);
  for (const [name, text] of [
    ['read', 'Reading files'], ['bash', 'Running command'],
    ['edit', 'Editing'], ['write', 'Writing file'], ['other', 'Using a tool'],
  ]) {
    s.ingest(call(name, name));
    assert.equal(s.snapshot('/p').orchestrator.activity, text);
    s.ingest(result(name));
  }
  assert.equal(s.snapshot('/p').orchestrator.activity, 'Thinking');
  s.ingest(final);
  assert.equal(s.snapshot('/p').orchestrator.working, false);
});

test('memory tool labels use actual toolCall names and clear after completion', () => {
  const s = new Status();
  s.ingest(user);
  for (const name of ['mem_search', 'mem_get_observation', 'mem_context', 'mem_timeline', 'mem_future_tool']) {
    s.ingest(call(name, name));
    assert.equal(s.snapshot('/p').orchestrator.activity, 'Checking memory', name);
    s.ingest(result(name));
    assert.equal(s.snapshot('/p').orchestrator.activity, 'Thinking');
  }
  for (const name of ['mem_save', 'mem_update', 'mem_session_summary', 'mem_capture_passive']) {
    s.ingest(call(name, name));
    assert.equal(s.snapshot('/p').orchestrator.activity, 'Saving to memory', name);
    s.ingest(result(name));
  }
  s.ingest(call('remember'));
  assert.equal(s.snapshot('/p').orchestrator.activity, 'Using a tool');
});

test('parallel agents finish together; independent calls stay active', () => {
  const s = new Status();
  s.ingest(user);
  s.ingest(call('subagent_run', 'a', {agents:[
    {agent:'gentle-ai-explore', task:'Inspect files.'}, {agent:'gentle-ai-verify', task:'Test it.'},
  ]}));
  s.ingest(call('subagent_run', 'b', {agent:'custom', task:'Build it.'}));
  assert.deepEqual(s.snapshot('/p').agents.map(a => a.role), ['scout', 'verifier', 'writer']);
  assert.equal(s.snapshot('/p').orchestrator.activity, 'Delegating');
  s.ingest(row('toolResult', {toolCallId:'a', details:{status:'completed'}}));
  assert.equal(s.snapshot('/p').agents.length, 1);
  s.ingest(row('toolResult', {toolCallId:'b', details:{status:'completed'}}));
  assert.equal(s.snapshot('/p').agents.length, 0);
});

test('parent errors and aborts leave children unconfirmed', () => {
  for (const stopReason of ['error', 'aborted']) {
    const s = new Status();
    s.ingest(user);
    s.ingest(call('subagent_run', 'a', {agent:'worker'}));
    s.ingest(row('assistant', {stopReason}));
    assert.equal(s.snapshot('/p').orchestrator.working, false);
    assert.equal(s.snapshot('/p').agents[0].state, 'unknown');
    assert.equal(s.snapshot('/p').events.filter(e => e.type === 'result').length, 0);
  }
});

test('background launch and unknown returns are not completion; explicit failures are', () => {
  const s = new Status();
  s.ingest(call('subagent_run', 'bg', {agent:'worker'}));
  s.ingest(row('toolResult', {toolCallId:'bg', details:{status:'running'},
    content:[{type:'text', text:'status: completed'}]}));
  assert.equal(s.snapshot('/p').agents[0].state, 'unknown');
  assert.equal(s.snapshot('/p').events.length, 1);
  s.ingest(row('toolResult', {toolCallId:'unrelated', isError:true}));
  assert.equal(s.snapshot('/p').agents.length, 1);
  s.ingest(row('toolResult', {toolCallId:'bg', content:[{type:'text', text:'status: failed\nSynthetic error'}]}));
  assert.equal(s.snapshot('/p').agents.length, 0);
  assert.equal(s.snapshot('/p').events.at(-1).state, 'failed');
  s.ingest(row('toolResult', {toolCallId:'bg', isError:true}));
  assert.equal(s.snapshot('/p').events.length, 2);
});

// Sanitized observed synchronous envelope: no details.status or status: text.
// members[].task_id correlates with results[].id, not the parent toolCallId.
const syncDetails = records => ({
  mode:'task', task_ids:records.map(r => r.id),
  waited_task_ids:records.filter(r => r.status !== 'running').map(r => r.id),
  background_task_ids:records.filter(r => r.status === 'running').map(r => r.id),
  members:records.map(r => ({task_id:r.id, agent:r.agent, effective_mode:'task', state:r.status})),
  results:records.map(r => ({id:r.id, agent:r.agent, mode:'task', effective_mode:'task', status:r.status})),
});

test('real synchronous completion retires only its agent and starts delivery', () => {
  const s = new Status();
  s.ingest(call('subagent_run', 'sync', {agent:'gentle-ai-worker'}));
  s.ingest(call('subagent_run', 'other', {agent:'gentle-ai-verify'}));
  const cursor = observeLifecycle(null, s.snapshot('/p'));
  const envelope = row('toolResult', {toolCallId:'sync', details:syncDetails([
    {id:'sanitized-task-1', agent:'gentle-ai-worker', status:'completed'},
  ]), content:[{type:'text', text:'Agent result available'}]});
  s.ingest(envelope);
  assert.deepEqual(s.snapshot('/p').agents.map(a => a.id), [2]);
  const events = observeLifecycle(cursor, s.snapshot('/p')).events;
  assert.deepEqual(events.map(e => [e.type, e.id, e.state]), [['result', 1, 'completed']]);
  assert.deepEqual(stepJourney(null, events[0], 0).position, lifecycleRoute('writer', 'result')[0]);
  s.ingest(envelope);
  assert.equal(s.snapshot('/p').events.length, 3);
  assert.doesNotMatch(JSON.stringify(s.snapshot('/p')), /sanitized-task/);
});

test('mixed real member outcomes override aggregate success and error flags', () => {
  for (const aggregate of [{status:'completed'}, {}]) {
    const s = new Status();
    s.ingest(call('subagent_run', 'group', {agents:[
      {agent:'gentle-ai-worker'}, {agent:'gentle-ai-verify'}, {agent:'gentle-ai-explore'},
    ]}));
    const records = [
      {id:'t3', agent:'gentle-ai-explore', status:'running'},
      {id:'t2', agent:'gentle-ai-verify', status:'failed'},
      {id:'t1', agent:'gentle-ai-worker', status:'completed'},
    ];
    const details = {...syncDetails(records), ...aggregate};
    details.results.reverse();
    s.ingest(row('toolResult', {toolCallId:'group', isError:true, details}));
    assert.deepEqual(s.snapshot('/p').events.filter(e => e.type === 'result').map(e => [e.id, e.state]),
      [[1, 'completed'], [2, 'failed']]);
    assert.deepEqual(s.snapshot('/p').agents.map(a => [a.id, a.state]), [[3, 'unknown']]);
    s.ingest(row('toolResult', {toolCallId:'group', details}));
    assert.equal(s.snapshot('/p').events.length, 5);
    s.ingest(row('toolResult', {toolCallId:'group', details:syncDetails([
      {...records[0], status:'completed'},
    ])}));
    assert.equal(s.snapshot('/p').agents.length, 0);
    assert.equal(s.snapshot('/p').events.at(-1).id, 3);
  }
});

test('member-only and result-only evidence works; ambiguous or conflicting identity stays neutral', () => {
  const record = {id:'t1', agent:'gentle-ai-worker', status:'completed'};
  for (const field of ['members', 'results']) {
    const s = new Status();
    s.ingest(call('subagent_run', 'one', {agent:record.agent}));
    s.ingest(row('toolResult', {toolCallId:'one', details:{[field]:syncDetails([record])[field]}}));
    assert.equal(s.snapshot('/p').agents.length, 0);
    assert.equal(s.snapshot('/p').events.at(-1).state, 'completed');
  }
  for (const scenario of ['launch', 'conflict', 'wrong-id', 'wrong-agent', 'duplicate-agent', 'empty']) {
    const s = new Status();
    const agents = [{agent:record.agent}];
    if (scenario === 'duplicate-agent') agents.push({agent:record.agent});
    s.ingest(call('subagent_run', 'one', {agents}));
    const details = syncDetails([{...record, status:scenario === 'launch' ? 'running' : 'completed'}]);
    if (scenario === 'conflict') details.members[0].state = 'running';
    if (scenario === 'wrong-id') details.members[0].task_id = 'different';
    if (scenario === 'wrong-agent') details.members[0].agent = details.results[0].agent = 'other';
    if (scenario === 'empty') details.members = details.results = [];
    s.ingest(row('toolResult', {toolCallId:'one', details, content:[{type:'text', text:'status: completed'}]}));
    assert.ok(s.snapshot('/p').agents.every(a => a.state === 'unknown'), scenario);
    assert.equal(s.snapshot('/p').events.filter(e => e.type === 'result').length, 0, scenario);
  }
});

test('snapshot baselines, repetition, rapid events and session resets', () => {
  const s = new Status();
  s.ingest(call('subagent_run', 'old'));
  let cursor = observeLifecycle(null, s.snapshot('/p'));
  assert.deepEqual(cursor.events, []);
  s.ingest(call('subagent_run', 'new'));
  s.ingest(call('subagent_run', 'new')); // duplicate history line
  s.ingest(row('toolResult', {toolCallId:'new', details:{status:'completed'}}));
  cursor = observeLifecycle(cursor, s.snapshot('/p'));
  assert.deepEqual(cursor.events.map(e => e.type), ['arrival', 'result']);
  assert.equal(new Set(cursor.events.map(e => e.id)).size, 1);
  cursor = observeLifecycle(cursor, s.snapshot('/p'));
  assert.deepEqual(cursor.events, []);
  const reset = observeLifecycle(cursor, new Status().snapshot('/p'));
  assert.equal(reset.reset, true);
  assert.deepEqual(reset.events, []);
});

test('privacy boundary exports no free-form content, paths, IDs or secrets', () => {
  const s = new Status();
  s.ingest(user);
  s.ingest(call('subagent_run', 'SECRET_ID', {
    agent:'SECRET_AGENT',
    task:'Build the panel with api_key=hunter2 and sk-abcdef1234567890XYZ in /private/dir/panel.ts. PRIVATE PROMPT',
    content:'SECRET_CONTENT',
  }));
  const payload = JSON.stringify(s.snapshot('/private/project'));
  assert.doesNotMatch(payload, /SECRET|PRIVATE|\/private|hunter2|abcdef1234/);
  assert.match(payload, /Build the panel with api_key=… and … in panel\.ts/);
  assert.equal(taskSummary('Line one\nline two'), 'Line one');
  assert.equal(taskSummary('x'.repeat(10) + ' ' + 'word '.repeat(20)).length, 60);
  assert.equal(taskSummary(''), 'Delegated task');
  s.ingest(result('SECRET_ID'));
  s.ingest(final);
  assert.doesNotMatch(JSON.stringify(s.snapshot('/p')), /SECRET|PRIVATE/);
});

test('tail partial UTF-8 lines, append, truncation and same-size replacement', async () => {
  const file = path.join(root, 'tail.jsonl'), tail = new Tail();
  await writeFile(file, line(user) + JSON.stringify(final).slice(0, 30));
  await tail.poll(file);
  assert.equal(tail.status.turn, true);
  await appendFile(file, JSON.stringify(final).slice(30) + '\n');
  await tail.poll(file);
  assert.equal(tail.status.turn, false);
  await writeFile(file, line(user));
  await tail.poll(file);
  assert.equal(tail.status.turn, true);
  const a = line(row('assistant', {stopReason:'stop'}));
  await writeFile(file, a);
  await tail.poll(file);
  assert.equal(tail.status.turn, false);
  await writeFile(file, a.replace('stop', 'oops'));
  await tail.poll(file);
  assert.equal(tail.offset, Buffer.byteLength(a));
  await tail.poll(null);
  assert.equal(tail.offset, 0);
});

test('discovery encoding and newest selection', async () => {
  assert.equal(encodeCwd('/home/user/projects'), '--home-user-projects--');
  const dir = path.join(root, 'discovery');
  await mkdir(dir, {recursive:true});
  await writeFile(path.join(dir, 'one.jsonl'), line(user));
  await new Promise(r => setTimeout(r, 20));
  await writeFile(path.join(dir, 'two.jsonl'), line(final));
  assert.equal(await newestSession(dir), path.join(dir, 'two.jsonl'));
  assert.equal(await newestSession(path.join(root, 'absent')), null);
});

test('instant memory calls are counted even after their results arrive', () => {
  const s = new Status();
  s.ingest(user);
  s.ingest(call('mem_search', 'm1'));
  s.ingest(call('mem_save', 'm2'));
  s.ingest(result('m1'));
  s.ingest(result('m2'));
  const {orchestrator} = s.snapshot('/p');
  assert.equal(orchestrator.activity, 'Thinking');
  assert.deepEqual(orchestrator.memory, {count:2, kind:'Saving to memory'});
});

test('tool props use a closed set and count instant calls', () => {
  assert.equal(toolKind('bash'), 'bash');
  assert.equal(toolKind('gentle_review_capture'), 'review');
  assert.equal(toolKind('mem_search'), null);
  assert.equal(toolKind('SECRET_TOOL'), null);
  const s = new Status();
  s.ingest(user);
  s.ingest(call('grep', 'g1'));
  assert.equal(s.snapshot('/p').orchestrator.kind, 'grep');
  s.ingest(result('g1'));
  s.ingest(call('gentle_review', 'r1'));
  assert.equal(s.snapshot('/p').orchestrator.activity, 'Reviewing code');
  s.ingest(result('r1'));
  assert.deepEqual(s.snapshot('/p').orchestrator.tool, {count:2, kind:'review'});
  assert.equal(s.snapshot('/p').orchestrator.kind, null);
});

test('structured tool errors are deduplicated and never inferred from output', () => {
  const s = new Status();
  for (const [id, fields, expected] of [
    ['text', {content:[{type:'text',text:'error failed status: failed'}]}, 0],
    ['stderr', {details:{stderr:'warning: failed',exitCode:0}}, 0],
    ['flag', {isError:true}, 1], ['status', {details:{status:'failed'}}, 2],
    ['exit', {details:{exitCode:1}}, 3], ['string', {details:{exitCode:'1'}}, 3],
  ]) {
    s.ingest(call('bash', id));
    const message = row('toolResult', {toolCallId:id,...fields});
    s.ingest(message); s.ingest(message);
    assert.equal(s.snapshot('/p').orchestrator.errorCount, expected);
  }
  s.ingest(row('toolResult', {toolCallId:'unseen',isError:true}));
  assert.equal(s.snapshot('/p').orchestrator.errorCount, 3);
  const feedback = sceneModule.createErrorFeedback();
  feedback.observe(s.snapshot('/p'), 0);
  assert.equal(feedback.active(1), false);
  s.ingest(call('read','new')); s.ingest(row('toolResult',{toolCallId:'new',isError:true}));
  feedback.observe(s.snapshot('/p'), 10);
  assert.equal(feedback.active(2509), true);
  feedback.observe(s.snapshot('/p'), 2000);
  assert.equal(feedback.active(2510), false, 'repeated snapshots cannot renew feedback');
  feedback.reset(); feedback.observe(s.snapshot('/p'), 3000);
  assert.equal(feedback.active(3001), false);
  feedback.observe(new Status().snapshot('/other'), 4000);
  assert.equal(feedback.active(4001), false);
});
