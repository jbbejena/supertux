const {test} = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const vm = require('node:vm');
const source = readFileSync('mk/emscripten/coop.js', 'utf8');

function target(extra = {}) {
  const listeners = new Map();
  return Object.assign({addEventListener(name, fn) {listeners.set(name, fn);},
    async fire(name, value = {}) {return listeners.get(name)?.(value);}}, extra);
}
function fixture(guest = false, fetch = async () => {throw Error('Unexpected fetch');}, clock = Date, rooms = true, extra = {}) {
  const elements = new Map(['coop_status','coop_panel','coop_create','coop_close','coop_link',
    'coop_antarctica','coop_forest','coop_restart','coop_view_link','coop_invite','coop_manual','coop_invitation',
    'coop_share_status','coop_share','coop_copy','coop_join_form','coop_join_url','coop_join_invitation','coop_join_status','coop_diagnostics',
    ...(guest ? ['guest_status','guest_join','guest_ack','guest_progress'] : [])]
    .map(id => [id, target({textContent: '',value:'',focus(){},select(){},removeAttribute(){}})]));
  const sockets = [];
  class Socket {
    static OPEN = 1; static CLOSED = 3;
    constructor() {Object.assign(this, target()); this.readyState = 1; this.bufferedAmount = 0; this.sent = []; sockets.push(this);}
    send(value) {this.sent.push(JSON.parse(value));}
    close() {this.readyState = 3;}
  }
  const document = target({hidden: false, getElementById: id => elements.get(id), querySelectorAll: () => []});
  const request = async (url, options) => url === '/coop/capabilities.json' ? {ok:rooms,json:async()=>({rooms,protocol:2})} : fetch(url, options);
  const window = target({document, TextEncoder, URL, URLSearchParams, WebSocket: Socket, AbortSignal, AbortController, fetch:request, performance, Date: clock,
    location: {href: 'http://localhost/index.html', protocol: 'http:', search: '?coop=1',
      hash: '#'+new URLSearchParams({room:'a'.repeat(32),token:'b'.repeat(64),build:'c'.repeat(64)}).toString()},
    SUPERTUX_DEPLOY_CONFIG: {manifestSha256: 'c'.repeat(64)},
    setInterval: () => 1, clearInterval: () => {}, setTimeout, clearTimeout});
  if (!guest) window.Module = {supertuxReady: true, supertuxShell: {active: true, resetInput() {}, pause(reason) {this.active = false; this.reason = reason;}}};
  Object.assign(window,extra);
  window.window = window;
  vm.runInNewContext(source, window);
  return {window, document, elements, sockets};
}

test('host queue preserves taps and fails neutral on overflow', () => {
  const f = fixture(), input = f.window.Module.supertuxCoop;
  input.enqueue([2,1,1,16]); input.enqueue([2,1,2,0]);
  assert.deepEqual(Array.from(input.poll()), [2,1,1,16]);
  assert.deepEqual(Array.from(input.poll()), [2,1,2,0]);
  for (let i=0;i<33;i++) input.enqueue([2,1,i+1,i%2]);
  assert.deepEqual(Array.from(input.poll()), [4,0,0,0]); assert.equal(input.poll(), undefined);
});

const roomResponse = async () => ({ok:true,json:async()=>({room:'a'.repeat(32),guest:'b'.repeat(64),host:'d'.repeat(64),build:'c'.repeat(64)})});
const identityResponse = async () => ({ok:true,text:async()=>'<script>window.SUPERTUX_DEPLOY_CONFIG = '+JSON.stringify({manifestSha256:'c'.repeat(64)})+';</script>'});

test('room capability controls entry; a query flag does not advertise an unsupported server', async () => {
  for (const rooms of [true,false]) {
    const f=fixture(false,roomResponse,Date,rooms);
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(f.elements.get('coop_panel').hidden,!rooms);
    assert.equal(f.elements.get('coop_create').disabled,!rooms);
    assert.equal(f.elements.get('coop_diagnostics').hidden,true);
  }
});

