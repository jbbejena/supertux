import assert from 'node:assert/strict';
import {test} from 'node:test';
import {CoopRoom, coopFetch, PROTOCOL} from '../../worker/coop.js';
import {newLifetime, lifetimeStatus, INVITATION_MS, SESSION_MS, IDLE_MS, WARNING_MS} from '../../worker/room-lifetime.js';

const build = 'b'.repeat(64), origin = 'http://localhost:8787';
async function fixture(t) {
  let now = 1000000;
  t.mock.method(Date, 'now', () => now);
  const sockets = [];
  const storage = {room:null, alarm:0,
    async get() {return structuredClone(this.room);},
    async put(_, value) {this.room = structuredClone(value);},
    async setAlarm(value) {this.alarm = value;},
    async deleteAll() {this.room = null;}, async deleteAlarm() {this.alarm = 0;}};
  const state = {storage, getWebSockets(role) {return sockets.filter(s => !s.closed && (!role || s.info.role === role));}};
  const object = new CoopRoom(state);
  await object.fetch(new Request('https://room.internal/create', {method:'POST',
    body:JSON.stringify({host:'a'.repeat(64),guest:'c'.repeat(64),build,origin,...newLifetime(now)})}));
  const add = role => {
    const socket = {info:{role,hello:false,last:now,opened:now,rateStart:now,count:0,generation:0,sequence:0,inFlight:0},messages:[],
      deserializeAttachment() {return structuredClone(this.info);},
      serializeAttachment(info) {assert.ok(JSON.stringify(info).length <= 2048);this.info = structuredClone(info);},
      send(raw) {this.messages.push(JSON.parse(raw));}, close(code,reason) {this.closed ||= {code,reason};}};
    sockets.push(socket);return socket;
  };
  const send = (socket, message) => object.webSocketMessage(socket, JSON.stringify(message));
  const drain = async () => {
    for (const socket of state.getWebSockets()) {
      while (socket.info.inFlight > 0) await send(socket,{type:'seen'});
    }
  };
  const ready = async role => {
    const socket = add(role);await send(socket,{type:'hello',protocol:PROTOCOL,build});await drain();return socket;
  };
  const advance = ms => {
    now += ms;
    // Represent continuous successful heartbeats during a large fake-clock
    // jump; separate transport tests exercise missing/stale heartbeats.
    for (const socket of state.getWebSockets()) {socket.info.last = now;socket.info.rateStart = now;socket.info.count = 0;}
  };
  return {object,state,storage,add,send,drain,ready,advance,now:()=>now};
}

test('room creation persists the invitation deadline and schedules its warning',async t=>{
  const f=await fixture(t);
  assert.equal(f.storage.room.expires,f.now()+INVITATION_MS);
  assert.equal(f.storage.alarm,f.now()+INVITATION_MS-WARNING_MS);
  let created;
  const env={COOP_ROOMS:{idFromName:value=>value,get:()=>({async fetch(url,options){created=JSON.parse(options.body);return new Response('{}');}})}};
  const response=await coopFetch(new Request(origin+'/coop/rooms',{method:'POST',headers:{Origin:origin},body:JSON.stringify({protocol:PROTOCOL,build})}),env);
  assert.equal(response.status,201);
  assert.equal((await response.json()).expiresIn,900);
  assert.equal(created.lifetimePolicy,1);assert.equal(created.startedAt,null);
  assert.equal(created.expires,f.now()+INVITATION_MS);
});

test('unclaimed invitations warn once and expire despite ongoing heartbeat traffic',async t=>{
  const f=await fixture(t),host=await f.ready('host'),deadline=f.storage.room.expires;
  f.advance(INVITATION_MS-WARNING_MS);
  await f.object.alarm();await f.drain();
  const warning=host.messages.filter(m=>m.type==='lifetime'&&m.warning);
  assert.equal(warning.length,1);assert.equal(warning[0].kind,'invitation');
  for(let i=0;i<5;i++){f.advance(500);await f.send(host,{type:'ping'});await f.drain();}
  assert.equal(host.messages.filter(m=>m.type==='lifetime'&&m.warning).length,1);
  assert.equal(f.storage.room.expires,deadline);
  f.advance(deadline-f.now());
  await f.object.alarm();
  assert.deepEqual(host.closed,{code:1008,reason:'Room invitation expired'});
  assert.equal(f.storage.room,null);assert.equal(f.storage.alarm,0);
});

test('pairing grants a fixed hour, with active play surviving the old invitation cap',async t=>{
  const f=await fixture(t),host=await f.ready('host'),invitationEnd=f.storage.room.expires;
  f.advance(5*60000);const guest=await f.ready('guest');
  const sessionEnd=f.now()+SESSION_MS;
  assert.equal(f.storage.room.sessionExpires,sessionEnd);
  await f.send(host,{type:'session',generation:1,enabled:true});await f.drain();
  assert.equal(f.storage.room.idleExpires,null);
  f.advance(invitationEnd-f.now()+1);
  await f.send(guest,{type:'input',generation:1,sequence:1,mask:2});await f.drain();
  assert.ok(host.messages.some(m=>m.type==='input'&&m.mask===2));
  assert.equal(host.closed,undefined);assert.equal(guest.closed,undefined);
  const admission=new Request(origin+'/coop/rooms/'+'1'.repeat(32)+'/socket',{
    headers:{Origin:origin,'Sec-WebSocket-Protocol':`supertux-coop-v${PROTOCOL}, host.${'a'.repeat(64)}`}});
  assert.equal((await f.object.fetch(admission)).status,409); // occupied, still live
  for(let i=2;i<6;i++){await f.send(host,{type:'session',generation:i,enabled:true});await f.drain();}
  assert.equal(f.storage.room.sessionExpires,sessionEnd);
});

