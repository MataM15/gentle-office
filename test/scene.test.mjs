import test from 'node:test';
import assert from 'node:assert/strict';
import * as sceneModule from '../public/office_scene.mjs';
import {
  createScene, desks, walls, feetBox, doors, doorOpen, memoryRoute, memoryPosition, memoryWalk, memoryTravelSeconds, stacksWalker, reviewWalker,
  lifecycleRoute, makeWalker, stepJourney, createWorkers, restPositions, visitorPosition, standingBox, verifierStacksRoute,
} from '../public/office_scene.mjs';
import {Status} from '../src/status.mjs';
import {row, user, call, result, final} from './helpers/fixtures.mjs';

function assertOutsideWalls(position) {
  const [x, y, w, h] = feetBox(position);
  for (const [wx, wy, ww, wh] of walls) {
    assert.ok(x + w <= wx || x >= wx + ww || y + h <= wy || y >= wy + wh,
      `Feet ${position} intersect wall ${[wx, wy, ww, wh]}`);
  }
}

const intersects = ([x,y,w,h], [a,b,c,d]) => x < a+c && x+w > a && y < b+d && y+h > b;

function advanceWorkers(workers, seconds, active=[], inspect=()=>{}) {
  let previous = workers.step(0, active);
  for (let i=0;i<seconds*60;i++) {
    const next = workers.step(1/60, active);
    for (const role of Object.keys(restPositions)) {
      assert.ok(Math.hypot(...next[role].position.map((v,j) => v-previous[role].position[j])) <= 72/60+1e-8, role);
      assertOutsideWalls(next[role].position);
    }
    inspect(next); previous = next;
  }
  return previous;
}

test('action snapshots retain fast calls only for their parent turn', () => {
  const s = new Status(), gesture = sceneModule.createActionGesture();
  const observe = now => gesture.observe(s.snapshot('/p'), now);
  s.ingest(user); s.ingest(call('read', 'r')); s.ingest(result('r'));
  observe(0);
  assert.equal(gesture.step(6000, 6).tool.kind, 'read');
  observe(6000);
  assert.equal(gesture.step(7000, 1).tool.t, 7, 'polls do not restart action');
  s.ingest(call('write', 'w')); s.ingest(result('w')); observe(7000);
  assert.equal(gesture.step(7100, .1).tool.kind, 'write');
  s.ingest(call('unknown_tool', 'u')); observe(7200);
  assert.equal(gesture.step(7200, 0).tool, null, 'unknown instruction replaces prior prop');
  s.ingest(call('subagent_run', 'bg', {agent:'worker'}));
  s.ingest(call('bash', 'b')); observe(8000);
  s.ingest(final); observe(9000);
  assert.equal(s.snapshot('/p').orchestrator.working, false, 'pending parent calls cannot keep turn alive');
  assert.equal(s.snapshot('/p').agents.length, 1, 'parent end does not complete background worker');
  assert.equal(gesture.step(9000, 1).tool, null);
  s.ingest(user); observe(10000);
  assert.equal(gesture.step(10000, 1).tool, null, 'new prompt cannot resurrect old action');
  s.ingest(result('b')); observe(11000);
  assert.equal(gesture.step(11000, 1).tool, null, 'late result cannot resurrect action');
});

test('parent memory and review cancel along routes without lingering props', () => {
  for (const [name, field, duration] of [['mem_search', 'walk', memoryTravelSeconds],
    ['gentle_review_start', 'reviewWalk', reviewWalker.travelSeconds]]) {
    for (const finish of ['replacement', 'end', 'disconnect', 'session']) {
      const s = new Status(), g = sceneModule.createActionGesture();
      s.ingest(user); s.ingest(call(name)); s.ingest(result('call'));
      g.observe(s.snapshot('/p'), 0);
      const away = g.step(20000, duration + 1);
      assert.equal(away[field].phase, 'shelf');
      if (finish === 'disconnect') g.disconnect();
      else if (finish === 'session') g.observe(new Status().snapshot('/new'), 20000);
      else {
        s.ingest(finish === 'end' ? final : call('unknown', 'next'));
        g.observe(s.snapshot('/p'), 20000);
      }
      const back = g.step(20000, 0);
      assert.deepEqual(back.trip.position, away.trip.position, 'no teleport on cancellation');
      assert.equal(back.trip.book, false);
      assert.equal(back.review, null);
      assert.equal(back[field].phase, 'returning');
      assert.equal(g.step(40000, duration + 1).trip.away, false);
    }
  }
  const s = new Status(), g = sceneModule.createActionGesture();
  s.ingest(user); s.ingest(call('mem_search')); g.observe(s.snapshot('/p'), 0);
  const outward = g.step(1000, 1);
  g.disconnect();
  const returning = g.step(1000, 0);
  assert.deepEqual(returning.trip.position, outward.trip.position);
  assert.equal(returning.walk.phase, 'returning', 'cancelled outbound trip turns back immediately');
  g.observe(s.snapshot('/p'), 1000);
  assert.deepEqual(g.step(1000, 0).trip.position, returning.trip.position, 'active reconnect resumes without snapping');
  s.ingest(final); g.disconnect(); g.observe(s.snapshot('/p'), 2000);
  assert.equal(g.step(3000, 2).trip.away, false, 'idle reconnect does not replay history');
});

