// Private input/presentation relay. Game simulation stays on the host.
import {validView} from './view.js';
import {newLifetime, updateLifetime, lifetimeStatus, expiryReason, WARNING_MS, INVITATION_MS} from './room-lifetime.js';
export const PROTOCOL = 3;
const TOKEN = /^[a-f0-9]{64}$/;
const BUILD = /^[a-f0-9]{64}$/;
const UINT = value => Number.isInteger(value) && value > 0 && value < 0x80000000;
// A missed heartbeat freezes input first. Keep the authenticated sockets for
// a bounded recovery window, never an unbounded backlog or automatic resume.
const STALE_MS = 2500, RECOVERY_MS = 15000;
const idleLimit = info => info.role === 'host' && !info.session?.enabled ? RECOVERY_MS : STALE_MS;
const FIELDS = {hello: ['type','protocol','build','view'], ping: ['type'], seen: ['type'], session: ['type','generation','enabled'], ack: ['type','sequence'], input: ['type','generation','sequence','mask'], 'view-ready':['type','session','epoch','generation'], result:['type','session','epoch','generation','win'], transition:['type','session','epoch','generation','scene'], view: ['type','session','epoch','sequence','generation','time','scene','camera','players','world']};
const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
});
const secret = () => Array.from(crypto.getRandomValues(new Uint8Array(32)), x => x.toString(16).padStart(2, '0')).join('');

export async function coopFetch(request, env) {
  const url = new URL(request.url);
  // Read-only discovery has no credentials or room state. Same-origin browser
  // GETs need not carry Origin; all room mutations remain origin-bound below.
  if (url.pathname === '/coop/capabilities.json' && request.method === 'GET')
    return json({rooms: !!env.COOP_ROOMS, protocol: PROTOCOL});
  if (!env.COOP_ROOMS) return new Response('Private input proof is not enabled on this server.', {status: 404});
  // Browser credentials are origin-bound. No permissive CORS or URL tokens.
  if (request.headers.get('Origin') !== url.origin) return json({error: 'Origin rejected'}, 403);
  if (url.pathname === '/coop/rooms' && request.method === 'POST') {
    if (Number(request.headers.get('Content-Length')) > 512) return json({error: 'Request too large'}, 413);
    const reader = request.body?.getReader();
    if (!reader) return json({error: 'Invalid request'}, 400);
    const chunks = []; let bytes = 0;
    while (true) {
      const {value, done} = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 512) {await reader.cancel(); return json({error: 'Request too large'}, 413);}
      chunks.push(value);
    }
    const data = new Uint8Array(bytes); let offset = 0;
    for (const chunk of chunks) {data.set(chunk, offset); offset += chunk.byteLength;}
    const body = new TextDecoder().decode(data);
    let value;
    try { value = JSON.parse(body); } catch { return json({error: 'Invalid request'}, 400); }
    if (!value || typeof value !== 'object' || Array.isArray(value) ||
        Object.keys(value).some(key => !['protocol', 'build'].includes(key)) ||
        value.protocol !== PROTOCOL || typeof value.build !== 'string' || !BUILD.test(value.build)) return json({error: 'Unsupported build/protocol'}, 400);
    const room = crypto.randomUUID().replaceAll('-', ''), host = secret(), guest = secret();
    const stub = env.COOP_ROOMS.get(env.COOP_ROOMS.idFromName(room));
    const response = await stub.fetch('https://room.internal/create', {
      method: 'POST', body: JSON.stringify({host, guest, build: value.build, origin: url.origin, ...newLifetime(Date.now())}),
    });
    if (!response.ok) return json({error: 'Room creation failed'}, 503);
    return json({room, host, guest, protocol: PROTOCOL, build: value.build, expiresIn: INVITATION_MS / 1000}, 201);
  }
  const match = /^\/coop\/rooms\/([a-f0-9]{32})\/socket$/.exec(url.pathname);
  if (match && request.method === 'GET' && request.headers.get('Upgrade')?.toLowerCase() === 'websocket')
    return env.COOP_ROOMS.get(env.COOP_ROOMS.idFromName(match[1])).fetch(request);
  return json({error: 'Not found'}, 404);
}

