/* Private host-authoritative input and opt-in presentation transport. */
(function () {
  'use strict';
  const protocol = 2, limit = 32, buttons = {ArrowLeft: 1, KeyA: 1, ArrowRight: 2, KeyD: 2,
    ArrowUp: 4, KeyW: 4, ArrowDown: 8, KeyS: 8, Space: 16, KeyJ: 16, ControlLeft: 32, KeyK: 32, ShiftLeft: 64};

  class Connection {
    constructor(room, role, token, build, events) {
      this.maxBuffered = role === 'host' ? 131072 : 16384;
      this.events = events; this.ready = false; this.last = Date.now(); this.closed = false;
      const url = new URL(`/coop/rooms/${room}/socket`, location.href);
      url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
      this.socket = new WebSocket(url, ['supertux-coop-v2', `${role}.${token}`]);
      this.socket.addEventListener('open', () => {if (!this.closed) this.send({type: 'hello', protocol, build, ...(events.view ? {view:true} : {})});});
      this.socket.addEventListener('message', event => {
        if (this.closed) return; // buffered events from a retired room own no input
        if (typeof event.data !== 'string' || new TextEncoder().encode(event.data).length > 65536) { this.close('Invalid relay message'); return; }
        let value;
        try { value = JSON.parse(event.data); } catch { this.close('Invalid relay message'); return; }
        if (!value || typeof value !== 'object' || Array.isArray(value)) {this.close('Invalid relay message'); return;}
        this.last = Date.now();
        this.send({type: 'seen'});
        if (value.type === 'ready') { this.ready = true; events.ready?.(); }
        events.message?.(value);
      });
      this.socket.addEventListener('close', event => this.finish(event.reason || 'Connection closed. Rejoin before starting a level.'));
      this.socket.addEventListener('error', () => this.finish('Connection rejected or unavailable. Check the room link and build.'));
      this.timer = setInterval(() => {
        if (Date.now() - this.last > 15000) this.close('Relay timed out. Return to the title screen and create a new room.');
        else if (this.ready) { this.send({type: 'ping'}); events.refresh?.(); }
      }, role === 'guest' ? 125 : 500);
    }
    send(message) {
      if (this.closed || this.socket.readyState !== WebSocket.OPEN) return false;
      if (this.socket.bufferedAmount > this.maxBuffered) { this.close('Connection is too slow. Rejoin before starting a level.'); return false; }
      try { this.socket.send(JSON.stringify(message)); return true; }
      catch { this.close('Connection lost. Rejoin before starting a level.'); return false; }
    }
    finish(reason) {
      if (this.closed) return;
      this.closed = true; this.ready = false; clearInterval(this.timer); this.events.closed?.(reason);
      try { this.socket.close(1000, 'Input proof stopped'); } catch {}
    }
    close(reason = 'Room closed') { this.finish(reason); }
  }

  function host(module) {
    const queue = [], status = document.getElementById('coop_status');
    let relayInterrupted = false, lost = false, recoveryPaused = false, retiredGeneration = null, lastStall = 0, lastFrame = performance.now();
    let sceneDeadline = 0, sceneKey = null, sceneLoaded = null, connection, creating = false, createEpoch = 0, joinRejected = false, guestView = false, lastView = 0, state = {reserved: 0, enabled: false, generation: 0, sequence: 0}, lastSent = '';
    const say = text => { if (status) status.textContent = text; };
    const interrupt = (reason, permanent = false) => {
      if (state.reserved !== 1) return;
      lost ||= permanent;
      recoveryPaused = true;
      queue.length = 0;
      sceneLoaded = null;
      sceneDeadline = 0;
      module.supertuxShell?.pause(reason);
      enqueue([4, 0, 0, 0]);
      const restart = document.getElementById('coop_restart');
      if (restart) restart.hidden = !lost;
      say(reason);
    };
    const retireInput = () => {
      if (retiredGeneration !== null) return;
      retiredGeneration = state.generation;
      module.supertuxShell?.resetInput();
      enqueue([4, 0, 0, 0]);
    };
    const enqueue = value => {
      if (value[0] !== 2) queue.length = 0;
      if (queue.length >= limit) { queue.length = 0; queue.push([4, 0, 0, 0]); say('Input backlog cleared. Release controls and try again.'); return; }
      queue.push(value);
    };
    const session = () => {
      if (!connection?.ready || !state.generation) return;
      connection.send({type: 'session', generation: state.generation, enabled: state.enabled && !!module.supertuxShell?.active});
      connection.send({type: 'ack', sequence: state.sequence});
    };
    module.supertuxCoop = {
      enqueue, poll: () => queue.shift(),
      onPause() {
        sceneLoaded = null; sceneDeadline = 0;
        enqueue([4, 0, 0, 0]);
        session();
      },
      beforeFrame(gap) {
        lastFrame = performance.now();
        if (state.enabled && module.supertuxShell?.active) {
          if (gap >= 2500) {lastStall = gap; interrupt('The host stopped updating. Controls were released. Press Resume when both players are ready.');}
          else if (gap >= 750) retireInput();
        }
      },
      canResume() {
        if (lost) return 'Player 2 disconnected. Return to the title screen and create a new room.';
        if (relayInterrupted || (state.reserved === 1 && (!connection?.ready || Date.now() - connection.last >= 2500))) return 'Waiting for the connection to recover. Controls are released.';
        return true;
      },
      engineStatus(reserved, enabled, generation, sequence) {
        state = {reserved, enabled: !!enabled, generation, sequence};
        if (generation !== retiredGeneration) retiredGeneration = null;
        if (enabled && module.supertuxShell?.active) recoveryPaused = false;
        const key = `${reserved}/${enabled}/${generation}`;
        if (key !== lastSent) { lastSent = key; session(); }
        if (reserved === 1) joinRejected = false;
        if (reserved === -2) joinRejected = true;
        if (connection?.ready && reserved === 1 && !relayInterrupted && !lost && !recoveryPaused) say(enabled ? 'Player 2 input active. Host owns the game and saves.' : 'Player 2 joined. Input waits while the host is in menus or paused.');
        if (connection?.ready && reserved === -1 && !joinRejected) say('Player 2 disconnected. Return to the title screen, rejoin, then start a level.');
        if (connection?.ready && joinRejected) say('Join requires one local player at the title screen. Return there and rejoin before starting a level; reload if local Player 2 was already configured.');
      },
      get state() { return {...state, queued: queue.length, joinRejected, relayInterrupted, lost, recoveryPaused, lastStall}; },
      get connection() { return connection; },
      wantsView() {return !!(connection?.ready && guestView && state.reserved === 1 && state.generation && Date.now() - lastView >= 100);},
      sceneReady(session, epoch) {
        if (!guestView || state.reserved !== 1) return true;
        if (!module.supertuxShell?.active) {sceneDeadline=0;return false;}
        const next=`${session}/${epoch}`;
        // Only the campaign engine's loading query owns this identity. A
        // fading title/world-map background can also draw an unsupported view.
        if (sceneKey!==next) {sceneKey=next;sceneLoaded=null;sceneDeadline=0;}
        if (sceneLoaded===next) return true;
        if (!sceneDeadline) sceneDeadline=Date.now()+15000;
        if (Date.now()>sceneDeadline) {connection?.close('Shared view loading stalled. Return to the title screen and create a new room.');return true;}
        return false;
      },
      view(snapshot) {
        lastView = Date.now();
        if (!connection?.ready || !guestView) return;
        connection.send({...snapshot,generation:state.generation});
      },
      finished(session, epoch, win) {if (connection?.ready && guestView) connection.send({type:'result',session,epoch,generation:state.generation,win:!!win});},
    };
    const panel = document.getElementById('coop_panel');
    if (panel) panel.hidden = !new URLSearchParams(location.search).has('coop');
    document.getElementById('coop_create')?.addEventListener('click', async () => {
      if (creating || !module.supertuxReady) return;
      if (lost || state.reserved === 1) {say('Close the current room and return to the title screen before creating a new invitation.');return;}
      const epoch = ++createEpoch;
      creating = true; sceneDeadline=0;sceneKey = sceneLoaded = null; joinRejected = false; connection?.close(); relayInterrupted = lost = recoveryPaused = false; retiredGeneration = null; enqueue([3, 0, 0, 0]);
      const restart = document.getElementById('coop_restart');
      if (restart) restart.hidden = true;
      try {
        const build = window.SUPERTUX_DEPLOY_CONFIG?.manifestSha256;
        const response = await fetch('/coop/rooms', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({protocol, build}), signal: AbortSignal.timeout(10000)});
        if (!response.ok) throw Error('Private input rooms are unavailable here. Start the local proof server.');
        const room = await response.json();
        if (epoch !== createEpoch || document.hidden) return;
        const join = new URL('coop-controller.html', location.href);
        join.hash = new URLSearchParams({room: room.room, token: room.guest, build: room.build});
        const link = document.getElementById('coop_link'); link.href = join.href; link.textContent = join.href;
        const viewLink = document.getElementById('coop_view_link');
        if (viewLink) {join.pathname = new URL('coop-view.html', location.href).pathname; viewLink.href = join.href; viewLink.textContent = join.href;}
        connection = new Connection(room.room, 'host', room.host, build, {
          ready: () => { say('Room ready. Invite Player 2 before starting a level.'); session(); },
          message: value => {
            if (value.type === 'connection' && value.interrupted === true) {relayInterrupted = true; interrupt('Connection interrupted. Controls are released. Wait for recovery, then press Resume.');}
            if (value.type === 'connection' && value.interrupted === false) {relayInterrupted = false; say('Connection recovered. Release controls, then press Resume on the host.');}
            if (value.type === 'peer') {
              if (!value.connected) interrupt('Player 2 disconnected. Return to the title screen and create a new room.', true);
              guestView = !!(value.connected && value.view); joinRejected = false; enqueue([value.connected ? 1 : 3, 0, 0, 0]);
            }
            if (value.type === 'view-ready' && value.generation === state.generation && `${value.session}/${value.epoch}` === sceneKey) sceneLoaded = sceneKey;
            if (value.type === 'input') {
              const gap = performance.now() - lastFrame;
              if (state.enabled && module.supertuxShell?.active) {
                if (gap >= 2500) {lastStall = gap; interrupt('The host stopped updating. Controls were released. Press Resume when both players are ready.');}
                else if (gap >= 750) retireInput();
              }
              if (retiredGeneration === null && !relayInterrupted && !lost && module.supertuxShell?.active && state.enabled && value.generation === state.generation) enqueue([2, value.generation, value.sequence, value.mask]);
            }
          },
          refresh: session,
          closed: reason => { interrupt('Connection lost. Return to the title screen and create a new room.', true); guestView = false; enqueue([3, 0, 0, 0]); say(reason); },
        });
      } catch (error) { if (epoch === createEpoch) say(error.message); }
      finally { creating = false; }
    });
    document.getElementById('coop_close')?.addEventListener('click', () => {++createEpoch; connection?.close();});
    document.getElementById('coop_restart')?.addEventListener('click', async () => {
      if (!lost) return;
      await window.supertux_saveFiles?.();
      location.reload();
    });
    document.getElementById('coop_antarctica')?.addEventListener('click', () => {
      if (guestView && state.reserved !== 1) say('Invite Player 2 before starting.');
      else enqueue([5, 0, 0, 0]);
    });
    document.getElementById('coop_forest')?.addEventListener('click', () => enqueue([5, 1, 0, 0]));
    document.getElementById('coop_view_start')?.addEventListener('click', () => {
      if (guestView && state.reserved === 1) enqueue([5, 2, 0, 0]);
      else say('Invite a guest with the shared view link before starting this scene.');
    });
    // The trusted Start/Resume shell already pauses the engine. Clear the JS
    // backlog too, so an old browser event cannot reassert held movement.
    for (const event of ['blur', 'pagehide']) window.addEventListener(event, () => {++createEpoch; enqueue([4, 0, 0, 0]);});
    document.addEventListener('visibilitychange', () => { if (document.hidden) {++createEpoch; enqueue([4, 0, 0, 0]);} });
  }

  function guest() {
    const params = new URLSearchParams(location.hash.slice(1)), keys = new Map(), fingers = new Map();
    const status = document.getElementById('guest_status');
    const view = window.SupertuxView;
    let connection, generation = 0, sequence = 0, enabled = false, joining = false, joinEpoch = 0, relayInterrupted = false;
    const mask = () => [...keys.values(), ...fingers.values()].reduce((a, b) => a | b, 0);
    const send = () => {
      if (enabled && connection?.ready) connection.send({type: 'input', generation, sequence: ++sequence, mask: view && !view.playable ? 0 : mask()});
    };
    const clear = () => { keys.clear(); fingers.clear(); send(); };
    if (view) {view.onFreeze = clear; view.onReady = frame => connection?.send({type:'view-ready',session:frame.session,epoch:frame.epoch,generation:frame.generation});}
    const join = async () => {
      if (joining) return;
      const epoch = ++joinEpoch;
      connection?.close(); enabled = relayInterrupted = false; clear(); generation = sequence = 0;
      view?.reset();
      joining = true;
      if (connection && connection.socket.readyState !== WebSocket.CLOSED) {
        await new Promise(resolve => {
          const timer = setTimeout(resolve, 1000);
          connection.socket.addEventListener('close', () => {clearTimeout(timer); resolve();}, {once:true});
        });
      }
      if (!/^[a-f0-9]{32}$/.test(params.get('room') || '') || !/^[a-f0-9]{64}$/.test(params.get('token') || '') || !/^[a-f0-9]{64}$/.test(params.get('build') || '')) {
        joining = false; status.textContent = 'Use the private controller link shared by the host.'; return;
      }
      status.textContent = 'Joining diagnostic controller…';
      try {
        const html = await (await fetch('index.html', {cache: 'no-store', signal: AbortSignal.timeout(10000)})).text();
        const config = /window\.SUPERTUX_DEPLOY_CONFIG = (.*?);<\/script>/.exec(html);
        if (!config || JSON.parse(config[1]).manifestSha256 !== params.get('build')) throw Error('The host and controller builds differ. Ask the host for a new room link.');
        if (view) await view.prepare(JSON.parse(config[1]));
      } catch (error) { joining = false; status.textContent = error.message; return; }
      if (epoch !== joinEpoch || document.hidden) {joining = false; return;}
      connection = new Connection(params.get('room'), 'guest', params.get('token'), params.get('build'), {
        view: !!view,
        ready: () => { joining = false; status.textContent = 'Joined. Wait for the host to start a level.'; },
        message: value => {
          if (value.type === 'connection' && value.interrupted === true) {relayInterrupted = true; enabled = false; clear(); view?.setEnabled(false,generation); status.textContent = 'Connection interrupted. Controls are released. Wait for the host to resume.';}
          if (value.type === 'connection' && value.interrupted === false) {relayInterrupted = false; status.textContent = 'Connection recovered. Waiting for the host to press Resume.';}
          if (value.type === 'session' && Number.isInteger(value.generation) && typeof value.enabled === 'boolean') {
            if (generation !== value.generation || enabled !== value.enabled) {
              enabled = false; keys.clear(); fingers.clear(); generation = value.generation; sequence = 0;
              enabled = value.enabled && !relayInterrupted; send(); // fresh neutral state, never held-key replay
            }
            view?.setEnabled(enabled,generation);
            status.textContent = enabled ? (view ? 'Player 2 input active. You control Player 2 in the shared view.' : 'Player 2 input active. The game is visible on the host only.') : 'Host is paused or in menus. Release controls before continuing.';
          }
          if (value.type === 'view' && view) view.accept(value);
          if (value.type === 'result' && view) view.result(value);
          if (value.type === 'ack') document.getElementById('guest_ack').textContent = `Host accepted input ${value.sequence}.`;
        },
        refresh: send,
        closed: reason => { joining = false; enabled = false; clear(); view?.reset(); status.textContent = reason; },
      });
    };
    window.addEventListener('keydown', event => {
      if (buttons[event.code]) { event.preventDefault(); if (enabled && (!view || view.playable) && !event.repeat) { keys.set(event.code, buttons[event.code]); send(); } }
    });
    window.addEventListener('keyup', event => { if (buttons[event.code]) { event.preventDefault(); keys.delete(event.code); send(); } });
    for (const button of document.querySelectorAll('[data-control]')) {
      button.addEventListener('pointerdown', event => {
        event.preventDefault(); if (!enabled || (view && !view.playable)) return;
        button.setPointerCapture(event.pointerId); fingers.set(event.pointerId, Number(button.dataset.control)); send();
      });
      for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) button.addEventListener(type, event => { fingers.delete(event.pointerId); send(); });
      button.addEventListener('contextmenu', event => event.preventDefault());
    }
    window.addEventListener('blur', clear);
    window.addEventListener('pagehide', () => { ++joinEpoch; clear(); connection?.close('Controller left. Rejoin from the host title screen.'); });
    document.addEventListener('visibilitychange', () => { if (document.hidden) { ++joinEpoch; clear(); connection?.close('Controller backgrounded. Rejoin from the host title screen.'); } });
    document.getElementById('guest_join').addEventListener('click', join);
    // Diagnostic state is input/connection only. It contains no world data.
    window.supertuxGuest = {get state() {return {enabled, generation, sequence, mask: mask(), connected: !!connection?.ready};}, get connection() {return connection;}};
    join();
  }
  window.SupertuxCoop = {Connection, host, guest};
  if (window.Module) host(window.Module);
  else if (document.getElementById('guest_status')) guest();
})();
