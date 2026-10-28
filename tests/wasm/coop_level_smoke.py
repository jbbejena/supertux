#!/usr/bin/env python3
"""The Journey Begins: real host, guest and relay; labelled placement fixtures.

This checks compiled gameplay/presentation, not unassisted phone completion.
"""
import asyncio
import json
import re
import sys
import time
from pathlib import Path
from urllib.request import Request, urlopen
from playwright.async_api import async_playwright
from browser_smoke import KNOWN_UPSTREAM_UB
import coop_smoke
sys.path.insert(0,str(Path(__file__).parents[2]/'tools/web'))
from coop_presentation import sexp


async def run(args, url):
    report = dict(engine=args.browser, configuration=json.loads((args.build/'BUILD_INFO.json').read_text()),
                  physical_device_tested=False, placement_fixtures=True, checks=[], errors=[])
    logs, errors, requests = [], [], []
    html = urlopen(Request(url+'index.html', headers={'User-Agent':'SuperTux-Coop-Validation/1.0'}), timeout=30).read().decode()
    html = html.replace('var Module = {','var Module = {\narguments:["--verbose","--developer"],',1)
    async with async_playwright() as p:
        launch = dict(args=['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader',
                            '--disable-gpu-compositing']) if args.browser == 'chromium' else {}
        if args.webkit_executable: launch['executable_path'] = args.webkit_executable
        hb = await getattr(p,args.browser).launch(**launch)
        gb = await getattr(p,args.browser).launch(**launch)
        report['browser'] = hb.version
        hc = await hb.new_context(viewport={'width':844,'height':390},has_touch=True)
        gc = await gb.new_context(viewport={'width':844,'height':390},has_touch=True)
        if args.browser == 'chromium': await hc.grant_permissions(['local-network-access'])
        host, guest = await hc.new_page(), await gc.new_page()
        for page in (host,guest):
            page.set_default_timeout(30000)
            page.on('console',lambda message:logs.append(message.text))
            page.on('pageerror',lambda error:errors.append(str(error)))
        guest.on('request',lambda request:requests.append(request.url.split('#')[0]))
        await host.route('**/index.html',lambda route:route.fulfill(body=html,content_type='text/html'))
        try:
            await host.goto(url+'index.html')
            await host.wait_for_function('window.Module?.supertuxReady && Module.supertuxCoop.state.supportsRooms',timeout=180000)
            await host.locator('#start_button').tap()
            await host.wait_for_function("Module.ccall('get_browser_menu_state','number',[],[])===1")
            await host.locator('#coop_panel > summary').tap()
            await host.locator('#coop_level').select_option('3')
            assert not await host.locator('#coop_diagnostics').is_visible()
            await host.locator('#coop_create').tap()
            await host.wait_for_function("document.querySelector('#coop_status').textContent.includes('Room ready')")
            await guest.goto(await host.locator('#coop_view_link').get_attribute('href'))
            await guest.wait_for_function('supertuxGuest.state.connected',timeout=120000)
            await host.wait_for_function('Module.supertuxCoop.state.guestReady')
            await host.evaluate('''() => {
              window.levelFrames=0;window.levelPacket=null;
              const status=Module.supertuxCoop.engineStatus,publish=Module.supertuxCoop.view;
              Module.supertuxCoop.engineStatus=(...args)=>{++levelFrames;status(...args);};
              Module.supertuxCoop.view=frame=>{levelPacket=frame;publish(frame);};
            }''')
            await guest.evaluate('''() => {
              window.levelReady=SupertuxView.onReady;window.heldBaseline=null;
              SupertuxView.onReady=frame=>{heldBaseline=frame;};
              window.levelTextures=new Set();window.levelBytes=0;
              const accept=SupertuxView.accept;
              SupertuxView.accept=frame=>{
                if(frame.scene==='journey-v1') {
                  levelBytes=Math.max(levelBytes,new TextEncoder().encode(JSON.stringify(frame)).length);
                  for(const c of frame.world.draw)if(c[0]===0)levelTextures.add(c[7][0]);
                }
                return accept(frame);
              };
            }''')
            await host.locator('#coop_antarctica').tap()
            await guest.wait_for_function("heldBaseline?.scene==='journey-v1'",timeout=45000)
            # SpriteManager advances artwork frames while physics is gated.
            # Compare authoritative positions/death, not draw-time animation.
            position = 'JSON.stringify(levelPacket.players.map(p=>[p.id,p.x,p.y,p.dead]))'
            before = await host.evaluate(position)
            await host.wait_for_timeout(600)
            assert not await host.evaluate('Module.supertuxCoop.state.enabled')
            assert await host.evaluate(position) == before
            await guest.evaluate('SupertuxView.onReady=levelReady;levelReady(heldBaseline)')
            await guest.wait_for_function('SupertuxView.playable')
            assert not await host.locator('#coop_level_choice').is_visible()
            assert not any(re.search(r'\.wasm(?:$|\?)|\.data(?:$|\?)|/music/|supertux2\.js',request) for request in requests)
            report['checks'].append('Normal host selector starts the original second level; a deliberately delayed guest baseline holds native physics/input; guest fetches artwork only')

            async def key(name):
                for edge in ('down','up'):
                    await getattr(host.keyboard,edge)(name)
                    frame = await host.evaluate('levelFrames')
                    await host.wait_for_function('(frame)=>levelFrames>frame',arg=frame)

            async def sample(label, predicate='true', timeout=20000):
                await guest.wait_for_function('SupertuxView.playable && ('+predicate+')',timeout=timeout)
                value = await guest.evaluate('SupertuxView.state.drawn')
                report.setdefault('samples',{})[label] = value
                return value

            async def script(command, resume=True):
                await host.locator('#canvas').focus()
                await key('Escape')
                await host.wait_for_function("Module.ccall('get_browser_menu_state','number',[],[])===1")
                if callable(command): command = await command()
                await key('Backquote')
                await host.keyboard.type(command,delay=4)
                await key('Enter')
                await host.wait_for_function('(text)=>document.querySelector("#output").textContent.includes(text)',arg='> '+command)
                await key('Backquote')
                await key('Escape')
                if resume:
                    await guest.wait_for_function('SupertuxView.playable && supertuxGuest.state.mask===0')

            initial = await sample('initial',"SupertuxView.state.drawn.scene==='journey-v1'")
            assert {'smartblock','spiky','sspiky','firefly','snowball'} <= {e[1] for e in initial['world']['entities']}
            await coop_smoke.ready_for_view_input(host,guest)
            x = initial['players'][1]['x']
            await guest.keyboard.down('ArrowRight')
            await sample('independent-move',f'SupertuxView.state.drawn.players[1].x>{x+32}')
            await guest.keyboard.up('ArrowRight')
            await guest.locator('[data-control="16"]').tap()
            await sample('touch-jump',"SupertuxView.state.drawn.players[1].action.includes('jump')")
            assert await guest.evaluate('supertuxGuest.state.mask') == 0
            report['checks'].append('Both native players exist; ordinary remote movement and trusted touch Jump control Player 2 with neutral release')

            # Host-only placement visits the entire level's visible content.
            # Ghost mode makes this an artwork survey, not a completion claim.
            await script('sector.Tux.set_ghost_mode(true);sector.Tux2.set_ghost_mode(true);')
            for x,y in [(600,608),(2300,608),(4100,512),(6400,608),(7232,640),(8000,736),(9700,512),(10800,608)]:
                await script(f'sector.Tux.set_pos({x-160},{y});sector.Tux2.set_pos({x+160},{y});')
                # The native camera eases after a fixture teleport. Observe its
                # settled shared viewport, not the first frame at the new x.
                frame = await sample('survey-'+str(x),f'Math.abs(SupertuxView.state.drawn.players[1].x-{x+160})<5 && '+
                    'SupertuxView.state.drawn.players.every(p=>{const [x,y,s,w,h]=SupertuxView.state.drawn.camera;return (p.x-x)*s>-64 && (p.x-x)*s<w+64 && (p.y-y)*s>-64 && (p.y-y)*s<h+64;})')
                cx,cy,scale,width,height = frame['camera']
                assert all(-64<(p['x']-cx)*scale<width+64 and -64<(p['y']-cy)*scale<height+64 for p in frame['players'])
            textures = await guest.evaluate('[...levelTextures]')
            assert any('/creatures/spiky/spiky-' in path for path in textures)
            assert any('/creatures/spiky/spiky_sleep-' in path for path in textures)
            assert any('/creatures/iceblock/' in path for path in textures)
            report['checks'].append('Labelled ghost/placement artwork survey covers the level, smart blocks and both spiky families; the native shared camera retains both players')

            sleeper = next(e for e in initial['world']['entities'] if e[1]=='sspiky')
            await script('sector.Tux.set_pos(7072,704);sector.Tux2.set_pos(7136,704);sector.Tux.set_ghost_mode(false);sector.Tux2.set_ghost_mode(false);sector.Tux.set_is_intentionally_safe(true);sector.Tux2.set_is_intentionally_safe(true);')
            await sample('sleeping-spiky-walks',f'SupertuxView.state.drawn.world.entities.some(e=>e[0]==={sleeper[0]} && ["left","right"].includes(e[4])) && SupertuxView.state.drawn.world.draw.some(c=>c[0]===0 && c[1]==={sleeper[0]} && c[7][0].includes("/creatures/spiky/spiky-"))')
            report['checks'].append('Native proximity wakes the sleeping spiky into walking; guest receives the same stable UID and original animation')

            smart = next(e for e in initial['world']['entities'] if e[1]=='smartblock')
            await script('sector.Tux.set_pos(4192,512);sector.Tux2.set_pos(4240,512);')
            await sample('smart-block-active',f'SupertuxView.state.drawn.world.entities.some(e=>e[0]==={smart[0]} && ["left","right"].includes(e[4]))')
            async def stomp():
                current = await host.evaluate('(uid)=>levelPacket.world.entities.find(e=>e[0]===uid)',smart[0])
                assert current is not None
                direction = 1 if current[4]=='right' else -1
                return f'sector.Tux.set_pos({current[2]-96},{current[3]});sector.Tux2.set_pos({current[2]+direction*24},{current[3]-48});sector.Tux2.set_velocity(0,0);'
            await script(stomp)
            await sample('smart-block-flattened',f'SupertuxView.state.drawn.world.entities.some(e=>e[0]==={smart[0]} && e[4].startsWith("flat-")) && SupertuxView.state.drawn.world.draw.some(c=>c[0]===0 && c[1]==={smart[0]} && c[7][0].includes("smartblock-squished"))')
            report['checks'].append('Real falling-player contact flattens the smart ice block; its stable UID and squished artwork stay authoritative')

            await script('sector.Tux.set_pos(5500,544);sector.Tux2.set_pos(5600,544);sector.Tux.set_ghost_mode(false);sector.Tux2.set_ghost_mode(false);sector.Tux.set_is_intentionally_safe(true);sector.Tux2.set_is_intentionally_safe(true);')
            frame = await sample('before-coin')
            coin = next(e for e in frame['world']['entities'] if e[1]=='coin' and e[2]>5500)
            coins = frame['world']['coins']
            await script(f'sector.Tux.set_pos({coin[2]-96},{coin[3]});sector.Tux2.set_pos({coin[2]},{coin[3]});')
            collected = await sample('coin-collected',f'SupertuxView.state.drawn.world.coins>{coins} && !SupertuxView.state.drawn.world.entities.some(e=>e[0]==={coin[0]})')
            assert not any(c[1]==coin[0] for c in collected['world']['draw'])
            report['checks'].append('Real native coin collision updates shared coins and removes the same stable object/draw UID')

            await script('sector.Tux.set_pos(6080,608);sector.Tux2.set_pos(6192,608);sector.Tux2.set_velocity(0,0);')
            cover = await sample('secret-cover',"SupertuxView.state.drawn.world.draw.some(c=>c[0]===0 && c[2]===110)")
            await script('sector.Tux.set_pos(6432,672);sector.Tux2.set_pos(6448,672);')
            await sample('secret-fade',"!SupertuxView.state.drawn.world.draw.some(c=>c[0]===0 && c[2]===110 && c[4]>.01)")
            report['checks'].append('Native secret-area trigger fades its actual cover tilemap in the guest complete baseline')

            # Kill Player 2 before touching the untouched bell. Only Player 1
            # activates it; no guest Action or fixture revival is sent.
            await script('sector.Tux.set_pos(6384,512);sector.Tux2.kill(true);')
            fallen = await sample('dead-before-checkpoint',"SupertuxView.state.drawn.players[0].dead===0 && SupertuxView.state.drawn.players[1].dead===2 && SupertuxView.state.drawn.world.checkpoint===null")
            await script('sector.Tux.set_pos(6448,512);')
            checkpoint = await sample('checkpoint',"SupertuxView.state.drawn.world.checkpoint?.[0]===6448 && SupertuxView.state.drawn.players.every(p=>p.dead===0) && Math.abs(SupertuxView.state.drawn.players[1].x-SupertuxView.state.drawn.players[0].x)<5")
            assert checkpoint['epoch'] == fallen['epoch'], 'Revival must not restart the level'
            assert await host.evaluate('levelPacket.players.every(p=>p.dead===0)')
            await coop_smoke.ready_for_view_input(host,guest)
            revived_x = checkpoint['players'][1]['x']
            await guest.keyboard.down('ArrowRight')
            await sample('checkpoint-revived-move',f'SupertuxView.state.drawn.players[1].x>{revived_x+32}')
            await guest.keyboard.up('ArrowRight')
            report['checks'].append('Player 1 activates a fresh native bell and revives dead Player 2 on both screens without Action; ordinary guest input controls the revived player')

            # Standing at an already ringing bell cannot repeatedly revive a
            # teammate. The existing ordinary Action respawn still works.
            await script('sector.Tux2.kill(true);')
            await sample('dead-at-used-checkpoint',"SupertuxView.state.drawn.players[0].dead===0 && SupertuxView.state.drawn.players[1].dead===2 && SupertuxView.state.drawn.world.checkpoint?.[0]===6448")
            await script('sector.Tux.set_pos(6448,512);')
            await sample('used-checkpoint-no-revival',"SupertuxView.state.drawn.players[1].dead===2")
            await coop_smoke.ready_for_view_input(host,guest)
            await guest.keyboard.down('KeyK')
            await sample('used-checkpoint-action-respawn',"SupertuxView.state.drawn.players.every(p=>p.dead===0) && Math.abs(SupertuxView.state.drawn.players[1].x-SupertuxView.state.drawn.players[0].x)<5")
            await guest.keyboard.up('KeyK')
            report['checks'].append('An already activated checkpoint does not repeatedly revive a fallen teammate; ordinary Action respawn remains available')

            checkpoint = await sample('checkpoint-before-restart')
            epoch = checkpoint['epoch']
            await script('sector.Tux.kill(true);sector.Tux2.kill(true);')
            await sample('checkpoint-restart',f'SupertuxView.state.drawn.epoch>{epoch} && SupertuxView.state.drawn.players.every(p=>p.dead===0 && Math.abs(p.x-6448)<5)',timeout=45000)
            report['checks'].append('Real checkpoint activates; all-player death restarts both players with a fresh acknowledged epoch')

            generation = await guest.evaluate('supertuxGuest.state.generation')
            await guest.keyboard.down('ArrowRight')
            await host.evaluate("Module.supertuxShell.pause('Pause validation. Press Resume.')")
            await guest.wait_for_function('!SupertuxView.playable && supertuxGuest.state.mask===0')
            await guest.keyboard.up('ArrowRight')
            await host.locator('#start_button').tap()
            await guest.wait_for_function('SupertuxView.playable && supertuxGuest.state.mask===0')
            assert await guest.evaluate('supertuxGuest.state.generation') != generation
            for page in (host,guest): await page.set_viewport_size({'width':390,'height':844})
            await guest.wait_for_function('SupertuxView.playable && SupertuxView.state.drawn.camera[4]>SupertuxView.state.drawn.camera[3]')
            assert await guest.locator('[data-control="16"]').is_visible()
            await host.evaluate("Module.supertuxShell.pause('Paused for portrait evidence. Press Resume.')")
            await guest.wait_for_function('!SupertuxView.state.enabled')
            await host.locator('#canvas').screenshot(path=str(args.output/'portrait-host.png'))
            await guest.locator('#guest_canvas').screenshot(path=str(args.output/'portrait-guest.png'))
            await host.locator('#start_button').tap()
            await guest.wait_for_function('SupertuxView.playable')
            for page in (host,guest): await page.set_viewport_size({'width':844,'height':390})
            await guest.wait_for_function('SupertuxView.playable')
            report['checks'].append('Pause releases held input; trusted Resume uses a fresh generation; portrait and landscape continue with shared controls')

            # Place at the untouched end trigger, then allow the original
            # scripted walk to the stoptux trigger. Never call Level.finish.
            await script('sector.Tux.set_pos(11200,600);sector.Tux2.set_pos(11200,600);',resume=False)
            await guest.wait_for_function("SupertuxView.state.latest.world.phase==='finishing'",timeout=20000)
            await guest.wait_for_function('SupertuxView.state.outcome?.win===true',timeout=90000)
            assert not await guest.evaluate('SupertuxView.playable')
            assert await guest.evaluate('supertuxGuest.state.mask') == 0
            assert await guest.evaluate('indexedDB.databases().then(d=>d.length)') == 0
            def earned(node):
                return isinstance(node,list) and ((node and node[0]=='journey_begins.stl' and ['solved','#t'] in node[1:]) or any(earned(child) for child in node))
            # Result delivery precedes LevelsetScreen's native save on its next
            # setup. An initial unsolved file already exists: wait for this
            # level's earned flag, not merely the filename or a completed flush.
            deadline = time.monotonic()+15
            while True:
                saved = await host.evaluate("Module.FS.readFile(Module.supertuxStorage.root+'profile1/world1.stsg',{encoding:'utf8'})")
                if earned(sexp(saved)): break
                assert time.monotonic()<deadline,'Native completion did not save the second level as solved'
                await host.wait_for_timeout(100)
            report['earned_level_solved'] = True
            report['checks'].append('Original native end sequence completes the second level; guest releases controls and host owns earned campaign progression')
            report['snapshot_bytes_max'] = await guest.evaluate('levelBytes')
            assert report['snapshot_bytes_max'] <= 65536
            assert not any('Shared view artwork missing:' in line for line in logs)
            report['checks'].append('All observed draw textures resolve to verified content; complete snapshots stay below the existing 64 KiB relay bound')
            await host.locator('#coop_result_close').tap()
            await host.wait_for_function('Module.supertuxCoop.state.lost && !Module.supertuxShell.active')
            await host.evaluate('window.levelReloadMarker=true')
            await host.locator('#coop_restart').tap()
            await host.wait_for_function('!window.levelReloadMarker && window.Module?.supertuxReady && Module.supertuxStorage.state==="indexeddb"',timeout=180000)
            assert await host.evaluate("Module.FS.readFile(Module.supertuxStorage.root+'profile1/world1.stsg',{encoding:'utf8'})") == saved
            report['checks'].append('Close room / Return to title saves and hydrates earned second-level host progression; guests never create saves')
        except Exception as error:
            report['failure'] = str(error)
            report['diagnostic'] = dict(host=await host.evaluate('({state:Module?.supertuxCoop?.state,packet:window.levelPacket,active:Module?.supertuxShell?.active})'),
                                        guest=await guest.evaluate('({view:window.SupertuxView?.state,guest:window.supertuxGuest?.state})'))
            raise
        finally:
            report['errors'] = errors + [line for line in logs if re.search(r'Aborted\(|\[FATAL\]|runtime error:|AN ERROR HAS OCCURRED|Error waking VM|Squirrel exception:',line) and
                                        not (args.record_known_ub and any(re.search(pattern,line) for pattern in KNOWN_UPSTREAM_UB))]
            report['known_upstream_ub'] = [line for line in logs if 'runtime error:' in line and args.record_known_ub and any(re.search(pattern,line) for pattern in KNOWN_UPSTREAM_UB)]
            (args.output/'report.json').write_text(json.dumps(report,indent=2)+'\n')
            (args.output/'console.log').write_text('\n'.join(logs)+'\n')
            await hc.close();await gc.close();await hb.close();await gb.close()
    assert not report['errors'],report['errors']
    print(json.dumps({key:value for key,value in report.items() if key!='samples'},indent=2),flush=True)


if __name__ == '__main__':
    coop_smoke.run = run
    coop_smoke.main()