test('Start together waits for verified shared-view ownership and repeated taps queue one level', async () => {
  const f=fixture(false,roomResponse),engine=f.window.Module.supertuxCoop,start=f.elements.get('coop_antarctica');
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(start.disabled,true);
  await start.fire('click');assert.equal(engine.poll(),undefined);
  await f.elements.get('coop_create').fire('click');
  const socket=f.sockets[0],receive=value=>socket.fire('message',{data:JSON.stringify(value)});
  await receive({type:'ready'});assert.equal(start.disabled,true);
  assert.equal(f.elements.get('coop_invite').hidden,false);
  assert.equal(f.elements.get('coop_view_link').textContent,'Open Player 2 invitation');
  await receive({type:'peer',connected:true,view:false});engine.engineStatus(1,false,1,0);
  assert.equal(start.disabled,true,'A controller-only peer is not a shared-view guest');
  await receive({type:'peer',connected:true,view:true});engine.engineStatus(1,false,2,0);
  assert.equal(start.disabled,false);assert.equal(engine.state.guestReady,true);
  await start.fire('click');await start.fire('click');
  assert.deepEqual(Array.from(engine.poll()),[5,0,0,0]);assert.equal(engine.poll(),undefined);
  assert.equal(start.disabled,true);assert.equal(f.elements.get('coop_panel').open,false);
  await receive({type:'peer',connected:false});assert.equal(engine.state.guestReady,false);
  assert.equal(f.elements.get('coop_invite').hidden,true);
});

test('copy denial offers selected invitation; sharing cancellation does not change room ownership', async () => {
  const f=fixture(false,roomResponse);
  await f.elements.get('coop_create').fire('click');await f.sockets[0].fire('message',{data:JSON.stringify({type:'ready'})});
  await f.elements.get('coop_copy').fire('click');assert.equal(f.elements.get('coop_manual').hidden,false);
  const invitation=f.elements.get('coop_invitation').value;assert.ok(invitation.includes('coop-view.html#room='));
  let copied,shared;
  f.window.navigator={clipboard:{writeText:async text=>{copied=text;}},share:async value=>{shared=value;throw Object.assign(Error('Cancelled'),{name:'AbortError'});}};
  await f.elements.get('coop_copy').fire('click');assert.equal(copied,invitation);
  assert.match(f.elements.get('coop_share_status').textContent,/copied/);
  await f.elements.get('coop_share').fire('click');assert.equal(shared.url,invitation);
  assert.equal(f.window.Module.supertuxCoop.connection.closed,false);
  await f.elements.get('coop_close').fire('click');assert.equal(f.elements.get('coop_invitation').value,'');
});

test('Join game rejects other origins, credentials, controller links and malformed invitations', async () => {
  const f=fixture(),input=f.elements.get('coop_join_url');let navigation;
  f.window.location.assign=url=>navigation=url;
  const valid='http://localhost/coop-view.html'+f.window.location.hash;
  for (const text of [valid.replace('localhost','other.example'),valid.replace('http://','http://user:pass@'),valid.replace('coop-view','coop-controller'),valid+'0','javascript:alert(1)']) {
    input.value=text;await f.elements.get('coop_join_invitation').fire('click');assert.equal(navigation,undefined);
  }
  input.value=valid;await f.elements.get('coop_join_invitation').fire('click');assert.equal(navigation,valid);
});

test('failed guest artwork cannot connect; retry becomes ready after complete preparation', async () => {
  let attempts=0;
  const view={state:{latest:null},reset(){},async prepare(_,options){options.onProgress(2,4);if (++attempts===1) throw Error('Artwork download failed. Retry joining.');}};
  const f=fixture(true,identityResponse,Date,true,{SupertuxView:view});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(f.sockets.length,0);assert.equal(f.elements.get('guest_join').disabled,false);
  assert.match(f.elements.get('guest_status').textContent,/Retry joining/);
  await f.elements.get('guest_join').fire('click');assert.equal(f.sockets.length,1);assert.equal(attempts,2);
  await f.sockets[0].fire('message',{data:JSON.stringify({type:'ready'})});
  assert.equal(f.elements.get('guest_join').hidden,true);assert.equal(f.elements.get('guest_progress').hidden,true);
  assert.match(f.elements.get('guest_status').textContent,/Player 2 ready/);
});

test('backgrounding aborts guest preparation and a late completion owns no connection', async () => {
  let complete,signal;
  const view={state:{latest:null},reset(){},prepare(_,options){signal=options.signal;return new Promise(resolve=>complete=resolve);}};
  const f=fixture(true,identityResponse,Date,true,{SupertuxView:view});
  await new Promise(resolve=>setImmediate(resolve));
  f.document.hidden=true;await f.document.fire('visibilitychange');assert.equal(signal.aborted,true);
  complete();await new Promise(resolve=>setImmediate(resolve));
  assert.equal(f.sockets.length,0);assert.equal(f.elements.get('guest_join').disabled,false);
});