test('rest-to-desk and delivery routes cross existing gaps and return to unchanged seats', () => {
  for (const role of ['writer', 'verifier', 'scout']) for (const type of ['arrival', 'result']) {
    const route = lifecycleRoute(role, type), walker = makeWalker(route);
    const opened = new Set();
    for (let t = 0; t <= walker.travelSeconds; t += 1 / 60) {
      const position = walker.position(t);
      assertOutsideWalls(position);
      for (const door of doors) if (doorOpen(door, {away:true, position})) opened.add(door.id);
    }
    assert.equal(opened.has('exit'), false);
    if (type === 'result') {
      assert.ok(opened.has('bridge'));
      assert.ok(opened.has('workshop'));
    }
    const event = {role, type, state:'failed'};
    const journey = stepJourney(null, event, 100);
    assert.equal(journey.done, true);
    const d = desks.find(d => d.id === role);
    assert.deepEqual(journey.position, [d.x + 38, d.y + 8]);
    if (type === 'result') assert.equal(journey.text, 'Error received');
  }
});

test('orchestrator walks from desk to Engram, waits, then returns through doors', () => {
  const desk = desks.find(d => d.id === 'orchestrator');
  const start = [desk.x + 38, desk.y + 8];
  let pose = memoryWalk(null, false, 0);
  assert.deepEqual(pose.position, start);
  assert.equal(pose.away, false);
  assert.deepEqual(memoryPosition(-1), start);
  assert.deepEqual(memoryPosition(Infinity), memoryRoute.at(-1));
  for (let t = 0; t < memoryTravelSeconds + 1; t += 1 / 60) {
    const previous = pose;
    pose = memoryWalk(pose, true, 1 / 60);
    assertOutsideWalls(pose.position);
    assert.ok(Math.hypot(...pose.position.map((v, i) => v - previous.position[i])) <= 72 / 60 + 1e-9);
  }
  assert.equal(pose.phase, 'shelf');
  assert.equal(pose.book, true);
  assert.deepEqual(pose.position, [426, 78]);
  assert.deepEqual(memoryWalk(pose, true, 30), pose);
  for (let t = 0; t < memoryTravelSeconds + 1; t += 1 / 60) {
    pose = memoryWalk(pose, false, 1 / 60);
    assertOutsideWalls(pose.position);
  }
  assert.equal(pose.phase, 'seated');
  assert.deepEqual(pose.position, start);
  assert.equal(pose.away, false);
});

test('short memory calls finish the visit; renewed activity reverses without a jump', () => {
  const start = memoryWalk(null, true, .1);
  const copy = structuredClone(start);
  const shelf = memoryWalk(start, false, memoryTravelSeconds - .1);
  assert.deepEqual(start, copy, 'pure helper must not mutate its input');
  assert.deepEqual(shelf.position, memoryRoute.at(-1));
  const returning = memoryWalk(shelf, false, .5);
  assert.equal(returning.phase, 'returning');
  const renewed = memoryWalk(returning, true, 0);
  assert.deepEqual(renewed.position, returning.position);
  assert.equal(renewed.phase, 'outbound');
  assert.equal(memoryWalk(start, false, memoryTravelSeconds * 2).phase, 'seated');
  const whole = memoryWalk(null, true, 2);
  let split = null;
  for (let i = 0; i < 120; i++) split = memoryWalk(split, true, 1 / 60);
  for (let i = 0; i < 2; i++) assert.ok(Math.abs(whole.position[i] - split.position[i]) < 1e-9);
});