export class CoopRoom {
  constructor(state) { this.state = state; this.pendingViews = new Map(); }

  async fetch(request) {
    if (new URL(request.url).pathname === '/create') {
      if (await this.state.storage.get('room')) return json({error: 'Already initialized'}, 409);
      const room = await request.json();
      await this.state.storage.put('room', room);
      await this.arm(room);
      return json({created: true});
    }
    const room = await this.state.storage.get('room');
    if (!room) return json({error: 'Room expired'}, 410);
    if (Date.now() >= lifetimeStatus(room, Date.now()).expires) {
      await this.expire(room); return json({error: 'Room expired'}, 410);
    }
    if (request.headers.get('Origin') !== room.origin) return json({error: 'Origin rejected'}, 403);
    const protocols = (request.headers.get('Sec-WebSocket-Protocol') || '').split(',').map(x => x.trim());
    const credential = /^(host|guest)\.([a-f0-9]{64})$/.exec(protocols[1] || '');
    if (protocols.length !== 2 || protocols[0] !== `supertux-coop-v${PROTOCOL}` || !credential ||
        !TOKEN.test(credential[2]) || room[credential[1]] !== credential[2])
      return json({error: 'Credentials rejected'}, 403);
    const role = credential[1];
    if (this.state.getWebSockets(role).length || this.state.getWebSockets().length >= 2)
      return json({error: 'Room role already occupied'}, 409);
    const [client, server] = Object.values(new WebSocketPair());
    this.state.acceptWebSocket(server, [role]);
    server.serializeAttachment({role, hello: false, last: Date.now(), opened: Date.now(), rateStart: Date.now(), count: 0, generation: 0, sequence: 0, inFlight: 0});
    await this.arm(room);
    return new Response(null, {status: 101, webSocket: client, headers: {'Sec-WebSocket-Protocol': `supertux-coop-v${PROTOCOL}`}});
  }

  send(socket, value) {
    const info = socket.deserializeAttachment();
    if ((info.inFlight || 0) >= 32) {
      // These are latest-state notifications, never gameplay edges. Keep one
      // value per type while the receiver returns credit, not an event backlog.
      if (['connection', 'session', 'lifetime', 'ack', 'pong', 'view', 'result', 'transition'].includes(value.type)) {
        info.pending ||= {};
        if (value.type === 'view') {
          // Cloudflare limits WebSocket attachments to 2 KiB. Large complete
          // baselines stay in a single bounded in-memory slot. If hibernation
          // drops it, the next host frame supplies a fresh complete baseline.
          this.pendingViews.set(socket,value);
          info.pending.view = {session:value.session,epoch:value.epoch,sequence:value.sequence};
        } else info.pending[value.type] = value;
        socket.serializeAttachment(info);
        return true;
      }
      this.close(socket, 1013, 'Receiver fell behind'); return false;
    }
    info.inFlight = (info.inFlight || 0) + 1;
    socket.serializeAttachment(info);
    try { socket.send(JSON.stringify(value)); return true; }
    catch { try { socket.close(1011, 'Relay send failed'); } catch {} return false; }
  }
  flush_status(socket) {
    for (const type of ['connection', 'session', 'lifetime', 'ack', 'pong', 'result', 'transition', 'view']) {
      const info = socket.deserializeAttachment();
      if ((info.inFlight || 0) >= 32) break;
      const marker = info.pending?.[type];
      if (!marker) continue;
      const value = type === 'view' ? this.pendingViews.get(socket) : marker;
      if (type === 'view') this.pendingViews.delete(socket);
      delete info.pending[type];
      socket.serializeAttachment(info);
      if (value && !this.send(socket, value)) break;
    }
  }
  peer(role) { return this.state.getWebSockets(role)[0]; }
  close(socket, code, reason) { this.pendingViews.delete(socket); try { socket.close(code, reason); } catch {} }