test('blur between peer notification and native poll retires controls without losing attach or detach', async () => {
  const f=fixture(),engine=f.window.Module.supertuxCoop;
  engine.enqueue([1,0,0,0]);engine.enqueue([2,1,1,2]);await f.window.fire('blur');
  assert.deepEqual(Array.from(engine.poll()),[1,0,0,0]);assert.deepEqual(Array.from(engine.poll()),[4,0,0,0]);assert.equal(engine.poll(),undefined);
  engine.enqueue([3,0,0,0]);engine.onPause();
  assert.deepEqual(Array.from(engine.poll()),[3,0,0,0]);assert.deepEqual(Array.from(engine.poll()),[4,0,0,0]);assert.equal(engine.poll(),undefined);
});

test('retired sockets ignore late callbacks and outgoing backpressure closes', async () => {
  const f = fixture(); let received = 0;
  const connection = new f.window.SupertuxCoop.Connection('room','host','token','build',{message:()=>received++});
  connection.socket.bufferedAmount = 131073;
  assert.equal(connection.send({type:'ping'}), false); assert.equal(connection.closed, true);
  await connection.socket.fire('message',{data:JSON.stringify({type:'input',mask:2})});
  assert.equal(received,0);
  const failing = new f.window.SupertuxCoop.Connection('room','host','token','build',{});
  failing.socket.send = () => {throw Error('Socket closed during send');};
  assert.equal(failing.send({type:'ping'}),false); assert.equal(failing.closed,true);
});

test('host pagehide prevents a pending create response opening a late socket', async () => {
  let complete;
  const f = fixture(false, () => new Promise(resolve => complete = resolve));
  const creating = f.elements.get('coop_create').fire('click');
  await f.window.fire('pagehide');
  complete({ok:true,json:async()=>({room:'a'.repeat(32),guest:'b'.repeat(64),host:'d'.repeat(64),build:'c'.repeat(64)})});
  await creating;
  assert.equal(f.sockets.length,0);
  assert.deepEqual(Array.from(f.window.Module.supertuxCoop.poll()),[3,0,0,0]);
  assert.deepEqual(Array.from(f.window.Module.supertuxCoop.poll()),[4,0,0,0]);
});

test('guest background prevents a pending identity fetch opening a late socket', async () => {
  let complete;
  const f = fixture(true, () => new Promise(resolve => complete = resolve));
  f.document.hidden = true; await f.document.fire('visibilitychange');
  complete({ok:true,text:async()=>'<script>window.SUPERTUX_DEPLOY_CONFIG = '+JSON.stringify({manifestSha256:'c'.repeat(64)})+';</script>'});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(f.sockets.length,0); assert.equal(f.window.supertuxGuest.state.enabled,false);
});

test('one normal large host baseline does not cancel control/status traffic; guest inputs retain their small buffer bound',()=>{
  const f=fixture();
  const host=new f.window.SupertuxCoop.Connection('room','host','token','build',{});
  host.socket.bufferedAmount=65536;assert.equal(host.send({type:'ping'}),true);
  host.socket.bufferedAmount=131073;assert.equal(host.send({type:'ping'}),false);
  const guest=new f.window.SupertuxCoop.Connection('room','guest','token','build',{});
  guest.socket.bufferedAmount=16385;assert.equal(guest.send({type:'input'}),false);
});

test('native campaign load identity survives old title/background draws; restart requires a fresh matching acknowledgment',async()=>{
  const f=fixture(false,async()=>({ok:true,json:async()=>({room:'a'.repeat(32),guest:'b'.repeat(64),host:'d'.repeat(64),build:'c'.repeat(64)})}));
  await f.elements.get('coop_create').fire('click');const socket=f.sockets[0],engine=f.window.Module.supertuxCoop;
  await socket.fire('message',{data:JSON.stringify({type:'ready'})});
  await socket.fire('message',{data:JSON.stringify({type:'peer',connected:true,view:true})});
  engine.engineStatus(1,false,1,0);assert.equal(engine.sceneReady(3,1),false);
  await socket.fire('message',{data:JSON.stringify({type:'view-ready',session:3,epoch:1,generation:1})});assert.equal(engine.sceneReady(3,1),true);
  engine.view({session:1,epoch:1,scene:'unsupported'});assert.equal(engine.sceneReady(3,1),true);
  assert.equal(engine.sceneReady(3,2),false);
  await socket.fire('message',{data:JSON.stringify({type:'view-ready',session:3,epoch:1,generation:1})});assert.equal(engine.sceneReady(3,2),false);
  await socket.fire('message',{data:JSON.stringify({type:'view-ready',session:3,epoch:2,generation:1})});assert.equal(engine.sceneReady(3,2),true);
});