test('renderer draws the pixel head, seated or walking, without the portrait', () => {
  for (const away of [false, true]) {
    let rectangles = 0, images = 0;
    const colors = new Set();
    const ctx = {
      fillRect() { rectangles++; colors.add(this.fillStyle); },
      fillText() {}, save() {}, restore() {}, beginPath() {}, moveTo() {},
      lineTo() {}, closePath() {}, clip() {},
      drawImage(img) { assert.equal(img, 'avatar'); images++; },
    };
    const agents = Object.fromEntries(desks.map(d => [d.id, {working:true, hand:1, bob:1, phase:3}]));
    if (away) Object.assign(agents.orchestrator, memoryWalk(null, true, memoryTravelSeconds));
    assert.deepEqual(createScene(ctx, 'avatar').render({agents}), []);
    assert.ok(rectangles > 500);
    assert.equal(images, 0);
    assert.ok(colors.has('#F095C8'));
    assert.ok(colors.has('#57959c'));
  }
});

test('doors open only while a walker passes them', () => {
  const at = id => doors.find(d => d.id === id);
  const middle = at('bridge-engram');
  assert.equal(doorOpen(middle, undefined), false);
  assert.equal(doorOpen(middle, {away:false, position:[246,64]}), false);
  assert.equal(doorOpen(middle, {away:true, position:[246,64]}), true);
  assert.equal(doorOpen(middle, {away:true, position:[134,64]}), false);
  assert.equal(doorOpen(middle, {away:true, position:[426,80]}), false);
  assert.equal(doorOpen(middle, memoryWalk(null, true, 0.3)), false);
  assert.equal(doorOpen(at('workshop'), {away:true, position:[186,180]}), true);
  assert.equal(doorOpen(at('stacks'), {away:true, position:[518,182]}), true);
  assert.equal(doorOpen(at('exit'), {away:true, position:[186,200]}), false);
});

// Feet path crosses the door's centre line inside its gap span.
function crossesDoor(d, route) {
  for (let i = 1; i < route.length; i++) {
    const [ax, ay] = [route[i-1][0] + 16, route[i-1][1] + 67], [bx, by] = [route[i][0] + 16, route[i][1] + 67];
    if (d.swing === 'right') {
      const lx = d.x + d.w / 2;
      if ((ax - lx) * (bx - lx) < 0) { const y = ay + (by - ay) * (lx - ax) / (bx - ax); if (y >= d.y && y <= d.y + d.h) return true; }
    } else {
      const ly = d.y + d.h / 2;
      if ((ay - ly) * (by - ly) < 0) { const x = ax + (bx - ax) * (ly - ay) / (by - ay); if (x >= d.x && x <= d.x + d.w) return true; }
    }
  }
  return false;
}

test('walking past a door without crossing it keeps it closed', () => {
  const routes = {memory:memoryRoute, stacks:sceneModule.stacksRoute, verifierStacks:verifierStacksRoute,
    review:sceneModule.reviewRoute, water:sceneModule.toWaterRoute};
  for (const role of ['writer', 'verifier', 'scout']) {
    routes[`${role}-arrival`] = lifecycleRoute(role, 'arrival');
    routes[`${role}-result`] = lifecycleRoute(role, 'result');
    routes[`${role}-water-rest`] = sceneModule.waterToRestRoute(role);
  }
  for (const [name, route] of Object.entries(routes)) {
    const walker = makeWalker(route), opened = new Set();
    for (let t = 0; t <= walker.travelSeconds; t += 1 / 120)
      for (const door of doors) if (doorOpen(door, {away:true, position:walker.position(t)})) opened.add(door.id);
    const crossed = doors.filter(d => crossesDoor(d, route)).map(d => d.id).sort();
    assert.deepEqual([...opened].sort(), crossed, `${name} opens exactly the doors it crosses`);
  }
});

test('scout walks to The Stacks and back without crossing walls', () => {
  let pose = stacksWalker.step(null, false, 0);
  assert.deepEqual(pose.position, [78, 302]);
  for (let t = 0; t < stacksWalker.travelSeconds + 1; t += 1 / 60) {
    pose = stacksWalker.step(pose, true, 1 / 60);
    assertOutsideWalls(pose.position);
  }
  assert.equal(pose.phase, 'shelf');
  for (let t = 0; t < stacksWalker.travelSeconds + 1; t += 1 / 60) {
    pose = stacksWalker.step(pose, false, 1 / 60);
    assertOutsideWalls(pose.position);
  }
  assert.equal(pose.phase, 'seated');
});