  async syncLifetime(room) {
    if (room.lifetimePolicy !== 1) return;
    const host = this.peer('host')?.deserializeAttachment(), guest = this.peer('guest')?.deserializeAttachment();
    let changed = updateLifetime(room, !!(host?.hello && guest?.hello), host?.session?.enabled === true, Date.now());
    const status = lifetimeStatus(room, Date.now()), key = `${status.kind}/${status.expires}/${status.warning}`;
    if (room.lifetimeKey !== key) {
      room.lifetimeKey = key; ++room.lifetimeRevision; changed = true;
    }
    if (changed) await this.state.storage.put('room', room);
    for (const socket of this.state.getWebSockets()) {
      const info = socket.deserializeAttachment();
      if (!info.hello || info.lifetimeRevision === room.lifetimeRevision) continue;
      info.lifetimeRevision = room.lifetimeRevision; socket.serializeAttachment(info);
      this.send(socket, {type:'lifetime', revision:room.lifetimeRevision,
        kind:status.kind, remainingMs:status.remainingMs, warning:status.warning});
    }
  }

  async expire(room) {
    const reason = expiryReason(lifetimeStatus(room, Date.now()).kind);
    for (const socket of this.state.getWebSockets()) this.close(socket, 1008, reason);
    await this.state.storage.deleteAll();
    await this.state.storage.deleteAlarm();
  }

  async interrupt(room) {
    if (room.interruption) return;
    room.interruption = {started: Date.now(), generation: this.peer('host')?.deserializeAttachment().session?.generation || 0};
    await this.state.storage.put('room', room);
    for (const socket of this.state.getWebSockets()) {
      if (socket.deserializeAttachment().hello) this.send(socket, {type:'connection',interrupted:true});
    }
  }

  async recover(room) {
    if (!room.interruption) return;
    const host = this.peer('host')?.deserializeAttachment(), guest = this.peer('guest')?.deserializeAttachment();
    // Only a new, explicitly neutral native generation can retire old inputs.
    if (host?.hello && guest?.hello && host.session?.enabled === false &&
        host.session.generation !== room.interruption.generation &&
        Date.now() - host.last < STALE_MS && Date.now() - guest.last < STALE_MS) {
      delete room.interruption;
      await this.state.storage.put('room', room);
      for (const socket of this.state.getWebSockets()) this.send(socket, {type:'connection',interrupted:false});
    }
  }