test('native frame stall pauses before input consumption; recovery needs a fresh baseline and explicit Resume', async () => {
  const f=fixture(false,async()=>({ok:true,json:async()=>({room:'a'.repeat(32),guest:'b'.repeat(64),host:'d'.repeat(64),build:'c'.repeat(64)})}));
  await f.elements.get('coop_create').fire('click');
  const socket=f.sockets[0], engine=f.window.Module.supertuxCoop, shell=f.window.Module.supertuxShell;
  const receive=value=>socket.fire('message',{data:JSON.stringify(value)});
  await receive({type:'ready'}); await receive({type:'peer',connected:true,view:true}); engine.poll();
  engine.engineStatus(1,true,4,0);
  await receive({type:'input',generation:4,sequence:1,mask:2});
  engine.beforeFrame(2600);
  assert.equal(shell.active,false); assert.deepEqual(Array.from(engine.poll()),[4,0,0,0]); assert.equal(engine.poll(),undefined);
  await receive({type:'input',generation:4,sequence:2,mask:2}); assert.equal(engine.poll(),undefined);
  await receive({type:'connection',interrupted:true}); assert.equal(typeof engine.canResume(),'string');
  engine.engineStatus(1,false,5,0); await receive({type:'connection',interrupted:false});
  assert.equal(shell.active,false); assert.equal(engine.canResume(),true);
  shell.active=true; assert.equal(engine.sceneReady(3,1),false);
  await receive({type:'view-ready',session:3,epoch:1,generation:4}); assert.equal(engine.sceneReady(3,1),false);
  await receive({type:'view-ready',session:3,epoch:1,generation:5}); assert.equal(engine.sceneReady(3,1),true);
  await receive({type:'peer',connected:false}); assert.equal(shell.active,false); assert.equal(engine.state.lost,true);
  assert.equal(typeof engine.canResume(),'string'); assert.equal(f.elements.get('coop_restart').hidden,false);
  await f.elements.get('coop_create').fire('click');assert.equal(f.sockets.length,1);
  assert.equal(engine.state.lost,true);assert.equal(f.elements.get('coop_restart').hidden,false);
});

test('guest heartbeat interruption discards held keys and cannot be bypassed by delayed enabled status', async () => {
  const f=fixture(true,async()=>({ok:true,text:async()=>'<script>window.SUPERTUX_DEPLOY_CONFIG = '+JSON.stringify({manifestSha256:'c'.repeat(64)})+';</script>'}));
  await new Promise(resolve=>setImmediate(resolve));
  const socket=f.sockets[0], receive=value=>socket.fire('message',{data:JSON.stringify(value)});
  await receive({type:'ready'});await receive({type:'session',generation:2,enabled:true});
  await f.window.fire('keydown',{code:'ArrowRight',preventDefault(){},repeat:false});assert.equal(f.window.supertuxGuest.state.mask,2);
  await receive({type:'connection',interrupted:true});assert.equal(f.window.supertuxGuest.state.mask,0);
  await receive({type:'session',generation:2,enabled:true});assert.equal(f.window.supertuxGuest.state.enabled,false);
  await receive({type:'session',generation:3,enabled:false});await receive({type:'connection',interrupted:false});
  assert.equal(f.window.supertuxGuest.state.enabled,false);
  await receive({type:'session',generation:4,enabled:true});assert.equal(socket.sent.at(-1).mask,0);
});