test('resting bodies and the visitor clear walls, furniture and one another', () => {
  const furniture = desks.flatMap(d => [
    [d.x,d.y+58,108,56], [d.x+30,d.y+32,48,44],
  ]);
  furniture.push([32,108,52,60], [166,262,28,54], [300,72,120,70], [460,72,120,70]);
  const bodies = Object.values(restPositions).map(standingBox);
  for (const body of [...bodies, standingBox(visitorPosition)]) {
    for (const obstacle of [...walls, ...furniture]) assert.equal(intersects(body, obstacle), false, `${body} / ${obstacle}`);
  }
  for (let i=0;i<bodies.length;i++) for (let j=i+1;j<bodies.length;j++)
    assert.equal(intersects(bodies[i], bodies[j]), false);
  assert.equal(intersects(standingBox(visitorPosition), [130,56,40,76]), false);
});

test('rapid same-role arrivals, early results and concurrent deliveries stay continuous and serialized', () => {
  const workers = createWorkers();
  const initial = workers.step(0);
  for (const role of Object.keys(restPositions)) {
    assert.deepEqual(initial[role].position, restPositions[role]);
    assert.equal(initial[role].away, true);
  }
  workers.observe(['scout','writer','verifier','writer'].flatMap((role,id) => [
    {role,id,type:'arrival'}, {role,id,type:'result',state:'completed'},
  ]));
  let pauses = 0, prior = '';
  const final = advanceWorkers(workers, 180, [], poses => {
    const visitors = Object.entries(poses).filter(([,p]) => p.phase === 'pause' && !p.stride);
    assert.ok(visitors.length <= 1);
    const name = visitors[0]?.[0] ?? '';
    if (name && name !== prior) { pauses++; assert.deepEqual(visitors[0][1].position, visitorPosition); }
    prior = name;
  });
  assert.equal(pauses, 4);
  for (const role of Object.keys(restPositions)) assert.deepEqual(final[role].position, restPositions[role]);
});

test('Scout returns continuously from Stacks before delivery; remaining real work resumes', () => {
  const workers = createWorkers();
  workers.observe([{role:'scout',type:'arrival'}]);
  let poses = advanceWorkers(workers, 25, ['scout']);
  assert.deepEqual(poses.scout.position, stacksWalker.route.at(-1));
  workers.observe([{role:'scout',type:'result',state:'partial'}, {role:'scout',type:'arrival'}]);
  let sawSeat = false, sawDelivery = false;
  poses = advanceWorkers(workers, 65, ['scout'], p => {
    if (p.scout.position.toString() === stacksWalker.route[0].toString()) sawSeat = true;
    if (p.scout.phase === 'pause') { assert.ok(sawSeat); sawDelivery = true; }
  });
  assert.ok(sawDelivery);
  assert.deepEqual(poses.scout.position, stacksWalker.route.at(-1));
});

test('disconnect freezes identity; baseline/reset retraces current paths without outcomes or jumps', () => {
  for (const seconds of [0.4, 3, 7, 13, 18]) {
    const workers = createWorkers();
    workers.observe([{role:'writer',type:'arrival'}, {role:'writer',type:'result',state:'failed'}]);
    const before = advanceWorkers(workers, seconds);
    const frozen = workers.step(10, [], false);
    assert.deepEqual(frozen, before);
    workers.reset();
    assert.deepEqual(workers.step(0).writer.position, before.writer.position);
    const final = advanceWorkers(workers, 45, [], poses => {
      assert.notEqual(poses.writer.text, 'Error received');
    });
    assert.deepEqual(final.writer.position, restPositions.writer);
  }
  const baseline = createWorkers();
  const poses = advanceWorkers(baseline, 10, ['writer']);
  assert.equal(poses.writer.away, false);
  assert.equal(poses.writer.text, null);
});