  async webSocketMessage(socket, raw) {
    const room = await this.state.storage.get('room');
    const info = socket.deserializeAttachment();
    if (!room) { this.close(socket, 1008, 'Room expired'); return; }
    if (Date.now() >= lifetimeStatus(room, Date.now()).expires) { await this.expire(room); return; }
    if (typeof raw !== 'string' || new TextEncoder().encode(raw).length > 65536) { this.close(socket, 1009, 'Message too large'); return; }
    const now = Date.now();
    for (const peer of this.state.getWebSockets()) {
      const value = peer.deserializeAttachment();
      if ((value.hello && now - value.last >= RECOVERY_MS) || (room.interruption && now - room.interruption.started >= RECOVERY_MS)) {
        await this.webSocketClose(peer, 1001, 'Connection timed out'); return;
      }
    }
    // Alarms may race a returning socket. Apply the same barrier before any
    // delayed gameplay packet is forwarded, independently of alarm timing.
    if (this.state.getWebSockets().some(peer => {const value = peer.deserializeAttachment(); return value.hello && now - value.last >= idleLimit(value);})) await this.interrupt(room);
    if (now - info.rateStart >= 1000) { info.rateStart = now; info.count = 0; }
    let message;
    try { message = JSON.parse(raw); } catch { this.close(socket, 1008, 'Malformed message'); return; }
    if (message?.type !== 'view' && new TextEncoder().encode(raw).length > 512) {this.close(socket,1009,'Message too large'); return;}
    if (!message || typeof message !== 'object' || Array.isArray(message)) { this.close(socket, 1008, 'Malformed message'); return; }
    if (typeof message.type !== 'string' || !Object.hasOwn(FIELDS, message.type) ||
        Object.keys(message).some(key => !FIELDS[message.type].includes(key))) {
      this.close(socket, 1008, 'Unknown message fields or role change'); return;
    }
    // Receive credits acknowledge our own bounded output; charging them again
    // can disconnect a healthy client when transition messages arrive in a
    // burst. Only real outstanding credits are exempt from the command rate.
    if (!(info.hello && message.type === 'seen') && ++info.count > 60) {
      this.close(socket, 1008, 'Input rate exceeded'); return;
    }
    if (!info.hello) {
      if (message.type !== 'hello' || message.protocol !== PROTOCOL || message.build !== room.build ||
          (message.view !== undefined && (info.role !== 'guest' || typeof message.view !== 'boolean'))) {
        this.close(socket, 1008, 'Build or protocol mismatch'); return;
      }
      info.hello = true;
      info.view = message.view === true;
      this.send(socket, {type: 'ready', role: info.role, protocol: PROTOCOL});
    } else if (message.type === 'ping') {
      this.send(socket, {type: 'pong'});
    } else if (message.type === 'seen') {
      // Application-level receive credit, independent of runtime-specific
      // bufferedAmount support. Never queue more than 32 outbound messages.
      const current = socket.deserializeAttachment();
      if (!(current.inFlight > 0)) {this.close(socket, 1008, 'Unexpected receive credit'); return;}
      current.inFlight -= 1;
      socket.serializeAttachment(current);
      this.flush_status(socket);
    } else if (info.role === 'host' && message.type === 'view' && validView(message)) {
      const previous = info.viewOrder;
      // Host session IDs increase within the room. Restarts have a new epoch;
      // every update is a complete baseline, so coalescing loses no entities.
      if (message.generation === info.session?.generation && (!previous || message.session > previous.session ||
          (message.session === previous.session && (message.epoch > previous.epoch ||
          (message.epoch === previous.epoch && message.sequence > previous.sequence && message.time >= previous.time))))) {
        info.viewOrder = {session:message.session,epoch:message.epoch,generation:message.generation,sequence:message.sequence,time:message.time,scene:message.scene};
        if (info.result && (message.session > info.result.session ||
            (message.session === info.result.session && message.epoch > info.result.epoch))) delete info.result;
        const peer = this.peer('guest');
        if (peer?.deserializeAttachment().hello && peer.deserializeAttachment().view) this.send(peer,message);
      }
    } else if (info.role === 'guest' && info.view && message.type === 'view-ready' && UINT(message.session) && UINT(message.epoch) && UINT(message.generation)) {
      const host = this.peer('host'), order = host?.deserializeAttachment().viewOrder;
      if (order && order.session === message.session && order.epoch === message.epoch && order.generation === message.generation) this.send(host,message);
    } else if (info.role === 'host' && message.type === 'result' && UINT(message.session) && UINT(message.epoch) &&
               message.generation === info.session?.generation && typeof message.win === 'boolean') {
      const order = info.viewOrder, peer = this.peer('guest');
      if (order && order.session === message.session && order.epoch === message.epoch && peer?.deserializeAttachment().view) {
        info.result = {session:message.session,epoch:message.epoch,win:message.win,scene:order.scene};
        this.send(peer,message);
      }
    } else if (info.role === 'host' && message.type === 'transition' && UINT(message.session) && UINT(message.epoch) &&
               UINT(message.generation) && ['antarctica-v1','journey-v1'].includes(message.scene)) {
      const result = info.result, peer = this.peer('guest');
      if (result && result.session === message.session && result.epoch === message.epoch &&
          message.generation === info.session?.generation && peer?.deserializeAttachment().view &&
          (message.scene === result.scene || (result.win && result.scene === 'antarctica-v1' && message.scene === 'journey-v1')))
        this.send(peer,message);
    } else if (info.role === 'host' && message.type === 'session' && UINT(message.generation) && typeof message.enabled === 'boolean') {
      info.session = {type: 'session', generation: message.generation, enabled: message.enabled};
      const peer = this.peer('guest');
      if (peer?.deserializeAttachment().hello) this.send(peer, info.session);
    } else if (info.role === 'host' && message.type === 'ack' && Number.isInteger(message.sequence) && message.sequence >= 0 && message.sequence < 0x80000000) {
      const peer = this.peer('guest');
      if (peer?.deserializeAttachment().hello) this.send(peer, {type: 'ack', sequence: message.sequence});
    } else if (info.role === 'guest' && message.type === 'input' && UINT(message.generation) && UINT(message.sequence) &&
               Number.isInteger(message.mask) && message.mask >= 0 && message.mask <= 127) {
      const host = this.peer('host'), session = host?.deserializeAttachment().session;
      if (!room.interruption && host?.deserializeAttachment().hello && session?.enabled && session.generation === message.generation &&
          (info.generation !== message.generation || message.sequence > info.sequence)) {
        // A blocked host can fill its strict receive window before the next
        // heartbeat alarm. Freeze and retire input rather than destroy the
        // authenticated room; no extra edge or backlog is stored.
        if ((host.deserializeAttachment().inFlight || 0) >= 32) await this.interrupt(room);
        else {
          info.generation = message.generation; info.sequence = message.sequence;
          this.send(host, {type: 'input', generation: message.generation, sequence: message.sequence, mask: message.mask});
        }
      }
    } else { this.close(socket, 1008, 'Message not allowed for role'); return; }
    info.last = now;
    info.inFlight = socket.deserializeAttachment().inFlight;
    info.pending = socket.deserializeAttachment().pending;
    socket.serializeAttachment(info);
    await this.recover(room);
    if (message.type === 'hello') {
      const other = this.peer(info.role === 'host' ? 'guest' : 'host');
      if (other?.deserializeAttachment().hello) {
        const guestView = this.peer('guest')?.deserializeAttachment().view;
        this.send(socket, {type: 'peer', connected: true, ...(guestView ? {view:true} : {})});
        this.send(other, {type: 'peer', connected: true, ...(guestView ? {view:true} : {})});
        const session = this.peer('host')?.deserializeAttachment().session;
        if (session) this.send(this.peer('guest'), session);
      }
    }
    await this.syncLifetime(room);
    await this.arm(room);
  }