test('a new invitation in the same guest tab neutralizes the old room and reloads its credentials', async () => {
  const f=fixture(true,async()=>({ok:true,text:async()=>'<script>window.SUPERTUX_DEPLOY_CONFIG = '+JSON.stringify({manifestSha256:'c'.repeat(64)})+';</script>'}));
  await new Promise(resolve=>setImmediate(resolve));
  const socket=f.sockets[0],receive=value=>socket.fire('message',{data:JSON.stringify(value)});
  await receive({type:'ready'});await receive({type:'session',generation:2,enabled:true});
  await f.window.fire('keydown',{code:'ArrowRight',preventDefault(){},repeat:false});
  let reloads=0;f.window.location.reload=()=>++reloads;
  f.window.location.hash='#'+new URLSearchParams({room:'d'.repeat(32),token:'e'.repeat(64),build:'c'.repeat(64)});
  await f.window.fire('hashchange');
  assert.equal(reloads,1);assert.equal(socket.readyState,3);
  assert.equal(f.window.supertuxGuest.state.mask,0);assert.equal(f.window.supertuxGuest.state.connected,false);
  assert.equal(socket.sent.filter(value=>value.type==='input').at(-1).mask,0);
  await receive({type:'session',generation:3,enabled:true});
  assert.equal(f.window.supertuxGuest.state.enabled,false);
});

test('invitation change retires an identity fetch still pending for the old room', async () => {
  let fetched,reloads=0;
  const f=fixture(true,()=>new Promise(resolve=>fetched=resolve));
  f.window.location.reload=()=>++reloads;await f.window.fire('hashchange');
  fetched({ok:true,text:async()=>'<script>window.SUPERTUX_DEPLOY_CONFIG = '+JSON.stringify({manifestSha256:'c'.repeat(64)})+';</script>'});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(reloads,1);assert.equal(f.sockets.length,0);
});

test('short native hitch retires delayed edges at the input watchdog without forcing a shared pause', async () => {
  const f=fixture(false,async()=>({ok:true,json:async()=>({room:'a'.repeat(32),guest:'b'.repeat(64),host:'d'.repeat(64),build:'c'.repeat(64)})}));
  await f.elements.get('coop_create').fire('click');const socket=f.sockets[0], engine=f.window.Module.supertuxCoop;
  const receive=value=>socket.fire('message',{data:JSON.stringify(value)});
  await receive({type:'ready'});await receive({type:'peer',connected:true});engine.poll();
  engine.engineStatus(1,true,8,0);engine.beforeFrame(900);
  assert.equal(f.window.Module.supertuxShell.active,true);
  assert.deepEqual(Array.from(engine.poll()),[4,0,0,0]);
  await receive({type:'input',generation:8,sequence:1,mask:2});assert.equal(engine.poll(),undefined);
  engine.engineStatus(1,true,9,0);
  await receive({type:'input',generation:8,sequence:2,mask:2});assert.equal(engine.poll(),undefined);
  await receive({type:'input',generation:9,sequence:1,mask:0});assert.deepEqual(Array.from(engine.poll()),[2,9,1,0]);
});

test('ordinary browser pause sends neutral status immediately and invalidates the previous scene acknowledgment', async () => {
  const f=fixture(false,async()=>({ok:true,json:async()=>({room:'a'.repeat(32),guest:'b'.repeat(64),host:'d'.repeat(64),build:'c'.repeat(64)})}));
  await f.elements.get('coop_create').fire('click');const socket=f.sockets[0], engine=f.window.Module.supertuxCoop;
  const receive=value=>socket.fire('message',{data:JSON.stringify(value)});
  await receive({type:'ready'});await receive({type:'peer',connected:true,view:true});
  engine.engineStatus(1,true,10,0);assert.equal(engine.sceneReady(3,1),false);
  await receive({type:'view-ready',session:3,epoch:1,generation:10});assert.equal(engine.sceneReady(3,1),true);
  f.window.Module.supertuxShell.active=false;engine.onPause();
  assert.equal(socket.sent.filter(v=>v.type==='session').at(-1).enabled,false);
  assert.equal(engine.sceneReady(3,1),false);
  await receive({type:'view-ready',session:3,epoch:1,generation:10});
  f.window.Module.supertuxShell.active=true;
  assert.equal(engine.sceneReady(3,1),false,'An acknowledgment in the pause/status race must not release Resume');
  assert.equal(engine.state.awaitingNativeReset,true);
  f.window.Module.supertuxShell.active=true;engine.engineStatus(1,false,11,0);
  await receive({type:'view-ready',session:3,epoch:1,generation:10});assert.equal(engine.sceneReady(3,1),false);
  await receive({type:'view-ready',session:3,epoch:1,generation:11});assert.equal(engine.sceneReady(3,1),true);
});

