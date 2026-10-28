/* Private host-authoritative input and opt-in presentation transport. */
(function () {
  'use strict';
  const protocol = 3, limit = 32, buttons = {ArrowLeft: 1, KeyA: 1, ArrowRight: 2, KeyD: 2,
    ArrowUp: 4, KeyW: 4, ArrowDown: 8, KeyS: 8, Space: 16, KeyJ: 16, ControlLeft: 32, KeyK: 32, ShiftLeft: 64};
  const validInvitation = params => /^[a-f0-9]{32}$/.test(params.get('room') || '') &&
    ['token','build'].every(key => /^[a-f0-9]{64}$/.test(params.get(key) || '')) &&
    [...params.keys()].length === 3;
  function invitationURL(text) {
    if (typeof text !== 'string' || text.length > 2048) throw Error('Paste the private invitation shared by the host.');
    const url = new URL(text.trim()), expected = new URL('coop-view.html', location.href);
    if (url.origin !== expected.origin || url.pathname !== expected.pathname || url.search || url.username || url.password ||
        !validInvitation(new URLSearchParams(url.hash.slice(1))))
      throw Error('Use a Player 2 invitation from this private co-op site.');
    return url.href;
  }

  const expired = reason => ['Room expired','Room invitation expired','Room idle limit reached','Room session limit reached'].includes(reason);
  function showLifetime(id, notice) {
    const node = document.getElementById(id);
    if (!node) return;
    node.hidden = !notice?.warning;
    node.textContent = notice?.warning ? {
      invitation:'Invitation ends soon. Share it now or host a new room.',
      idle:'Room closes soon. Start or resume play, or return to title to save.',
      session:'Room ends soon. Finish up, then ask the host to return to title and save.',
    }[notice.kind] : '';
  }

  class Connection {
    constructor(room, role, token, build, events) {
      this.maxBuffered = role === 'host' ? 131072 : 16384;
      this.events = events; this.ready = false; this.last = Date.now(); this.closed = false;
      this.lifetime = null;
      const url = new URL(`/coop/rooms/${room}/socket`, location.href);
      url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
      this.socket = new WebSocket(url, [`supertux-coop-v${protocol}`, `${role}.${token}`]);
      this.socket.addEventListener('open', () => {if (!this.closed) this.send({type: 'hello', protocol, build, ...(events.view ? {view:true} : {})});});
      this.socket.addEventListener('message', event => {
        if (this.closed) return; // buffered events from a retired room own no input
        if (typeof event.data !== 'string' || new TextEncoder().encode(event.data).length > 65536) { this.close('Invalid relay message'); return; }
        let value;
        try { value = JSON.parse(event.data); } catch { this.close('Invalid relay message'); return; }
        if (!value || typeof value !== 'object' || Array.isArray(value)) {this.close('Invalid relay message'); return;}
        this.last = Date.now();
        this.send({type: 'seen'});
        if (value.type === 'lifetime') {
          if (Object.keys(value).some(key => !['type','revision','kind','remainingMs','warning'].includes(key)) ||
              !Number.isInteger(value.revision) || value.revision <= 0 || value.revision >= 0x80000000 ||
              !['invitation','idle','session'].includes(value.kind) || !Number.isInteger(value.remainingMs) ||
              value.remainingMs < 0 || value.remainingMs > 3600000 || typeof value.warning !== 'boolean' ||
              value.warning !== (value.remainingMs <= 120000)) {this.close('Invalid room deadline'); return;}
          if (this.lifetime && value.revision <= this.lifetime.revision) return;
          this.lifetime = value;
          events.lifetime?.(value);
        }
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
      this.lifetime = null; this.events.lifetime?.(null);
      try { this.socket.close(1000, 'Input proof stopped'); } catch {}
    }
    close(reason = 'Room closed') { this.finish(reason); }
  }

  function host(module) {
    const queue = [], status = document.getElementById('coop_status');
    const element = id => document.getElementById(id), diagnostics = new URLSearchParams(location.search).has('coop_debug');
    let supportsRooms = false, invitation = '', started = false, starting = false, completion = null, lastCompletionSession = 0;
    const levels = {0:{name:'Welcome to Antarctica',scene:'antarctica-v1'},3:{name:'The Journey Begins',scene:'journey-v1'}};
    let relayInterrupted = false, lost = false, recoveryPaused = false, retiredGeneration = null, pauseGeneration = null, lastStall = 0, lastFrame = performance.now();
    let sceneDeadline = 0, sceneKey = null, sceneLoaded = null, connection, creating = false, createEpoch = 0, joinRejected = false, guestView = false, lastView = 0, state = {reserved: 0, enabled: false, generation: 0, sequence: 0}, lastSent = '';
    const say = text => { if (status && status.textContent !== text) status.textContent = text; };
    const guestReady = () => !!(connection?.ready && guestView && state.reserved === 1 && !lost && !relayInterrupted && !joinRejected);
    const startReady = () => diagnostics ? !!(connection?.ready && state.reserved === 1 && !lost && !relayInterrupted && !joinRejected) : guestReady();
    const set = (id, key, value) => {const node = element(id); if (node && node[key] !== value) node[key] = value;};
    const render = () => {
      set('coop_create','disabled',!supportsRooms || !module.supertuxReady || creating || lost || started || state.reserved === 1 || !!(connection && !connection.closed));
      set('coop_antarctica','disabled',!startReady() || starting || (!diagnostics && started) || !module.supertuxShell?.active);
      set('coop_antarctica','hidden',started && !diagnostics);
      set('coop_level','disabled',starting || started);
      set('coop_level_choice','hidden',started && !diagnostics);
      set('coop_close','hidden',!connection || connection.closed);
      set('coop_invite','hidden',!invitation || started || guestReady());
      for (const id of ['coop_share','coop_copy']) set(id,'disabled',!invitation || !connection?.ready);
      set('coop_join_form','hidden',!!invitation || creating || started || lost);
      const resultOpen = !!(completion && !lost);
      const resultReady = resultOpen && completion.nativeReady && completion.saved && !completion.saving && !starting &&
        startReady() && !recoveryPaused && !document.hidden && !!module.supertuxShell?.active;
      set('coop_result','hidden',!resultOpen);
      set('coop_result_title','textContent',completion?.transition ? 'Starting together…' : completion?.win ? 'Level complete!' : 'Level ended');
      set('coop_result_level','textContent',levels[completion?.transition?.level ?? completion?.level]?.name || '');
      set('coop_result_status','textContent',completion?.message || '');
      set('coop_replay','disabled',!resultReady);
      set('coop_next','hidden',!completion?.win || completion.level !== 0);
      set('coop_next','disabled',!resultReady);
      set('coop_result_end','hidden',starting || !completion?.win || completion.level !== 3);
      set('coop_save_retry','hidden',!completion?.saveFailed || starting);
      set('coop_save_retry','disabled',!!completion?.saving);
      set('coop_save_continue','hidden',!completion?.saveFailed || starting);
    };
    const clearInvitation = () => {
      invitation = '';
      if (element('coop_invitation')) element('coop_invitation').value = '';
      if (element('coop_manual')) element('coop_manual').hidden = true;
      if (element('coop_share_status')) element('coop_share_status').textContent = '';
      for (const id of ['coop_view_link','coop_link']) if (element(id)) element(id).href = '';
      render();
    };
    const cancelPendingTransition = () => {
      // Backgrounding can retire a selection before native code consumes it.
      // Restore choices rather than leaving both screens waiting forever.
      if (completion?.transition && queue.some(command => command[0] === 6))
        module.supertuxCoop.transitionRejected(completion.session, completion.epoch);
    };
    const interrupt = (reason, permanent = false) => {
      if (state.reserved !== 1) return;
      lost ||= permanent;
      if (permanent) clearInvitation();
      recoveryPaused = true;
      pauseGeneration = state.generation;
      cancelPendingTransition();
      queue.length = 0;
      sceneLoaded = null;
      sceneDeadline = 0;
      module.supertuxShell?.pause(reason);
      enqueue([4, 0, 0, 0]);
      const restart = document.getElementById('coop_restart');
      if (restart) restart.hidden = !lost;
      say(reason);
      render();
    };
    const retireInput = () => {
      if (retiredGeneration !== null) return;
      retiredGeneration = state.generation;
      module.supertuxShell?.resetInput();
      enqueue([4, 0, 0, 0]);
    };
    const enqueue = value => {
      if (value[0] !== 2) {
        // A lifecycle reset retires controls, not a pending ownership change.
        // Blur can arrive between peer notification and the native poll.
        const peer = value[0] === 4 ? queue.findLast(command => command[0] === 1 || command[0] === 3) : null;
        cancelPendingTransition();
        queue.length = 0;
        if (peer) queue.push(peer);
      }
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
        // Native reset is synchronous, but engineStatus is reported at the
        // next frame. Do not let an old acknowledgment refill this gate in
        // that interval, including when Resume is pressed immediately.
        pauseGeneration = state.generation;
        sceneLoaded = null; sceneDeadline = 0;
        enqueue([4, 0, 0, 0]);
        session();
        render();
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
        if (enabled) {started = true; starting = false;}
        if (enabled && completion?.transition?.session) completion = null;
        if (generation !== pauseGeneration) pauseGeneration = null;
        if (generation !== retiredGeneration) retiredGeneration = null;
        if (enabled && module.supertuxShell?.active) recoveryPaused = false;
        const key = `${reserved}/${enabled}/${generation}`;
        if (key !== lastSent) { lastSent = key; session(); }
        if (reserved === 1) joinRejected = false;
        if (reserved === -2) joinRejected = true;
        if (connection?.ready && reserved === 1 && !relayInterrupted && !lost && !recoveryPaused) say(enabled ? 'Playing together. You control Player 1; your guest controls Player 2.' : starting ? 'Starting together. Waiting for Player 2’s scene…' : completion ? 'Choose what to play next.' : started ? 'Paused. Release controls before continuing.' : guestView ? 'Player 2 ready. Press Start together.' : 'Controller connected. Use the shared-view invitation to play on two screens.');
        if (connection?.ready && reserved === -1 && !joinRejected) say('Player 2 disconnected. Return to the title screen, rejoin, then start a level.');
        if (connection?.ready && joinRejected) say('Join requires one local player at the title screen. Return there and rejoin before starting a level; reload if local Player 2 was already configured.');
        render();
      },
      get state() { return {...state, queued: queue.length, joinRejected, relayInterrupted, lost, recoveryPaused, awaitingNativeReset:pauseGeneration !== null, lastStall, guestReady:guestReady(), supportsRooms, starting, started, completion}; },
      get connection() { return connection; },
      wantsView() {return !!(connection?.ready && guestView && state.reserved === 1 && state.generation && Date.now() - lastView >= 100);},
      sceneReady(session, epoch) {
        // Permanent loss holds the simulation until the save-preserving title
        // restart, including after close() retires guestView synchronously.
        if (lost) return false;
        if (!guestView || state.reserved !== 1) return true;
        if (!module.supertuxShell?.active) {sceneDeadline=0;return false;}
        const next=`${session}/${epoch}`;
        // Only the campaign engine's loading query owns this identity. A
        // fading title/world-map background can also draw an unsupported view.
        if (sceneKey!==next) {sceneKey=next;sceneLoaded=null;sceneDeadline=0;}
        if (sceneLoaded===next) return true;
        if (!sceneDeadline) sceneDeadline=Date.now()+15000;
        if (Date.now()>sceneDeadline) {connection?.close('Shared view loading stalled. Return to the title screen and create a new room.');return false;}
        return false;
      },
      view(snapshot) {
        lastView = Date.now();
        if (!connection?.ready || !guestView) return;
        if (completion?.transition && snapshot.session > completion.session && snapshot.scene === completion.transition.scene)
          completion.transition.session = snapshot.session;
        connection.send({...snapshot,generation:state.generation});
      },
      finished(session, epoch, win, level) {
        if (!connection?.ready || !guestView || lost || ![0,3].includes(level) ||
            !Number.isInteger(session) || session<=lastCompletionSession || !Number.isInteger(epoch) || epoch<=0) return false;
        lastCompletionSession = session;
        completion = {session,epoch,win:!!win,level,nativeReady:false,saved:false,saving:false,saveFailed:false,message:'Saving your progress…'};
        starting = false;
        module.supertuxShell?.resetInput();
        connection.send({type:'result',session,epoch,generation:state.generation,win:!!win});
        render();
        return true;
      },
      completionReady(session, epoch) {
        if (!completion || completion.session !== session || completion.epoch !== epoch || completion.nativeReady) return;
        completion.nativeReady = true;
        saveCompletion();
      },
      transitionRejected(session, epoch) {
        if (!completion?.transition || completion.session !== session || completion.epoch !== epoch || lost) return;
        completion.transition = null; starting = false;
        completion.message = 'Could not start the level. Try again when both players are ready.';
        connection?.send({type:'result',session,epoch,generation:state.generation,win:completion.win});
        render();
      },
    };
    async function saveCompletion() {
      const result = completion;
      if (!result?.nativeReady || result.saving || lost) return;
      result.saving = true; result.saveFailed = false; result.message = 'Saving your progress…'; render();
      let saved = false;
      try {saved = await window.supertux_saveFiles?.() === true;} catch {}
      if (completion !== result || lost) return;
      result.saving = false; result.saved = saved; result.saveFailed = !saved;
      result.message = saved ? 'Ready when you are. Player 2 stays in this room.' : 'Progress could not be saved. Retry, or keep playing for this visit.';
      render();
      if (module.supertuxShell?.active && !document.hidden)
        element(saved ? (result.win && result.level===0 ? 'coop_next' : 'coop_replay') : 'coop_save_retry')?.focus?.();
    }
    const playAgain = next => {
      const result = completion;
      if (!result?.nativeReady || !result.saved || result.saving || starting || !startReady() || recoveryPaused ||
          !module.supertuxShell?.active || document.hidden || (next && (!result.win || result.level !== 0))) return;
      const level = next ? 3 : result.level, scene = levels[level].scene;
      if (!connection.send({type:'transition',session:result.session,epoch:result.epoch,generation:state.generation,scene})) return;
      starting = true; result.transition = {scene,level}; result.message = `Loading ${levels[level].name}… Waiting for Player 2’s view.`;
      sceneKey = sceneLoaded = null; sceneDeadline = 0;
      module.supertuxShell?.resetInput();
      enqueue([6,level,result.session,result.epoch]);
      render();
    };
    element('coop_replay')?.addEventListener('click', () => playAgain(false));
    element('coop_next')?.addEventListener('click', () => playAgain(true));
    element('coop_save_retry')?.addEventListener('click', saveCompletion);
    element('coop_save_continue')?.addEventListener('click', () => {
      if (!completion?.saveFailed || completion.saving || lost) return;
      completion.saved = true; completion.saveFailed = false;
      completion.message = 'Progress is kept for this visit. Keep this tab open.'; render();
    });
    element('coop_result_close')?.addEventListener('click', () => element('coop_close')?.click());
    window.addEventListener('keydown', event => {
      if (!completion || lost || !module.supertuxShell?.active || event.key!=='Tab') return;
      const controls=Array.from(element('coop_result')?.querySelectorAll?.('button:not([hidden]):not(:disabled)') || []);
      const current=document.activeElement, first=controls[0], last=controls.at(-1);
      if (first && (!controls.includes(current) || (event.shiftKey ? current===first : current===last))) {
        event.preventDefault();(event.shiftKey ? last : first).focus();
      }
    }, true);
    const panel = document.getElementById('coop_panel');
    if (panel) panel.hidden = true;
    if (element('coop_diagnostics')) element('coop_diagnostics').hidden = !diagnostics;
    if (element('coop_share')) element('coop_share').hidden = !window.navigator?.share;
    render();
    // A query flag cannot enable rooms on the production Worker.
    fetch('/coop/capabilities.json', {cache:'no-store', signal:AbortSignal.timeout(5000)}).then(async response => {
      if (!response.ok) return;
      const value = await response.json();
      supportsRooms = value.rooms === true && value.protocol === protocol;
      if (panel) panel.hidden = !supportsRooms;
      render();
    }).catch(() => {}); // Single-player remains usable when discovery fails.
    document.getElementById('coop_create')?.addEventListener('click', async () => {
      if (creating || !module.supertuxReady) return;
      if (lost || state.reserved === 1) {say('Close the current room and return to the title screen before creating a new invitation.');return;}
      const epoch = ++createEpoch;
      creating = true; sceneDeadline=0;sceneKey = sceneLoaded = null; joinRejected = false; connection?.close(); relayInterrupted = lost = recoveryPaused = false; retiredGeneration = pauseGeneration = null; enqueue([3, 0, 0, 0]);
      clearInvitation(); say('Creating your private room…'); render();
      const restart = document.getElementById('coop_restart');
      if (restart) restart.hidden = true;
      try {
        const build = window.SUPERTUX_DEPLOY_CONFIG?.manifestSha256;
        const response = await fetch('/coop/rooms', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({protocol, build}), signal: AbortSignal.timeout(10000)});
        if (!response.ok) throw Error('Could not create the room. Check your connection and tap Host game to retry.');
        const room = await response.json();
        if (epoch !== createEpoch || document.hidden) return;
        if (!validInvitation(new URLSearchParams({room:room.room,token:room.guest,build:room.build})) || room.build !== build || !/^[a-f0-9]{64}$/.test(room.host || '')) throw Error('Room creation failed. Tap Host game to retry.');
        const join = new URL('coop-controller.html', location.href);
        join.hash = new URLSearchParams({room: room.room, token: room.guest, build: room.build});
        const link = document.getElementById('coop_link'); if (link) {link.href = join.href; link.textContent = 'Open controller-only diagnostic';}
        const viewLink = document.getElementById('coop_view_link');
        join.pathname = new URL('coop-view.html', location.href).pathname; invitation = join.href;
        if (viewLink) {viewLink.href = invitation; viewLink.textContent = 'Open Player 2 invitation';}
        if (element('coop_invitation')) element('coop_invitation').value = invitation;
        connection = new Connection(room.room, 'host', room.host, build, {
          lifetime: notice => showLifetime('coop_lifetime', notice),
          ready: () => { say('Room ready. Share the invitation with Player 2.'); session(); render(); },
          message: value => {
            if (value.type === 'connection' && value.interrupted === true) {relayInterrupted = true; interrupt('Connection interrupted. Controls are released. Wait for recovery, then press Resume.');}
            if (value.type === 'connection' && value.interrupted === false) {relayInterrupted = false; say('Connection recovered. Release controls, then press Resume on the host.');}
            if (value.type === 'peer') {
              if (!value.connected) interrupt('Player 2 disconnected. Return to the title screen and create a new room.', true);
              guestView = !!(value.connected && value.view); joinRejected = false; enqueue([value.connected ? 1 : 3, 0, 0, 0]);
            }
            if (value.type === 'view-ready' && pauseGeneration === null && value.generation === state.generation && `${value.session}/${value.epoch}` === sceneKey) sceneLoaded = sceneKey;
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
          closed: reason => {
            const message = expired(reason) ? (state.reserved === 1 ? 'Room ended. Return to title to save and create a new invitation.' : 'Invitation expired. Tap Host game for a fresh invitation.') : reason;
            interrupt(message, true); guestView = false; starting = false; clearInvitation(); enqueue([3, 0, 0, 0]); say(message);
          },
        });
      } catch (error) { if (epoch === createEpoch) say(error.message); }
      finally {
        creating = false;
        if (epoch !== createEpoch && !connection?.ready) say('Room creation was interrupted. Press Resume, then tap Host game to retry.');
        render();
      }
    });
    document.getElementById('coop_close')?.addEventListener('click', () => {++createEpoch; connection?.close(); clearInvitation();});
    const manualCopy = () => {
      if (element('coop_manual')) element('coop_manual').hidden = false;
      element('coop_invitation')?.focus(); element('coop_invitation')?.select();
      if (element('coop_share_status')) element('coop_share_status').textContent = 'Copy the selected invitation and send it to Player 2.';
    };
    element('coop_copy')?.addEventListener('click', async () => {
      const current = invitation;
      if (!current || !connection?.ready) return;
      try {
        if (!window.navigator?.clipboard?.writeText) throw Error('Clipboard unavailable');
        await window.navigator.clipboard.writeText(current);
        if (invitation === current && element('coop_share_status')) element('coop_share_status').textContent = 'Invitation copied. Send it privately to Player 2.';
      } catch {if (invitation === current) manualCopy();}
    });
    element('coop_share')?.addEventListener('click', async () => {
      const current = invitation;
      if (!current || !connection?.ready || !window.navigator?.share) return;
      try {await window.navigator.share({title:'SuperTux private co-op',text:'Join me as Player 2 in SuperTux.',url:current});}
      catch (error) {if (error.name !== 'AbortError' && invitation === current) manualCopy();}
    });
    element('coop_join_invitation')?.addEventListener('click', () => {
      try {location.assign(invitationURL(element('coop_join_url')?.value));}
      catch {if (element('coop_join_status')) element('coop_join_status').textContent = 'Paste a Player 2 invitation from this private co-op site.';}
    });
    document.getElementById('coop_restart')?.addEventListener('click', async () => {
      const restart = document.getElementById('coop_restart');
      if (!lost || restart?.disabled) return;
      if (restart) restart.disabled = true;
      try {
        const saved = await window.supertux_saveFiles?.();
        if (saved !== true) throw Error('Save did not complete');
        location.reload();
      } catch {
        const message = 'Progress could not be saved. Keep this page open and retry Return to title.';
        module.supertuxShell?.pause(message);
        say(message);
      } finally {
        if (restart) restart.disabled = false;
      }
    });
    document.getElementById('coop_antarctica')?.addEventListener('click', () => {
      if (!startReady() || starting || (!diagnostics && started) || !module.supertuxShell?.active) {say('Wait for Player 2 to be ready, then press Start together.');return;}
      const level = Number(element('coop_level')?.value || 0);
      if (![0,3].includes(level)) {say('Choose one of the supported levels before starting.');return;}
      starting = true; say('Starting together. Waiting for Player 2’s scene…'); render();
      enqueue([5, level, 0, 0]);
      if (panel) panel.open = false;
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
    const retry = document.getElementById('guest_join'), progress = document.getElementById('guest_progress');
    let joinController;
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
      joinController?.abort(); joinController = new AbortController();
      const signal = joinController.signal;
      connection?.close(); enabled = relayInterrupted = false; clear(); generation = sequence = 0;
      view?.reset();
      joining = true;
      if (retry) retry.disabled = true;
      if (progress) {progress.hidden = false; progress.removeAttribute('value');}
      if (connection && connection.socket.readyState !== WebSocket.CLOSED) {
        await new Promise(resolve => {
          const timer = setTimeout(resolve, 1000);
          connection.socket.addEventListener('close', () => {clearTimeout(timer); resolve();}, {once:true});
        });
      }
      if (!validInvitation(params)) {
        joining = false; status.textContent = 'Open the private invitation shared by the host.';
        if (retry) retry.disabled = false;
        if (progress) progress.hidden = true;
        return;
      }
      status.textContent = 'Checking your invitation…';
      try {
        const response = await fetch('index.html', {cache: 'no-store', signal: AbortSignal.any([signal,AbortSignal.timeout(10000)])});
        if (!response.ok) throw Error('Could not check the invitation. Check your connection and tap Retry joining.');
        const html = await response.text();
        if (epoch !== joinEpoch || document.hidden) return;
        const config = /window\.SUPERTUX_DEPLOY_CONFIG = (.*?);<\/script>/.exec(html);
        if (!config || JSON.parse(config[1]).manifestSha256 !== params.get('build')) throw Error('The game was updated. Ask the host for a new invitation.');
        if (view) await view.prepare(JSON.parse(config[1]), {signal, onProgress(completed,total) {
          if (epoch !== joinEpoch || signal.aborted) return;
          if (progress) {progress.max = total || 1; progress.value = completed;}
          status.textContent = `Preparing Player 2 artwork · ${total ? Math.floor(completed/total*100) : 100}%`;
        }});
      } catch (error) {
        if (epoch === joinEpoch) {status.textContent = error.name === 'TimeoutError' ? 'Joining took too long. Check your connection and tap Retry joining.' : error.message;}
        return;
      } finally {
        if (epoch === joinEpoch) {joining = false; if (retry) retry.disabled = false; if (progress) progress.hidden = true;}
      }
      if (epoch !== joinEpoch || document.hidden) {joining = false; return;}
      joining = true;
      if (retry) retry.disabled = true;
      status.textContent = 'Artwork ready. Connecting to the host…';
      connection = new Connection(params.get('room'), 'guest', params.get('token'), params.get('build'), {
        lifetime: notice => showLifetime('guest_lifetime', notice),
        view: !!view,
        ready: () => { joining = false; if (retry) {retry.disabled = false; retry.hidden = true;} status.textContent = 'Player 2 ready. Waiting for the host to press Start together.'; },
        message: value => {
          if (value.type === 'connection' && value.interrupted === true) {relayInterrupted = true; enabled = false; clear(); view?.setEnabled(false,generation); status.textContent = 'Connection interrupted. Controls are released. Wait for the host to resume.';}
          if (value.type === 'connection' && value.interrupted === false) {relayInterrupted = false; status.textContent = 'Connection recovered. Waiting for the host to press Resume.';}
          if (value.type === 'session' && Number.isInteger(value.generation) && typeof value.enabled === 'boolean') {
            if (generation !== value.generation || enabled !== value.enabled) {
              enabled = false; keys.clear(); fingers.clear(); generation = value.generation; sequence = 0;
              enabled = value.enabled && !relayInterrupted; send(); // fresh neutral state, never held-key replay
            }
            view?.setEnabled(enabled,generation);
            status.textContent = view?.state.outcome ? 'Waiting for the host’s choice. You stay in this room.' : enabled ? (view ? 'You control Player 2. The host controls Player 1.' : 'Player 2 input active. The game is visible on the host only.') : relayInterrupted ? 'Connection interrupted. Waiting for the host to resume.' : view && !view.state.latest ? 'Player 2 ready. Waiting for the host to press Start together.' : 'Host is paused or in menus. Release controls before continuing.';
          }
          if (value.type === 'view' && view) view.accept(value);
          if (value.type === 'result' && view?.result(value)) {enabled=false;clear();status.textContent='Waiting for the host’s choice. You stay in this room.';}
          if (value.type === 'transition' && view?.transition(value)) {enabled=false;clear();status.textContent='Starting together. Waiting for the new level.';}
          if (value.type === 'ack') document.getElementById('guest_ack').textContent = `Host accepted input ${value.sequence}.`;
        },
        refresh: send,
        closed: reason => { joining = false; if (retry) {retry.disabled = false; retry.hidden = false;} enabled = false; clear(); view?.reset(); status.textContent = expired(reason) ? 'Room ended. Ask the host for a fresh invitation.' : reason + ' Ask the host for a fresh invitation if Retry joining does not work.'; },
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
    window.addEventListener('hashchange', () => {
      // Invitations keep credentials in the fragment. Opening a new room in
      // this tab is a same-document navigation unless we retire this client.
      ++joinEpoch; joinController?.abort(); clear(); connection?.close('Joining the new invitation.');
      location.reload();
    });
    const leave = reason => {
      ++joinEpoch; joinController?.abort(); joining = false; if (retry) {retry.disabled = false; retry.hidden = false;}
      if (progress) progress.hidden = true;
      clear(); enabled = false; view?.reset(); connection?.close(reason); status.textContent = reason;
    };
    window.addEventListener('pagehide', () => leave('Player 2 left. Ask the host for a fresh invitation.'));
    document.addEventListener('visibilitychange', () => { if (document.hidden) leave('Player 2 was backgrounded. Ask the host for a fresh invitation.'); });
    document.getElementById('guest_join').addEventListener('click', join);
    // Diagnostic state is input/connection only. It contains no world data.
    window.supertuxGuest = {get state() {return {enabled, generation, sequence, mask: mask(), connected: !!connection?.ready};}, get connection() {return connection;}};
    join();
  }
  window.SupertuxCoop = {Connection, host, guest, invitationURL};
  if (window.Module) host(window.Module);
  else if (document.getElementById('guest_status')) guest();
})();