test('repeated resets during delivery RETURN never reverse homeward travel or lose new work', () => {
  for (const role of Object.keys(restPositions)) for (const renewed of [false, true]) {
    const workers = createWorkers();
    workers.observe([{role,type:'arrival'}, {role,type:'result',state:'completed'}]);
    let visited = false, returning = false;
    for (let i=0;i<3600;i++) {
      const pose = workers.step(1/60)[role];
      if (pose.phase === 'pause' && pose.position.toString() === visitorPosition.toString()) visited = true;
      if (visited && pose.phase === 'pause' && pose.position[0] < visitorPosition[0]-8) {
        returning = true; break;
      }
    }
    assert.ok(returning, `${role} must actually leave the visitor before reset`);
    const home = makeWalker([...lifecycleRoute(role, 'result')].reverse());
    let progress = null, previous = workers.step(0)[role].position;
    // Locate the actual point on the first homeward segment, independently of controller state.
    progress = Math.hypot(previous[0]-visitorPosition[0], previous[1]-visitorPosition[1])/72;
    for (let i=0;i<60;i++) {
      workers.reset();
      assert.deepEqual(workers.step(0)[role].position, previous, 'reset must not teleport');
      const pose = workers.step(1/60)[role];
      progress += 1/60;
      const expected = home.position(progress);
      assert.ok(Math.hypot(...pose.position.map((v,j) => v-expected[j])) < 1e-7,
        'must continue along the homeward route, never reverse toward visitor');
      assert.ok(Math.hypot(...pose.position.map((v,j) => v-previous[j])) <= 72/60+1e-8);
      assertOutsideWalls(pose.position);
      previous = pose.position;
    }
    // New evidence AFTER the final baseline must survive the remaining homeward trip.
    if (renewed) workers.observe([{role,type:'arrival'}, {role,type:'result',state:'partial'}]);
    let delivered = false;
    const final = advanceWorkers(workers, 90, [], poses => {
      const p = poses[role];
      if (p.position.toString() === visitorPosition.toString()) {
        assert.ok(renewed, 'a reset alone must not send the worker back to the visitor');
        if (p.text === 'Partial result') delivered = true;
      }
    });
    assert.equal(delivered, renewed);
    assert.equal(final[role].phase, 'rest');
    assert.deepEqual(final[role].position, restPositions[role]);
  }
});

test('Workshop label clears full sprites at rest, work and throughout Scout and delivery routes', () => {
  let label;
  const ctx = {fillRect() {}, fillText(text,x,y) {
    if (text === 'THE WORKSHOP') label = [x,y-14,text.length*7,16];
  }};
  createScene(ctx, 'avatar').room();
  assert.ok(label);
  const positions = [...Object.values(restPositions), visitorPosition,
    ...desks.map(d => [d.x+38,d.y+8])];
  for (const route of [stacksWalker.route, ...Object.keys(restPositions).flatMap(role =>
    [lifecycleRoute(role,'arrival'), lifecycleRoute(role,'result')])]) {
    const walker = makeWalker(route);
    for (let t=0;t<=walker.travelSeconds;t+=1/60) positions.push(walker.position(t));
  }
  for (const p of positions) assert.equal(intersects(label, standingBox(p)), false, `label / full sprite ${p}`);
  for (const obstacle of [...walls, ...desks.map(d => [d.x,d.y+58,108,56])])
    assert.equal(intersects(label, obstacle), false, 'label must also clear walls and desks');
});

test('renderer paints exactly one head per worker in resting, walking and seated poses', () => {
  const workers = createWorkers();
  for (const active of [[], ['writer','scout','verifier']]) {
    const poses = advanceWorkers(workers, 10, active);
    const heads = [];
    const ctx = {fillRect(x,y,w,h) { if (this.fillStyle === '#efc3a1' && w === 18 && h === 22) heads.push([x,y]); },
      fillText() {}, save() {}, restore() {}, beginPath() {}, moveTo() {}, lineTo() {}, closePath() {}, clip() {}, drawImage() {}};
    createScene(ctx, 'avatar').render({agents:{orchestrator:{}, ...poses}});
    assert.equal(heads.length, 3);
    for (const p of Object.values(poses)) assert.ok(heads.some(([x,y]) => x === Math.round(p.position[0])+6 && y === Math.round(p.position[1])+2));
  }
});