test('shared-view loading excludes paused time and expiry never releases physics, including the closing callback', async () => {
  let now=1000;
  const f=fixture(false,async()=>({ok:true,json:async()=>({room:'a'.repeat(32),guest:'b'.repeat(64),host:'d'.repeat(64),build:'c'.repeat(64)})}),{now:()=>now});
  await f.elements.get('coop_create').fire('click');const socket=f.sockets[0],engine=f.window.Module.supertuxCoop,shell=f.window.Module.supertuxShell;
  const receive=value=>socket.fire('message',{data:JSON.stringify(value)});
  await receive({type:'ready'});await receive({type:'peer',connected:true,view:true});engine.poll();
  engine.engineStatus(1,false,1,0);assert.equal(engine.sceneReady(3,1),false);
  shell.active=false;engine.onPause();now+=20000;
  assert.equal(engine.sceneReady(3,1),false);assert.equal(socket.readyState,1,'A deliberate pause cannot exhaust the loading deadline');
  shell.active=true;engine.engineStatus(1,false,2,0);
  assert.equal(engine.sceneReady(3,1),false);now+=14999;
  assert.equal(engine.sceneReady(3,1),false);assert.equal(socket.readyState,1);
  now+=2;
  assert.equal(engine.sceneReady(3,1),false,'Closing the connection must not release physics in the same native update');
  assert.equal(shell.active,false);assert.equal(engine.state.lost,true);assert.equal(socket.readyState,3);
  assert.equal(f.elements.get('coop_restart').hidden,false);assert.equal(typeof engine.canResume(),'string');
  assert.deepEqual(Array.from(engine.poll()),[3,0,0,0]);assert.equal(engine.poll(),undefined);
  engine.engineStatus(-1,false,3,0);
  assert.equal(engine.sceneReady(3,1),false,'A retired view remains blocked until the title restart');
});

test('permanent-loss title restart waits for the save flush before navigating', async () => {
  const f=fixture(false,async()=>({ok:true,json:async()=>({room:'a'.repeat(32),guest:'b'.repeat(64),host:'d'.repeat(64),build:'c'.repeat(64)})}));
  await f.elements.get('coop_create').fire('click');const socket=f.sockets[0],engine=f.window.Module.supertuxCoop;
  const receive=value=>socket.fire('message',{data:JSON.stringify(value)});
  await receive({type:'ready'});await receive({type:'peer',connected:true});engine.engineStatus(1,true,1,0);
  await receive({type:'peer',connected:false});
  let flushed,reloads=0,saves=0;f.window.supertux_saveFiles=()=>{++saves;return new Promise(resolve=>flushed=resolve);};
  f.window.location.reload=()=>++reloads;
  const restart=f.elements.get('coop_restart').fire('click');assert.equal(reloads,0);
  const repeated=f.elements.get('coop_restart').fire('click');assert.equal(saves,1,'Repeated taps cannot start overlapping title restarts');await repeated;
  flushed(true);await restart;assert.equal(reloads,1);
});

test('failed or unavailable saves keep the lost game open; retry can safely return to title', async () => {
  for (const save of [async()=>false,async()=>{throw Error('Storage unavailable');},undefined]) {
    const f=fixture(false,async()=>({ok:true,json:async()=>({room:'a'.repeat(32),guest:'b'.repeat(64),host:'d'.repeat(64),build:'c'.repeat(64)})}));
    await f.elements.get('coop_create').fire('click');const socket=f.sockets[0],engine=f.window.Module.supertuxCoop;
    const receive=value=>socket.fire('message',{data:JSON.stringify(value)});
    await receive({type:'ready'});await receive({type:'peer',connected:true});engine.engineStatus(1,true,1,0);
    await receive({type:'peer',connected:false});
    let reloads=0;f.window.location.reload=()=>++reloads;f.window.supertux_saveFiles=save;
    await f.elements.get('coop_restart').fire('click');
    assert.equal(reloads,0,'A failed flush must not discard unsaved progress');
    assert.equal(f.window.Module.supertuxShell.active,false);assert.equal(typeof engine.canResume(),'string');
    assert.match(f.window.Module.supertuxShell.reason,/could not be saved.*retry/i);
    assert.equal(f.elements.get('coop_restart').disabled,false);
    f.window.supertux_saveFiles=async()=>true;
    await f.elements.get('coop_restart').fire('click');assert.equal(reloads,1);
  }
});
