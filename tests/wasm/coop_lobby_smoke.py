#!/usr/bin/env python3
"""Normal Host/Join UI with a compiled host and actual Worker/Durable Object.

Share/clipboard denial and download failures are labelled browser fixtures.
Mobile viewports and Linux WebKit do not establish physical-phone acceptance.
"""
import asyncio
import json
import re
from playwright.async_api import async_playwright
from browser_smoke import KNOWN_UPSTREAM_UB
import coop_smoke


async def run(args, url):
    report = dict(engine=args.browser, configuration=json.loads((args.build/'BUILD_INFO.json').read_text()),
                  physical_device_tested=False, checks=[], errors=[])
    logs, errors, requests = [], [], []
    async with async_playwright() as p:
        launch = dict(args=['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader',
                            '--disable-gpu-compositing']) if args.browser == 'chromium' else {}
        if args.webkit_executable:
            launch['executable_path'] = args.webkit_executable
        host_browser = await getattr(p,args.browser).launch(**launch)
        guest_browser = await getattr(p,args.browser).launch(**launch)
        report['browser'] = host_browser.version
        hc = await host_browser.new_context(viewport={'width':844,'height':390},has_touch=True)
        gc = await guest_browser.new_context(viewport={'width':844,'height':390},has_touch=True)
        if args.browser == 'chromium':
            await hc.grant_permissions(['local-network-access'])
        # Emulated platform APIs: verify cancellation/fallback and the exact
        # invitation passed to them without opening OS UI or sharing a message.
        await hc.add_init_script('''
          Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async()=>{throw new DOMException('Denied','NotAllowedError');}}});
          Object.defineProperty(navigator,'share',{configurable:true,value:async data=>{window.shareFixture=data;throw new DOMException('Cancelled','AbortError');}});
        ''')
        host, guest = await hc.new_page(), await gc.new_page()
        host.set_default_timeout(30000)
        guest.set_default_timeout(30000)
        for page, role in [(host,'Host'),(guest,'Guest')]:
            page.on('console',lambda message:logs.append(message.text))
            page.on('pageerror',lambda error,role=role:errors.append(role+': '+str(error)))
        guest.on('request',lambda request:requests.append(request.url.split('#')[0]))
        release_failure = asyncio.Event()
        intercepted = False
        async def fail_one_artwork(route):
            nonlocal intercepted
            if not intercepted:
                intercepted = True
                await release_failure.wait()
                await route.fulfill(status=503,body='Intentional download failure')
            else:
                await route.continue_()
        try:
            # Ordinary player entry: no developer arguments or coop query flag.
            await host.goto(url+'index.html')
            await host.wait_for_function('window.Module?.supertuxReady && Module.supertuxCoop.state.supportsRooms',timeout=180000)
            await host.locator('#start_button').tap()
            await host.wait_for_function("Module.supertuxShell.active && Module.ccall('get_browser_menu_state','number',[],[])===1")
            await host.locator('#coop_panel > summary').tap()
            assert not await host.locator('#coop_diagnostics').is_visible()
            assert await host.locator('#coop_antarctica').is_disabled()
            await host.screenshot(path=str(args.output/'host-lobby.png'))
            await host.locator('#coop_create').tap()
            await host.wait_for_function("document.querySelector('#coop_status').textContent.includes('Room ready')")
            invitation = await host.locator('#coop_view_link').get_attribute('href')
            assert 'coop-view.html#room=' in invitation
            assert await host.locator('#coop_view_link').inner_text() == 'Open Player 2 invitation'
            await host.locator('#coop_share').tap()
            assert await host.evaluate('(url)=>window.shareFixture.url===url',invitation)
            assert await host.evaluate('Module.supertuxCoop.connection.ready')
            await host.locator('#coop_copy').tap()
            assert await host.locator('#coop_manual').is_visible()
            assert await host.evaluate("document.querySelector('#coop_invitation').selectionEnd===document.querySelector('#coop_invitation').value.length")
            await host.locator('#coop_manual label').dblclick()
            assert await host.evaluate('getSelection().toString().trim().length>0')
            await host.locator('#coop_copy').tap()
            report['checks'].append('Normal entry discovers rooms, hides diagnostics, creates one invitation and safely handles simulated Share cancellation / clipboard denial')

            await guest.route('**/coop-art/*.png',fail_one_artwork)
            await guest.goto(invitation)
            await guest.wait_for_function("!document.querySelector('#guest_progress').hidden && document.querySelector('#guest_progress').value>0",timeout=90000)
            assert not await guest.evaluate('supertuxGuest.state.connected')
            assert await host.locator('#coop_antarctica').is_disabled()
            assert await host.evaluate('Module.supertuxShell.active')
            release_failure.set()
            await guest.wait_for_function("document.querySelector('#guest_status').textContent.includes('download failed')")
            assert not await guest.evaluate('supertuxGuest.state.connected')
            assert not await guest.locator('#guest_join').is_disabled()
            await guest.unroute('**/coop-art/*.png',fail_one_artwork)
            await guest.locator('#guest_join').tap()
            await guest.wait_for_function('supertuxGuest.state.connected',timeout=120000)
            await host.wait_for_function('Module.supertuxCoop.state.guestReady')
            await host.wait_for_function("Module.supertuxCoop.connection.lifetime?.kind==='idle'")
            await guest.wait_for_function("supertuxGuest.connection.lifetime?.kind==='idle'")
            assert not await host.locator('#coop_lifetime').is_visible()
            assert not await guest.locator('#guest_lifetime').is_visible()
            assert not await guest.locator('#guest_progress').is_visible()
            assert not await guest.locator('#guest_join').is_visible()
            assert not await host.locator('#coop_antarctica').is_disabled()
            await host.screenshot(path=str(args.output/'host-ready.png'))
            report['checks'].append('Validated-byte artwork progress appears before readiness; an intentional partial/503 load cannot connect or start, and Retry joining succeeds')

            await host.locator('#coop_antarctica').tap()
            await guest.wait_for_function("SupertuxView.playable && SupertuxView.state.drawn?.scene==='antarctica-v1' && SupertuxView.state.drawn.players.every(p=>p.dead===0)",timeout=45000)
            assert not await host.locator('#coop_panel').evaluate('(e)=>e.open')
            assert await guest.evaluate('SupertuxView.state.drawn.players.length') == 2
            assert not any(re.search(r'\.wasm(?:$|\?)|\.data(?:$|\?)|/music/|supertux2\.js',request) for request in requests)
            report['checks'].append('Start together enters the original supported level with both players; the guest downloads no WASM, startup DATA or soundtrack')
            await host.wait_for_function("Module.supertuxCoop.connection.lifetime?.kind==='session'")
            assert await host.evaluate('Module.supertuxCoop.connection.lifetime.remainingMs>15*60*1000')
            report['checks'].append('The real relay announces a waiting-room deadline and then an active session with more than the old 15-minute lifetime')
            x = await guest.evaluate('SupertuxView.state.drawn.players[1].x')
            await guest.keyboard.down('ArrowRight')
            await guest.wait_for_function('(x)=>SupertuxView.playable && SupertuxView.state.drawn.players[1].x>x+20',arg=x)
            await guest.keyboard.up('ArrowRight')
            await guest.locator('[data-control="16"]').tap()
            await guest.wait_for_function("SupertuxView.state.drawn.players[1].action.includes('jump')")
            assert await guest.evaluate('supertuxGuest.state.mask') == 0
            report['checks'].append('Player 2 movement and trusted touch Jump reach the authoritative host; releasing the touch leaves neutral input')

            # Exercise the play-surface selection boundary and captured input.
            # Desktop WebKit cannot observe iOS's native long-press callout.
            await guest.evaluate('getSelection().removeAllRanges()')
            await guest.locator('#guest_status').dblclick()
            assert await guest.evaluate('getSelection().toString()') == ''
            jump = await guest.locator('[data-control="16"]').bounding_box()
            await guest.mouse.move(jump['x']+jump['width']/2,jump['y']+jump['height']/2)
            await guest.mouse.down()
            await guest.wait_for_function('supertuxGuest.state.mask===16')
            await guest.wait_for_timeout(800)
            await guest.mouse.move(12,12,steps=8)
            assert await guest.evaluate('supertuxGuest.state.mask') == 16
            await guest.mouse.up()
            await guest.wait_for_function('supertuxGuest.state.mask===0')
            assert await guest.evaluate('getSelection().toString()') == ''
            for _ in range(3):
                await guest.locator('[data-control="16"]').tap()
                assert await guest.evaluate('supertuxGuest.state.mask') == 0
            report['checks'].append('Guest play labels cannot be selected; held Jump survives a drag off the button and releases neutrally; repeated touch taps leave no held input (OS callout unverified)')

            async def layout():
                return await guest.evaluate('''() => [...document.querySelectorAll('[data-control]')].every(e=>{
                  const r=e.getBoundingClientRect();return r.width>=44 && r.height>=44 && r.left>=0 && r.top>=0 && r.right<=innerWidth+.5 && r.bottom<=innerHeight+.5;
                })''')
            for width,height,label in [(390,844,'portrait'),(844,390,'landscape')]:
                await host.set_viewport_size({'width':width,'height':height})
                await guest.set_viewport_size({'width':width,'height':height})
                await guest.wait_for_function('SupertuxView.playable && supertuxGuest.state.mask===0')
                assert await layout(),label
                # Deliberate pause keeps software screenshot readback from
                # manufacturing a host-renderer watchdog failure.
                await host.evaluate("Module.supertuxShell.pause('Paused for viewport evidence. Press Resume.')")
                await guest.wait_for_function('!SupertuxView.state.enabled')
                await host.wait_for_function("Module.supertuxCoop.connection.lifetime?.kind==='idle'")
                await guest.wait_for_function("supertuxGuest.connection.lifetime?.kind==='idle'")
                # UI-only deadline fixture; fake-clock Worker tests verify
                # authoritative warning/expiry, including hibernation.
                await host.evaluate("Module.supertuxCoop.connection.events.lifetime({kind:'idle',warning:true})")
                await guest.evaluate("supertuxGuest.connection.events.lifetime({kind:'idle',warning:true})")
                assert await host.locator('#coop_lifetime').is_visible()
                assert await guest.locator('#guest_lifetime').is_visible()
                assert await layout(),label+' with expiry warning'
                await host.locator('#coop_panel').evaluate('(e)=>e.open=true')
                if label == 'landscape':
                    # Explicit inset emulation, not physical Safari. The shell
                    # already owns these insets; its child must fit its bounds.
                    await host.evaluate("document.querySelector('#game_shell').style.padding='44px 24px 34px 24px'")
                    assert await host.evaluate('''() => {
                      const p=document.querySelector('#coop_panel').getBoundingClientRect(),a=document.querySelector('#game_area').getBoundingClientRect();
                      return p.top>=a.top && p.left>=a.left && p.right<=a.right+.5 && p.bottom<=a.bottom+.5;
                    }''')
                    await host.evaluate("document.querySelector('#game_shell').style.padding=''")
                assert await host.evaluate("(()=>{const e=document.querySelector('#start_button'),r=e.getBoundingClientRect();return document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)===e;})()")
                await host.screenshot(path=str(args.output/(label+'-host.png')))
                await guest.screenshot(path=str(args.output/(label+'-guest.png')))
                await host.locator('#start_button').tap()
                await guest.wait_for_function('SupertuxView.playable && supertuxGuest.state.mask===0')
                await host.locator('#coop_panel').evaluate('(e)=>e.open=false')
            report['checks'].append('Portrait/landscape touch targets stay onscreen at least 44px; the panel fits an explicit inset fixture and cannot cover trusted Resume; both resumes require fresh neutral state')
            report['checks'].append('Injected deadline warnings remain visible during host Pause, fit guest touch controls and cannot intercept trusted Resume')

            await guest.evaluate("Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'))")
            await host.wait_for_function('Module.supertuxCoop.state.lost && !Module.supertuxShell.active')
            assert await host.locator('#coop_restart').is_visible()
            assert not await guest.evaluate('SupertuxView.playable')
            report['checks'].append('Guest backgrounding retires controls, pauses the host and exposes the save-preserving Return to title path')

            await host.evaluate('window.beforeExpiryRejoin=true')
            await host.locator('#coop_restart').tap()
            await host.wait_for_function('!window.beforeExpiryRejoin && window.Module?.supertuxReady && Module.supertuxCoop.state.supportsRooms',timeout=180000)
            await host.locator('#start_button').tap()
            await host.wait_for_function("Module.supertuxShell.active && Module.ccall('get_browser_menu_state','number',[],[])===1")
            await host.locator('#coop_panel > summary').tap()
            await host.locator('#coop_create').tap()
            await host.wait_for_function("document.querySelector('#coop_status').textContent.includes('Room ready')")
            await guest.goto(await host.locator('#coop_view_link').get_attribute('href'))
            await host.wait_for_function('Module.supertuxCoop.state.guestReady',timeout=120000)
            await host.locator('#coop_antarctica').tap()
            await guest.wait_for_function('SupertuxView.playable',timeout=45000)
            await guest.keyboard.down('ArrowRight')
            await guest.wait_for_function('supertuxGuest.state.mask===2')
            config=await host.evaluate('''() => {
              const root=Module.supertuxStorage.root;
              Module.FS.writeFile(root+'room-expiry-save-fixture','keep this progress');
              window.beforeExpiryMarker=true;
              return Module.FS.readFile(root+'config',{encoding:'utf8'});
            }''')
            # Simulate the server's close events on both actual connections.
            # This exercises compiled input/save handling without a one-hour
            # sleep or a test-only public route in the production Worker.
            await asyncio.gather(
                host.evaluate("Module.supertuxCoop.connection.socket.dispatchEvent(new CloseEvent('close',{code:1008,reason:'Room session limit reached'}))"),
                guest.evaluate("supertuxGuest.connection.socket.dispatchEvent(new CloseEvent('close',{code:1008,reason:'Room session limit reached'}))"))
            await host.wait_for_function('Module.supertuxCoop.state.lost && !Module.supertuxShell.active && !Module.supertuxCoop.state.enabled')
            assert await guest.evaluate('supertuxGuest.state.mask') == 0
            assert not await guest.evaluate('SupertuxView.playable')
            assert await host.locator('#coop_restart').is_visible()
            assert 'Room ended' in await guest.locator('#guest_status').inner_text()
            await host.evaluate('window.expirySave=window.supertux_saveFiles;window.supertux_saveFiles=async()=>false')
            await host.locator('#coop_restart').tap()
            await host.wait_for_function("document.querySelector('#status').textContent.includes('could not be saved')")
            assert await host.evaluate('window.beforeExpiryMarker && !Module.supertuxShell.active')
            await host.evaluate('window.supertux_saveFiles=window.expirySave')
            await host.locator('#coop_restart').tap()
            await host.wait_for_function('!window.beforeExpiryMarker && window.Module?.supertuxReady && Module.supertuxStorage.state==="indexeddb"',timeout=180000)
            assert await host.evaluate("Module.FS.readFile(Module.supertuxStorage.root+'room-expiry-save-fixture',{encoding:'utf8'})") == 'keep this progress'
            assert await host.evaluate("Module.FS.readFile(Module.supertuxStorage.root+'config',{encoding:'utf8'})") == config
            report['checks'].append('Simulated server expiry releases held guest input and pauses the compiled host; failed saving keeps the page open and retry hydrates unchanged settings/progress fixture bytes')
        except Exception as error:
            report['failure'] = str(error)
            raise
        finally:
            release_failure.set()
            report['errors'] = errors + [line for line in logs if re.search(r'Aborted\(|\[FATAL\]|runtime error:|missing function|AN ERROR HAS OCCURRED',line) and
                                        not (args.record_known_ub and any(re.search(pattern,line) for pattern in KNOWN_UPSTREAM_UB))]
            report['known_upstream_ub'] = [line for line in logs if 'runtime error:' in line and args.record_known_ub and any(re.search(pattern,line) for pattern in KNOWN_UPSTREAM_UB)]
            (args.output/'report.json').write_text(json.dumps(report,indent=2)+'\n')
            await hc.close(); await gc.close(); await host_browser.close(); await guest_browser.close()
    assert not report['errors'], report['errors']
    print(json.dumps(report,indent=2),flush=True)


if __name__ == '__main__':
    coop_smoke.run = run
    coop_smoke.main()