test('aligned workstations reserve full desks, chairs and stationary bodies', () => {
  const row = desks.filter(d => d.id !== 'orchestrator');
  assert.equal(new Set(row.map(d => d.y)).size, 1);
  assert.equal(row[1].x-row[0].x, row[2].x-row[1].x);
  const seated = row.map(d => [d.x+30,d.y+4,48,72]);
  for (const [role,position] of Object.entries(restPositions))
    for (const [i,seat] of seated.entries()) if (row[i].id !== role)
      assert.equal(intersects(standingBox(position), seat), false, 'other occupied seat');
  const group = Object.values(restPositions);
  assert.ok(Math.max(...group.map(p=>p[0]))-Math.min(...group.map(p=>p[0])) <= 96, 'one tight group, not scattered workstation rests');
  for (const [x,y] of group) assert.ok(Math.hypot(x+16-180,y+36-290) <= 136, 'near common water');
});

test('status bubbles stay adjacent to their current actor, including delivery and unknown work', () => {
  for (const role of Object.keys(restPositions)) {
    const d = desks.find(d=>d.id===role);
    const poses = [{away:false,position:[d.x+38,d.y+8]},
      {away:true,phase:'rest',position:restPositions[role]},
      {away:true,phase:'pause',position:visitorPosition}];
    for (const route of [lifecycleRoute(role,'arrival'), lifecycleRoute(role,'result')]) {
      const walker=makeWalker(route);
      for(let t=0;t<=walker.travelSeconds;t+=1/30)
        poses.push({away:true,moving:true,phase:'rest',position:walker.position(t)});
    }
    for (const pose of poses) {
      const box=sceneModule.bubbleAnchor(role,pose), body=standingBox(pose.position);
      const [x,y,w,h]=box, [a,b,c,d]=body;
      const gap=Math.hypot(Math.max(a-x-w,x-a-c,0),Math.max(b-y-h,y-b-d,0));
      assert.ok(gap<=46, `${role} remote status ${box} / ${body}`);
      assert.equal(intersects(box,body),false,'do not cover own head/body');
      assert.ok(x>=20 && x+w<=620 && y>=24 && y+h<=408);
    }
  }
});

test('every combination of occupied seats and resting workers keeps full bodies separate', () => {
  const roles=Object.keys(restPositions);
  for(let mask=0;mask<8;mask++) {
    const bodies=roles.map((role,i)=>{
      const d=desks.find(d=>d.id===role);
      return mask & (1<<i) ? [d.x+30,d.y+4,48,72] : standingBox(restPositions[role]);
    });
    for(let i=0;i<3;i++) for(let j=i+1;j<3;j++)
      assert.equal(intersects(bodies[i],bodies[j]),false,`occupied/rest combination ${mask}`);
  }
});

test('shared footpaths avoid water, other feet and other desks during concurrent work', () => {
  const workers = createWorkers();
  const roles = Object.keys(restPositions);
  workers.observe(roles.flatMap(role => [{role,type:'arrival'}, {role,type:'result',state:'failed'}]));
  advanceWorkers(workers, 180, [], poses => {
    for (let i=0;i<roles.length;i++) {
      const role = roles[i], feet = feetBox(poses[role].position);
      for (let j=i+1;j<roles.length;j++)
        assert.equal(intersects(feet, feetBox(poses[roles[j]].position)), false, 'worker feet');
      for (const d of desks.filter(d => d.id !== role)) {
        assert.equal(intersects(feet, [d.x,d.y+58,108,56]), false, `${role} / ${d.id} desk`);
        assert.equal(intersects(feet, [d.x+30,d.y+32,48,44]), false, `${role} / ${d.id} chair`);
      }
      assert.equal(intersects(feet, [166,262,28,56]), false, 'water');
    }
  });
});

test('walking along the corridor does not open side doors', () => {
  const engram = doors.find(d => d.id === 'engram');
  for (let t = 0; t < stacksWalker.travelSeconds; t += 1 / 30) {
    const pose = stacksWalker.step(null, true, t);
    assert.equal(doorOpen(engram, pose), false, `open at ${pose.position}`);
  }
});

test('orchestrator walks to the review desk and back without crossing walls', () => {
  let pose = reviewWalker.step(null, false, 0);
  assert.deepEqual(pose.position, [134, 64]);
  for (let t = 0; t < reviewWalker.travelSeconds + 1; t += 1 / 60) {
    pose = reviewWalker.step(pose, true, 1 / 60);
    assertOutsideWalls(pose.position);
  }
  assert.equal(pose.phase, 'shelf');
  assert.deepEqual(pose.position, [548, 276]);
  for (let t = 0; t < reviewWalker.travelSeconds + 1; t += 1 / 60) pose = reviewWalker.step(pose, false, 1 / 60);
  assert.equal(pose.phase, 'seated');
});