test('waiting and paused rooms have a ten-minute idle cap that neutral generations and pings cannot reset',async t=>{
  const f=await fixture(t),host=await f.ready('host');await f.ready('guest');
  assert.equal(f.storage.room.idleExpires,f.now()+IDLE_MS);
  await f.send(host,{type:'session',generation:1,enabled:true});await f.drain();
  f.advance(60000);await f.send(host,{type:'session',generation:2,enabled:false});await f.drain();
  const deadline=f.storage.room.idleExpires,sessionEnd=f.storage.room.sessionExpires;
  f.advance(IDLE_MS-WARNING_MS);
  for(let i=3;i<8;i++){await f.send(host,{type:'session',generation:i,enabled:false});await f.drain();}
  assert.equal(f.storage.room.idleExpires,deadline);
  assert.equal(host.messages.at(-1).type,'lifetime');
  assert.ok(host.messages.some(m=>m.type==='lifetime'&&m.kind==='idle'&&m.warning));
  await f.send(host,{type:'session',generation:8,enabled:true});await f.drain();
  assert.equal(f.storage.room.idleExpires,null);assert.equal(f.storage.room.sessionExpires,sessionEnd);
  assert.ok(host.messages.some(m=>m.type==='lifetime'&&m.kind==='session'&&!m.warning));
});

test('the absolute session cap wins over pause/resume and expires before delayed input or admission',async t=>{
  for(const entry of ['message','alarm','admission']) {
    const f=await fixture(t),host=await f.ready('host'),guest=await f.ready('guest');
    await f.send(host,{type:'session',generation:1,enabled:true});await f.drain();
    const end=f.storage.room.sessionExpires;
    f.advance(SESSION_MS-WARNING_MS);
    await f.object.alarm();await f.drain();
    assert.ok(guest.messages.some(m=>m.type==='lifetime'&&m.kind==='session'&&m.warning));
    await f.send(host,{type:'session',generation:2,enabled:false});await f.drain();
    assert.equal(lifetimeStatus(f.storage.room,f.now()).expires,end);
    await f.send(host,{type:'session',generation:3,enabled:true});await f.drain();
    f.advance(end-f.now());const inputs=host.messages.filter(m=>m.type==='input').length;
    if(entry==='message')await f.send(guest,{type:'input',generation:3,sequence:1,mask:2});
    if(entry==='alarm')await f.object.alarm();
    if(entry==='admission')assert.equal((await f.object.fetch(new Request(origin+'/socket'))).status,410);
    assert.equal(host.messages.filter(m=>m.type==='input').length,inputs);
    assert.equal(host.closed.reason,'Room session limit reached');assert.equal(guest.closed.reason,'Room session limit reached');
    assert.equal(f.storage.room,null);assert.equal(f.storage.alarm,0);
  }
});

test('idle deadlines and coalesced warnings survive Durable Object reconstruction',async t=>{
  const f=await fixture(t),host=await f.ready('host'),guest=await f.ready('guest');
  const deadline=f.storage.room.idleExpires;
  guest.info.inFlight=32;
  f.advance(IDLE_MS-WARNING_MS);
  await f.object.alarm();
  assert.equal(guest.info.pending.lifetime.kind,'idle');assert.equal(guest.info.pending.lifetime.warning,true);
  const resumed=new CoopRoom(f.state);
  await resumed.webSocketMessage(guest,JSON.stringify({type:'seen'}));
  assert.ok(guest.messages.some(m=>m.type==='lifetime'&&m.kind==='idle'&&m.warning));
  assert.equal(f.storage.room.idleExpires,deadline);
  f.advance(WARNING_MS);await resumed.alarm();
  assert.equal(host.closed.reason,'Room idle limit reached');assert.equal(guest.closed.reason,'Room idle limit reached');
  assert.equal(f.storage.room,null);
});

test('pre-update rooms retain their old finite deadline and cannot opt into a longer lease',async t=>{
  const f=await fixture(t);delete f.storage.room.lifetimePolicy;
  const host=await f.ready('host'),guest=await f.ready('guest');
  await f.send(host,{type:'session',generation:1,enabled:true});await f.drain();
  assert.equal(host.messages.some(m=>m.type==='lifetime'),false);
  f.advance(INVITATION_MS);await f.object.alarm();
  assert.equal(host.closed.reason,'Room expired');assert.equal(guest.closed.reason,'Room expired');
});

test('a client cannot send or change an authoritative deadline',async t=>{
  const f=await fixture(t),host=await f.ready('host'),guest=await f.ready('guest');
  const deadline=f.storage.room.sessionExpires;
  await f.send(guest,{type:'lifetime',revision:99,kind:'session',remainingMs:SESSION_MS,warning:false});
  assert.equal(guest.closed.code,1008);assert.equal(f.storage.room.sessionExpires,deadline);
  assert.equal(host.closed,undefined);
});

test('incomplete persisted deadlines fail closed rather than creating an unlimited room',async t=>{
  const f=await fixture(t),host=await f.ready('host');await f.ready('guest');
  delete f.storage.room.sessionExpires;f.storage.room.idleExpires=null;
  await f.object.alarm();assert.equal(host.closed.reason,'Room session limit reached');assert.equal(f.storage.room,null);
});