  async webSocketClose(socket, code, reason) {
    const role = socket.deserializeAttachment().role;
    this.close(socket, code === 1005 ? 1000 : code, reason);
    if (role === 'guest') {
      const host = this.peer('host');
      if (host) this.send(host, {type: 'peer', connected: false});
      const room = await this.state.storage.get('room');
      if (room) {await this.syncLifetime(room); await this.arm(room);}
    } else {
      for (const peer of this.state.getWebSockets()) this.close(peer, 1012, 'Host left; create a new room');
      await this.state.storage.deleteAll();
      await this.state.storage.deleteAlarm();
    }
  }
  async webSocketError(socket) { await this.webSocketClose(socket, 1011, 'Connection error'); }

  async arm(room) {
    const now = Date.now(), status = lifetimeStatus(room, now);
    let next = status.expires;
    if (room.lifetimePolicy === 1 && !status.warning) next = Math.min(next, status.expires - WARNING_MS);
    for (const socket of this.state.getWebSockets()) {
      const info = socket.deserializeAttachment();
      next = Math.min(next, info.hello ? info.last + (room.interruption ? RECOVERY_MS : idleLimit(info)) : info.opened + 5000);
    }
    if (room.interruption) next = Math.min(next, room.interruption.started + RECOVERY_MS);
    await this.state.storage.setAlarm(Math.max(Date.now() + 100, next));
  }
  async alarm() {
    const room = await this.state.storage.get('room');
    if (!room) return;
    if (Date.now() >= lifetimeStatus(room, Date.now()).expires) { await this.expire(room); return; }
    await this.syncLifetime(room);
    for (const socket of this.state.getWebSockets()) {
      const info = socket.deserializeAttachment();
      if ((!info.hello && Date.now() - info.opened >= 5000) || (info.hello && Date.now() - info.last >= RECOVERY_MS) ||
          (room.interruption && Date.now() - room.interruption.started >= RECOVERY_MS)) {
        await this.webSocketClose(socket, 1001, 'Connection timed out');
      } else if (info.hello && Date.now() - info.last >= idleLimit(info)) await this.interrupt(room);
    }
    if (await this.state.storage.get('room')) await this.arm(room);
  }
}