test('seated tool gestures replace typing hands for every tool kind', () => {
  for (const kind of ['bash', 'read', 'grep', 'find', 'ls', 'edit', 'write', 'web']) {
    const colors = [];
    const ctx = {
      fillRect() { colors.push(this.fillStyle); }, fillText() {}, save() {}, restore() {},
      beginPath() {}, moveTo() {}, lineTo() {}, closePath() {}, clip() {}, drawImage() {},
    };
    const agents = Object.fromEntries(desks.map(d => [d.id, {working:false, hand:0, bob:0, phase:0}]));
    agents.orchestrator.tool = {kind, t:.5};
    createScene(ctx, 'avatar').render({agents});
    assert.ok(colors.includes('#efc3a1'), kind);
  }
});

test('verifier walks to The Stacks and back without crossing walls', () => {
  let pose = makeWalker(verifierStacksRoute).step(null, false, 0);
  assert.deepEqual(pose.position, [358, 302]);
  const walker = makeWalker(verifierStacksRoute);
  for (let t = 0; t < walker.travelSeconds + 1; t += 1 / 60) {
    pose = walker.step(pose, true, 1 / 60);
    assertOutsideWalls(pose.position);
  }
  assert.equal(pose.phase, 'shelf');
  assert.deepEqual(pose.position, [526, 276]);
  for (let t = 0; t < walker.travelSeconds + 1; t += 1 / 60) pose = walker.step(pose, false, 1 / 60);
  assert.equal(pose.phase, 'seated');
});

test('water visits clear obstacles, drink for two seconds and discard delivered results', () => {
  for (const role of Object.keys(restPositions)) {
    const workers = createWorkers();
    workers.observe([{role,type:'arrival'}, {role,type:'result',state:'completed'}]);
    let drinkingFrames = 0, visited = false;
    const final = advanceWorkers(workers, 70, [], poses => {
      const p = poses[role], feet = feetBox(p.position);
      assert.equal(intersects(feet, [166,262,28,56]), false, 'dispenser');
      for (const other of Object.keys(restPositions).filter(r => r !== role))
        assert.equal(intersects(feet, feetBox(poses[other].position)), false, 'resting feet');
      if (p.drinking) {
        visited = true; drinkingFrames++;
        assert.deepEqual(p.position, sceneModule.waterPosition);
        assert.equal(p.book, false); assert.equal(p.text, 'Getting water');
      }
      if (visited) { assert.equal(p.book, false); assert.notEqual(p.text, 'Result received'); }
    });
    assert.equal(drinkingFrames, 120);
    assert.equal(final[role].phase, 'rest');
    assert.equal(final[role].book, false);
  }
});

test('water approach, drinking and departure survive repeated baselines continuously', () => {
  for (const target of ['approach','drink','depart']) {
    const workers = createWorkers();
    workers.observe([{role:'writer',type:'result',state:'failed'}]);
    let found = false;
    for (let i=0;i<3600;i++) {
      const p = workers.step(1/60).writer;
      if ((target === 'approach' && p.phase === 'pause' && p.moving && !p.book)
        || (target === 'drink' && p.drinking)
        || (target === 'depart' && p.phase === 'water' && p.moving)) { found = true; break; }
    }
    assert.ok(found, target);
    for (let i=0;i<5;i++) {
      const before = workers.step(0).writer.position;
      workers.reset();
      assert.deepEqual(workers.step(0).writer.position, before);
      workers.step(1/60);
    }
    const final = advanceWorkers(workers, 60);
    assert.equal(final.writer.phase, 'rest');
    assert.equal(final.writer.book, false);
  }
});

test('clock periods use local hours and affect only windows and ceiling fixtures', () => {
  for (const [hour, period] of [[0,'night'],[6,'night'],[7,'day'],[17,'day'],[18,'evening'],[20,'evening'],[21,'night'],[23,'night']])
    assert.equal(sceneModule.officeLighting({getHours:() => hour}).period, period);
  const render = hour => {
    const pixels = new Map();
    const ctx = {fillRect(x,y,w,h) { for (let a=x;a<x+w;a++) for (let b=y;b<y+h;b++) pixels.set(`${a},${b}`, this.fillStyle); }, fillText() {}};
    const agents = Object.fromEntries(desks.map(d => [d.id, {}]));
    createScene(ctx).render({agents, lighting:sceneModule.officeLighting({getHours:() => hour})});
    return pixels;
  };
  const day = render(12), night = render(23);
  let changed = 0;
  for (const [key, color] of day) if (night.get(key) !== color) {
    changed++;
    assert.ok(Number(key.split(',')[1]) <= 34, 'no tint over faces, shirts, layout or labels');
  }
  assert.ok(changed > 0);
});

