#!/usr/bin/env python3
"""The Somewhat Smaller Bath: real host, guest and relay; labelled placement fixtures.

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
            await host.locator('#coop_level').select_option('4')
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
              window.levelTextures=new Set();window.levelBytes=0;window.levelCompact=false;
              const accept=SupertuxView.accept;
              SupertuxView.accept=frame=>{
                if(frame.scene==='bath-v1') {
                  levelBytes=Math.max(levelBytes,new TextEncoder().encode(JSON.stringify(frame)).length);
                  levelCompact ||= frame.world.draw.some(c=>c[0]===0 && c[7].length===6);
                  for(const c of frame.world.draw)if(c[0]===0)levelTextures.add(c[7][0]);
                }
                return accept(frame);
              };
            }''')
            await host.locator('#coop_antarctica').tap()
            await guest.wait_for_function("heldBaseline?.scene==='bath-v1'",timeout=45000)
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
            report['checks'].append('Normal host selector starts the original third level; a deliberately delayed guest baseline holds native physics/input; guest fetches artwork only')

            async def key(name):
                for edge in ('down','up'):
                    await getattr(host.keyboard,edge)(name)
                    frame = await host.evaluate('levelFrames')
                    await host.wait_for_function('(frame)=>levelFrames>frame',arg=frame)

            async def sample(label, predicate='true', timeout=20000):
                await guest.wait_for_function('SupertuxView.playable && ('+predicate+')',timeout=timeout)
                value = await guest.evaluate('SupertuxView.state.drawn')
                report.setdefault('samples',{})[label] = value
                with (args.output/'progress.jsonl').open('a') as progress:
                    progress.write(json.dumps({'sample':label,'session':value['session'],'epoch':value['epoch'],'sequence':value['sequence']})+'\n')
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

            initial = await sample('initial',"SupertuxView.state.drawn.scene==='bath-v1'")
            assert {'captainsnowball','fish-harmless','fish-swimming','unstable_tile','firefly','coin'} <= {e[1] for e in initial['world']['entities']}
            await coop_smoke.ready_for_view_input(host,guest)
            x=initial['players'][1]['x']
            await guest.keyboard.down('ArrowRight')
            await sample('land-move',f'SupertuxView.state.drawn.players[1].x>{x+32}')
            await guest.keyboard.up('ArrowRight')
            await guest.locator('[data-control="16"]').tap()
            await sample('touch-jump',"SupertuxView.state.drawn.players[1].action.includes('jump')")
            assert await guest.evaluate('supertuxGuest.state.mask')==0
            report['checks'].append('Ordinary guest movement and touch Jump control native Player 2 independently at the real third-level spawn')

            await script('sector.Tux.set_is_intentionally_safe(true);sector.Tux2.set_is_intentionally_safe(true);sector.Tux.set_pos(1408,1024);sector.Tux2.set_pos(1280,1024);sector.Tux.set_velocity(0,0);sector.Tux2.set_velocity(0,0);')
            water=await sample('underwater',"SupertuxView.state.drawn.players.every(p=>/-(float|swim)-/.test(p.action))")
            await coop_smoke.ready_for_view_input(host,guest)
            # A real browser pointer press exercises the on-screen control and
            # native pointer capture in both engines. Synthetic pointer IDs do
            # not establish an active pointer and cannot be captured.
            up=guest.locator('[data-control="4"]')
            await up.hover();await guest.mouse.down()
            await sample('swim-touch-up',f'SupertuxView.state.drawn.players[1].y<{water["players"][1]["y"]-24}')
            await guest.mouse.up()
            await guest.wait_for_function('supertuxGuest.state.mask===0')
            water=await sample('before-swim-down')
            await guest.keyboard.down('ArrowDown');await guest.keyboard.down('ArrowRight');await guest.keyboard.down('Space')
            angled=await sample('swim-diagonal-boost',f'SupertuxView.state.drawn.players[1].y>{water["players"][1]["y"]+24} && SupertuxView.state.drawn.players[1].x>{water["players"][1]["x"]+24} && Math.abs(SupertuxView.state.drawn.players[1].angle)>5')
            for keyname in ('ArrowDown','ArrowRight','Space'):await guest.keyboard.up(keyname)
            assert await guest.evaluate('supertuxGuest.state.mask')==0
            uid=angled['world']['playerUids'][1]
            assert any(c[0]==0 and c[1]==uid and any(abs(q[8])>5 for q in c[7][3]) for c in angled['world']['draw'])
            await host.locator('#canvas').screenshot(path=str(args.output/'underwater-host.png'))
            await guest.wait_for_function("SupertuxView.playable && document.querySelector('#guest_canvas').style.opacity==='1'")
            await guest.locator('#guest_canvas').screenshot(path=str(args.output/'underwater-guest.png'))
            report['checks'].append('Underwater on-screen Up and directional-plus-Jump input swim Player 2; rotated native swim quads reach the guest and all input releases')

            await script('sector.Tux.set_pos(4416,864);sector.Tux2.set_pos(4608,864);sector.Tux.set_velocity(0,0);sector.Tux2.set_velocity(0,0);')
            fish=await sample('fish',"SupertuxView.state.drawn.players.every(p=>/-(float|swim)-/.test(p.action)) && SupertuxView.state.drawn.world.draw.some(c=>c[0]===0 && c[7][0].includes('/fish/ice/swim_blue-')) && SupertuxView.state.drawn.world.draw.some(c=>c[0]===0 && c[7][0].includes('/fish/ice/swim_orange-'))")
            blue=next(e for e in fish['world']['entities'] if e[1]=='fish-swimming' and abs(e[2]-4352)<300)
            await sample('fish-move',f'SupertuxView.state.drawn.world.entities.some(e=>e[0]==={blue[0]} && Math.hypot(e[2]-{blue[2]},e[3]-{blue[3]})>4)')
            await host.locator('#canvas').screenshot(path=str(args.output/'fish-host.png'))
            await guest.wait_for_function("SupertuxView.playable && document.querySelector('#guest_canvas').style.opacity==='1'")
            await guest.locator('#guest_canvas').screenshot(path=str(args.output/'fish-guest.png'))
            report['checks'].append('Dangerous blue and harmless gold fish have verified artwork, native stable IDs and moving authoritative positions on both screens')

            await script('sector.Tux.set_pos(1600,1152);sector.Tux2.set_pos(1648,1152);sector.Tux.set_velocity(0,0);sector.Tux2.set_velocity(0,0);')
            coins=await sample('path-coins')
            coin=next(e for e in coins['world']['entities'] if e[1]=='coin' and 1700<e[2]<2000 and e[3]>1000)
            await sample('path-coin-move',f'SupertuxView.state.drawn.world.entities.some(e=>e[0]==={coin[0]} && Math.hypot(e[2]-{coin[2]},e[3]-{coin[3]})>4)')
            before=coins['world']['coins']
            async def collect_coin():
                entity=await host.evaluate('(uid)=>levelPacket.world.entities.find(e=>e[0]===uid)',coin[0])
                return f'sector.Tux2.set_pos({entity[2]},{entity[3]});sector.Tux2.set_velocity(0,0);'
            await script(collect_coin)
            collected=await sample('path-coin-collected',f'SupertuxView.state.drawn.world.coins>{before} && !SupertuxView.state.drawn.world.entities.some(e=>e[0]==={coin[0]})')
            assert not any(c[1]==coin[0] for c in collected['world']['draw'])
            report['checks'].append('A path-driven coin moves, then native collision increases shared coins and removes its stable object/draw ID')

            await script('sector.Tux.set_pos(7744,288);sector.Tux2.set_pos(7812,288);sector.Tux.set_velocity(0,0);sector.Tux2.set_velocity(0,0);')
            ice=await sample('collapsing-ice',"SupertuxView.state.drawn.world.entities.some(e=>e[1]==='unstable_tile' && e[2]===7808 && e[4]==='dissolve')")
            tile=next(e for e in ice['world']['entities'] if e[1]=='unstable_tile' and e[2]==7808)
            await sample('ice-collapsed',f'SupertuxView.state.drawn.players[1].y>416 && !SupertuxView.state.drawn.world.draw.some(c=>c[1]==={tile[0]} && c[4]>.01)')
            report['checks'].append('Player 2 lands on original unstable ice; the same native tile UID dissolves/fades and allows the player to fall through')

            await script('sector.Tux.set_pos(10400,576);sector.Tux2.set_pos(10448,576);sector.Tux.set_velocity(0,0);sector.Tux2.set_velocity(0,0);')
            await sample('secret-cover',"SupertuxView.state.drawn.world.draw.some(c=>c[0]===0 && c[2]===110 && c[4]>.5)")
            await script('sector.Tux.set_pos(10608,704);sector.Tux2.set_pos(10640,704);')
            await sample('secret-fade',"!SupertuxView.state.drawn.world.draw.some(c=>c[0]===0 && c[2]===110 && c[4]>.01)")
            report['checks'].append('The third level secret trigger fades its original cover tilemap in the complete shared view')

            await script('sector.Tux.set_pos(6288,576);sector.Tux.set_velocity(0,0);sector.Tux2.kill(true);')
            fallen=await sample('fallen-before-bell',"SupertuxView.state.drawn.players[1].dead===2 && SupertuxView.state.drawn.world.checkpoint===null")
            await script('sector.Tux.set_pos(6336,576);')
            checkpoint=await sample('checkpoint-revival',"SupertuxView.state.drawn.world.checkpoint?.[0]===6336 && SupertuxView.state.drawn.players.every(p=>p.dead===0) && Math.abs(SupertuxView.state.drawn.players[1].x-SupertuxView.state.drawn.players[0].x)<5")
            assert checkpoint['epoch']==fallen['epoch']
            epoch=checkpoint['epoch']
            await script('sector.Tux.kill(true);sector.Tux2.kill(true);')
            await sample('checkpoint-restart',f'SupertuxView.state.drawn.epoch>{epoch} && SupertuxView.state.drawn.players.every(p=>p.dead===0 && Math.abs(p.x-6336)<5)',timeout=45000)
            report['checks'].append('The real third-level bell revives fallen Player 2 without Action; all-player death restarts both at its checkpoint with a fresh acknowledged epoch')

            await script('sector.Tux.set_ghost_mode(true);sector.Tux2.set_ghost_mode(true);')
            in_view='SupertuxView.state.drawn.players.every(p=>{const [x,y,s,w,h]=SupertuxView.state.drawn.camera;return (p.x-x)*s>-64 && (p.x-x)*s<w+64 && (p.y-y)*s>-64 && (p.y-y)*s<h+64;})'
            await script('sector.Tux.set_pos(4416,864);sector.Tux2.set_pos(4416,1120);')
            spread=await sample('vertical-spread',"SupertuxView.state.drawn.camera[2]<.8 && SupertuxView.state.drawn.players.every(p=>{const [x,y,s,w,h]=SupertuxView.state.drawn.camera;return (p.x-x)*s>=0 && (p.x+32-x)*s<=w && (p.y-y)*s>=0 && (p.y+32-y)*s<=h;})")
            await host.wait_for_timeout(400)
            assert await guest.evaluate("SupertuxView.playable && SupertuxView.state.latest.scene==='bath-v1'")
            report['zoom_scale']=spread['camera'][2]
            assert await guest.evaluate('levelCompact')
            report['checks'].append('A 256-pixel vertical separation zooms the native shared camera below .8 while both players remain visible; lossless compact batches keep the scene within unchanged relay/quad bounds')
            for x,y in [(128,640),(1408,1024),(3840,864),(6400,640),(7808,288),(10496,640),(11840,640)]:
                await script(f'sector.Tux.set_pos({x},{y});sector.Tux2.set_pos({x+160},{y});')
                await sample('survey-'+str(x),f'Math.abs(SupertuxView.state.drawn.players[1].x-{x+160})<5 && '+in_view)
            await script('sector.Tux.set_ghost_mode(false);sector.Tux2.set_ghost_mode(false);sector.Tux.set_is_intentionally_safe(true);sector.Tux2.set_is_intentionally_safe(true);sector.Tux.set_pos(1408,1024);sector.Tux2.set_pos(1280,1024);')
            await sample('water-after-survey',"SupertuxView.state.drawn.players.every(p=>/-(float|swim)-/.test(p.action))")
            report['checks'].append('Labelled camera/artwork survey spans land, water, collapsing ice and the exit approach while the shared camera includes both players')

            await coop_smoke.ready_for_view_input(host,guest)
            generation=await guest.evaluate('supertuxGuest.state.generation')
            await guest.keyboard.down('ArrowDown')
            await host.evaluate("Module.supertuxShell.pause('Paused underwater. Press Resume.')")
            await guest.wait_for_function('!SupertuxView.playable && supertuxGuest.state.mask===0')
            await guest.keyboard.up('ArrowDown');await host.locator('#start_button').tap()
            await guest.wait_for_function('SupertuxView.playable && supertuxGuest.state.mask===0')
            assert await guest.evaluate('supertuxGuest.state.generation')!=generation
            for page in (host,guest):await page.set_viewport_size({'width':390,'height':844})
            await guest.wait_for_function('SupertuxView.playable && SupertuxView.state.drawn.camera[4]>SupertuxView.state.drawn.camera[3]')
            await host.locator('#canvas').screenshot(path=str(args.output/'portrait-host.png'))
            await guest.wait_for_function("SupertuxView.playable && document.querySelector('#guest_canvas').style.opacity==='1'")
            await guest.locator('#guest_canvas').screenshot(path=str(args.output/'portrait-guest.png'))
            for page in (host,guest):await page.set_viewport_size({'width':844,'height':390})
            await guest.wait_for_function('SupertuxView.playable')
            report['checks'].append('Underwater Pause releases held controls; trusted Resume requires a new generation; portrait/landscape retain usable controls and a shared view')

            await script('sector.Tux.set_pos(12160,640);sector.Tux2.set_pos(12160,640);',resume=False)
            await guest.wait_for_function("SupertuxView.state.latest.world.phase==='finishing'",timeout=20000)
            await guest.wait_for_function('SupertuxView.state.outcome?.win===true',timeout=90000)
            await host.wait_for_function('Module.supertuxCoop.state.completion?.saved')
            assert await host.locator('#coop_next').is_hidden()
            assert await host.locator('#coop_result_end').is_visible()
            assert await guest.evaluate('supertuxGuest.state.mask')==0
            assert await guest.evaluate('indexedDB.databases().then(d=>d.length)')==0
            saved=await host.evaluate("Module.FS.readFile(Module.supertuxStorage.root+'profile1/world1.stsg',{encoding:'utf8'})")
            def earned(node):
                return isinstance(node,list) and ((node and node[0]=='somewhat_smaller_bath.stl' and ['solved','#t'] in node[1:]) or any(earned(child) for child in node))
            assert earned(sexp(saved))
            report['earned_level_solved']=True
            report['snapshot_bytes_max']=await guest.evaluate('levelBytes')
            report['compact_batches_seen']=await guest.evaluate('levelCompact')
            assert report['snapshot_bytes_max']<=65536
            assert not any('Shared view artwork missing:' in line for line in logs)
            report['checks'].append('Original exit sequence completes Bath, saves its earned record and shows Replay/end-of-preview; all observed textures resolve within the 64 KiB snapshot bound')
            await host.locator('#coop_result_close').tap()
            await host.wait_for_function('Module.supertuxCoop.state.lost && !Module.supertuxShell.active')
            await host.evaluate('window.levelReloadMarker=true')
            await host.locator('#coop_restart').tap()
            await host.wait_for_function('!window.levelReloadMarker && window.Module?.supertuxReady && Module.supertuxStorage.state==="indexeddb"',timeout=180000)
            assert await host.evaluate("Module.FS.readFile(Module.supertuxStorage.root+'profile1/world1.stsg',{encoding:'utf8'})")==saved
            report['checks'].append('Close/Return to title durably hydrates earned Bath progression after a real reload; Player 2 never owns saves')
        except Exception as error:
            report['failure'] = str(error)
            report['diagnostic'] = dict(host=await host.evaluate('({state:Module?.supertuxCoop?.state,packet:window.levelPacket,active:Module?.supertuxShell?.active})'),
                                        guest=await guest.evaluate('({view:window.SupertuxView?.state,guest:window.supertuxGuest?.state})'))
            await host.screenshot(path=str(args.output/'failure-host.png'))
            await guest.screenshot(path=str(args.output/'failure-guest.png'))
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