test('renderer paints a raised cup and a small monitor warning only when requested', () => {
  const calls = [];
  const ctx = {fillRect(...rect) {calls.push([...rect,this.fillStyle]);},fillText() {}};
  const renderer = createScene(ctx);
  renderer.standing(194,246,0,false,'writer',true);
  const cup = [217,264,8,10,'#f5eae2'].toString();
  assert.ok(calls.some(c => c.toString() === cup));
  calls.length = 0;
  renderer.standing(194,246,0,false,'writer',false);
  assert.equal(calls.some(c => c.toString() === cup), false);
  const agents = Object.fromEntries(desks.map(d => [d.id, {error:d.id === 'orchestrator'}]));
  const warning = [179,106,3,7,'#efc68e'].toString();
  calls.length = 0; renderer.render({agents});
  assert.ok(calls.some(c => c.toString() === warning));
  agents.orchestrator.error = false;
  calls.length = 0; renderer.render({agents});
  assert.equal(calls.some(c => c.toString() === warning), false);
});

test('arms swing opposite to the legs while walking and hang level when still', () => {
  const hands = stride => {
    const rects = [];
    const ctx = {fillRect(x,y,w,h) { rects.push([x,y,w,h,this.fillStyle]); }, fillText() {}};
    createScene(ctx).standing(100,100,stride,false,'scout',false);
    const skin = rects.filter(([,,w,h,c]) => c === '#efc3a1' && w === 6 && h === 4);
    const feet = rects.filter(([,,w,h,c]) => c === '#241923' && w === 10 && h === 4);
    assert.equal(skin.length, 2);
    assert.equal(feet.length, 2);
    return {hand:skin[0][1]-skin[1][1], foot:feet[0][1]-feet[1][1]};
  };
  assert.equal(hands(0).hand, 0);
  for (const stride of [2, -2, 1, -1]) {
    const {hand, foot} = hands(stride);
    assert.ok(hand !== 0 && Math.sign(hand) === -Math.sign(foot), `stride ${stride}`);
  }
});

test('a visitor holding at the delivery spot stands still instead of marching in place', () => {
  const event = {role:'writer', type:'result', state:'completed'};
  const travel = makeWalker(lifecycleRoute('writer', 'result')).travelSeconds;
  const moving = stepJourney(null, event, travel / 2);
  const holding = stepJourney(null, event, travel + .75);
  assert.notEqual(moving.stride, 0);
  assert.equal(holding.stride, 0);
  assert.equal(stepJourney(null, event, travel * 2 + 1.2).stride !== 0, true);
});

test('door leaves swing gradually as feet enter the gap, fully open at its centre', () => {
  const d = doors.find(x => x.id === 'workshop');
  const at = fy => sceneModule.doorSwing(d, {away:true, position:[d.x+d.w/2-16, fy-67]});
  const mid = d.y + d.h / 2;
  assert.equal(at(mid), 1);
  assert.equal(at(d.y - 20), 0);
  const edge = at(d.y - 9);
  assert.ok(edge > 0 && edge < 1, `ajar at the margin edge: ${edge}`);
  assert.ok(at(d.y - 5) > edge);
  const right = doors.find(x => x.id === 'workshop-stacks');
  assert.equal(sceneModule.doorSwing(right, {away:true, position:[right.x+right.w/2-16, right.y+right.h/2-67]}), 1);
  assert.equal(sceneModule.doorSwing(right, {away:false, position:[right.x, right.y]}), 0);
  for (const door of doors) for (let fy = door.y - 14; fy <= door.y + door.h + 14; fy++) {
    const pose = {away:true, position:[door.x + door.w/2 - 16, fy - 67]};
    if (door.swing !== 'right') assert.equal(sceneModule.doorSwing(door, pose) > 0, doorOpen(door, pose), `${door.id} at ${fy}`);
  }
});
