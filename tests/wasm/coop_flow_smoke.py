#!/usr/bin/env python3
"""Same-room co-op results/replay/next using compiled gameplay and a real relay.

Host-only placement enters the original end triggers. This is not unassisted
phone traversal; native end sequences, saves and ordinary guest input are real.
"""
import asyncio
import json
import re
import sys
from pathlib import Path
from urllib.request import Request, urlopen
from playwright.async_api import async_playwright
from browser_smoke import KNOWN_UPSTREAM_UB
import coop_smoke
sys.path.insert(0, str(Path(__file__).parents[2] / 'tools/web'))
from coop_presentation import sexp


async def run(args, url):
    report = dict(engine=args.browser, configuration=json.loads((args.build/'BUILD_INFO.json').read_text()),
                  physical_device_tested=False, placement_fixtures=True, checks=[], errors=[], sessions=[])
    logs, errors, requests, room_requests, sockets = [], [], [], [], []
    html = urlopen(Request(url+'index.html', headers={'User-Agent':'SuperTux-Coop-Flow/1.0'}), timeout=30).read().decode()
    html = html.replace('var Module = {', 'var Module = {\narguments:["--verbose","--developer"],', 1)
    async with async_playwright() as p:
        launch = dict(args=['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader',
                            '--disable-gpu-compositing']) if args.browser=='chromium' else {}
        if args.webkit_executable: launch['executable_path']=args.webkit_executable
        hb = await getattr(p,args.browser).launch(**launch)
        gb = await getattr(p,args.browser).launch(**launch)
        report['browser'] = hb.version
        hc = await hb.new_context(viewport={'width':844,'height':390},has_touch=True)
        gc = await gb.new_context(viewport={'width':844,'height':390},has_touch=True)
        if args.browser=='chromium': await hc.grant_permissions(['local-network-access'])
        host, guest = await hc.new_page(), await gc.new_page()
        for page in (host,guest):
            page.set_default_timeout(30000)
            page.on('console',lambda message:logs.append(message.text))
            page.on('pageerror',lambda error:errors.append(str(error)))
            page.on('websocket',lambda socket:sockets.append(socket.url))
        host.on('request',lambda request:room_requests.append(request.url) if request.method=='POST' and request.url.endswith('/coop/rooms') else None)
        guest.on('request',lambda request:requests.append(request.url.split('#')[0]))
        await host.route('**/index.html',lambda route:route.fulfill(body=html,content_type='text/html'))
        try:
            await host.goto(url+'index.html')
            await host.wait_for_function('window.Module?.supertuxReady && Module.supertuxCoop.state.supportsRooms',timeout=180000)
            await host.locator('#start_button').tap()
            await host.wait_for_function("Module.ccall('get_browser_menu_state','number',[],[])===1")
            await host.locator('#coop_panel > summary').tap()
            await host.locator('#coop_create').tap()
            await host.wait_for_function("document.querySelector('#coop_status').textContent.includes('Room ready')")
            invitation = await host.locator('#coop_view_link').get_attribute('href')
            await guest.goto(invitation)
            await guest.wait_for_function('supertuxGuest.state.connected',timeout=120000)
            await host.wait_for_function('Module.supertuxCoop.state.guestReady')
            await host.evaluate('''() => {
              window.flowFrames=0;window.flowPacket=null;window.flowCommands=[];
              const status=Module.supertuxCoop.engineStatus,publish=Module.supertuxCoop.view,poll=Module.supertuxCoop.poll;
              Module.supertuxCoop.engineStatus=(...args)=>{++flowFrames;status(...args);};
              Module.supertuxCoop.view=frame=>{flowPacket=frame;publish(frame);};
              Module.supertuxCoop.poll=()=>{const cmd=poll();if(cmd?.[0]===6)flowCommands.push([...cmd]);return cmd;};
            }''')
            await host.locator('#coop_antarctica').tap()
            await guest.wait_for_function("SupertuxView.playable && SupertuxView.state.drawn.scene==='antarctica-v1'",timeout=45000)
            artwork_requests = len([r for r in requests if '/coop-art/' in r])

            async def key(name):
                for edge in ('down','up'):
                    await getattr(host.keyboard,edge)(name)
                    frame=await host.evaluate('flowFrames')
                    await host.wait_for_function('(frame)=>flowFrames>frame',arg=frame)

            async def script(command):
                await host.locator('#canvas').focus()
                await key('Escape')
                await host.wait_for_function("Module.ccall('get_browser_menu_state','number',[],[])===1")
                await key('Backquote');await host.keyboard.type(command,delay=4);await key('Enter')
                await host.wait_for_function('(text)=>document.querySelector("#output").textContent.includes(text)',arg='> '+command)
                await key('Backquote');await key('Escape')

            async def playable(scene):
                await guest.wait_for_function('(scene)=>SupertuxView.playable && SupertuxView.state.drawn.scene===scene',arg=scene,timeout=45000)
                await coop_smoke.ready_for_view_input(host,guest)
                frame=await guest.evaluate('SupertuxView.state.drawn')
                assert len(frame['players'])==2 and all(p['dead']==0 for p in frame['players'])
                assert frame['world']['checkpoint'] is None
                report['sessions'].append({'session':frame['session'],'epoch':frame['epoch'],'scene':scene})
                assert await host.locator('#coop_result').is_hidden()
                assert await guest.locator('#guest_result').is_hidden()
                x=frame['players'][1]['x']
                await guest.keyboard.down('ArrowRight')
                await guest.wait_for_function('(x)=>SupertuxView.state.drawn.players[1].x>x+24',arg=x)
                await guest.keyboard.up('ArrowRight')
                assert await guest.evaluate('supertuxGuest.state.mask')==0
                return frame

            async def complete(scene, fail_save=False):
                if fail_save:
                    await host.evaluate('window.flowSave=window.supertux_saveFiles;window.supertux_saveFiles=async()=>false')
                x=11200 if scene=='journey-v1' else 8960
                await script(f'sector.Tux.set_is_intentionally_safe(true);sector.Tux2.set_is_intentionally_safe(true);sector.Tux.set_pos({x},600);sector.Tux2.set_pos({x},600);sector.Tux.set_velocity(0,0);sector.Tux2.set_velocity(0,0);')
                await guest.wait_for_function('SupertuxView.state.outcome?.win===true',timeout=90000)
                await host.wait_for_function('Module.supertuxCoop.state.completion?.nativeReady && !Module.supertuxCoop.state.completion.saving')
                assert await host.locator('#coop_result').is_visible()
                assert await guest.locator('#guest_result').is_visible()
                assert not await guest.evaluate('SupertuxView.playable')
                assert await guest.evaluate('supertuxGuest.state.mask')==0
                return await host.evaluate('Module.supertuxCoop.state.completion')

            async def transition(button, target):
                old=await guest.evaluate('SupertuxView.state.latest')
                await guest.evaluate('window.flowReady=SupertuxView.onReady;window.flowHeld=null;SupertuxView.onReady=frame=>{flowHeld=frame;}')
                count=await host.evaluate('flowCommands.length')
                await host.locator(button).tap()
                await host.locator(button).dispatch_event('click')
                await guest.wait_for_function('(old)=>flowHeld?.session>old',arg=old['session'],timeout=45000)
                assert await host.evaluate('flowCommands.length')==count+1
                assert not await host.evaluate('Module.supertuxCoop.state.enabled')
                assert not await guest.evaluate('SupertuxView.playable')
                before=await host.evaluate('JSON.stringify(flowPacket.players.map(p=>[p.id,p.x,p.y,p.dead]))')
                await guest.keyboard.down('ArrowRight')
                await host.wait_for_timeout(400)
                assert await guest.evaluate('supertuxGuest.state.mask')==0
                assert await host.evaluate('JSON.stringify(flowPacket.players.map(p=>[p.id,p.x,p.y,p.dead]))')==before
                await guest.keyboard.up('ArrowRight')
                await guest.evaluate('SupertuxView.onReady=flowReady;flowReady(flowHeld)')
                frame=await playable(target)
                assert frame['session']>old['session']
                assert not await guest.evaluate('(old)=>SupertuxView.result({session:old.session,epoch:old.epoch,generation:old.generation,win:true})',old)
                current=frame['session'];ticks=await host.evaluate('flowFrames')
                await host.evaluate('(old)=>Module.supertuxCoop.enqueue([6,3,old.session,old.epoch])',old)
                await host.wait_for_function('(ticks)=>flowFrames>ticks+3',arg=ticks)
                assert await host.evaluate('flowPacket.session')==current
                assert await guest.evaluate('SupertuxView.playable')
                return frame

            await playable('antarctica-v1')
            first=await complete('antarctica-v1',fail_save=True)
            assert not first['saved'] and first['saveFailed']
            assert await host.locator('#coop_next').is_disabled()
            await host.locator('#coop_next').dispatch_event('click')
            assert await host.evaluate('flowCommands.length')==0
            await host.evaluate("Module.supertuxShell.pause('Paused at results. Press Resume.')")
            assert await host.locator('#coop_replay').is_disabled()
            await host.locator('#start_button').tap()
            await host.wait_for_function('Module.supertuxShell.active')
            await host.evaluate('window.supertux_saveFiles=window.flowSave')
            await host.locator('#coop_save_retry').tap()
            await host.wait_for_function('Module.supertuxCoop.state.completion.saved')
            # A synchronous pause wins the race before the native poll. Neither
            # screen may get stuck waiting for a level that was never started.
            await host.evaluate('''() => {
              document.querySelector('#coop_next').click();
              Module.supertuxShell.pause('Selection interrupted. Press Resume.');
            }''')
            assert not await host.evaluate('Module.supertuxCoop.state.starting')
            assert await host.evaluate('Module.supertuxCoop.state.completion.transition') is None
            assert await host.evaluate('flowCommands.length')==0
            await guest.wait_for_function('SupertuxView.state.outcome && !SupertuxView.state.transition')
            await host.locator('#start_button').tap()
            await host.wait_for_function('Module.supertuxShell.active && !document.querySelector("#coop_next").disabled')
            report['checks'].append('Native completion holds both screens; failed persistence, Retry saving and pause before native polling preserve the result and permit trusted Resume/retry')

            for width,height,label in [(844,390,'landscape'),(390,844,'portrait')]:
                for page in (host,guest):await page.set_viewport_size({'width':width,'height':height})
                for selector in ('#coop_replay','#coop_next','#coop_result_close'):
                    box=await host.locator(selector).bounding_box()
                    assert box and box['height']>=44 and box['x']>=0 and box['x']+box['width']<=width+1 and box['y']>=0 and box['y']+box['height']<=height+1
                await host.screenshot(path=str(args.output/(label+'-host-results.png')))
                await guest.screenshot(path=str(args.output/(label+'-guest-results.png')))
            for page in (host,guest):await page.set_viewport_size({'width':844,'height':390})
            report['checks'].append('Host choices and guest waiting screen fit portrait/landscape with readable text and 44-pixel touch targets; screenshots captured')

            await transition('#coop_replay','antarctica-v1')
            report['checks'].append('Replay starts the original level in the same room; duplicate taps start once, both players wait for the fresh baseline, and stale commands/results are ignored')
            await complete('antarctica-v1')
            await transition('#coop_next','journey-v1')
            report['checks'].append('Next level advances Welcome to Antarctica to The Journey Begins with two native players and ordinary guest input')
            await complete('journey-v1')
            assert await host.locator('#coop_next').is_hidden()
            assert await host.locator('#coop_result_end').is_visible()
            await host.screenshot(path=str(args.output/'final-level-results.png'))
            await transition('#coop_replay','journey-v1')
            report['checks'].append('The final supported level explains the preview boundary and can Replay without exposing an unsupported Next level')

            saved=await host.evaluate("Module.FS.readFile(Module.supertuxStorage.root+'profile1/world1.stsg',{encoding:'utf8'})")
            def earned(node,name):
                return isinstance(node,list) and ((node and node[0]==name and ['solved','#t'] in node[1:]) or any(earned(child,name) for child in node))
            assert all(earned(sexp(saved),name) for name in ('welcome_antarctica.stl','journey_begins.stl'))
            assert len(room_requests)==1 and len(sockets)==2 and guest.url==invitation
            assert len([r for r in requests if '/coop-art/' in r])==artwork_requests
            assert not any(re.search(r'\.wasm(?:$|\?)|\.data(?:$|\?)|/music/|supertux2\.js',r) for r in requests)
            assert await guest.evaluate('indexedDB.databases().then(d=>d.length)')==0
            assert len({s['session'] for s in report['sessions']})==4
            report['checks'].append('All four sessions share one invitation and two sockets; guest reuses verified art, downloads no game/runtime/music package and owns no save database')
            await host.locator('#coop_panel > summary').tap();await host.locator('#coop_close').tap()
            await host.wait_for_function('Module.supertuxCoop.state.lost && !Module.supertuxShell.active')
            await host.evaluate('window.flowReloadMarker=true')
            await host.locator('#coop_restart').tap()
            await host.wait_for_function('!window.flowReloadMarker && window.Module?.supertuxReady && Module.supertuxStorage.state==="indexeddb"',timeout=180000)
            assert await host.evaluate("Module.FS.readFile(Module.supertuxStorage.root+'profile1/world1.stsg',{encoding:'utf8'})")==saved
            report['checks'].append('Both earned completion records survive Replay, Next level, room close and a real IndexedDB-backed reload')
        except Exception as error:
            report['failure']=str(error)
            report['diagnostic']={'host':await host.evaluate('({state:Module?.supertuxCoop?.state,packet:window.flowPacket})'),
                                  'guest':await guest.evaluate('({view:window.SupertuxView?.state,input:window.supertuxGuest?.state})')}
            await host.screenshot(path=str(args.output/'failure-host.png'))
            await guest.screenshot(path=str(args.output/'failure-guest.png'))
            raise
        finally:
            report['errors']=errors+[line for line in logs if re.search(r'Aborted\(|\[FATAL\]|runtime error:|AN ERROR HAS OCCURRED|Error waking VM|Squirrel exception:',line) and
                                      not (args.record_known_ub and any(re.search(pattern,line) for pattern in KNOWN_UPSTREAM_UB))]
            report['known_upstream_ub']=[line for line in logs if 'runtime error:' in line and args.record_known_ub and any(re.search(pattern,line) for pattern in KNOWN_UPSTREAM_UB)]
            (args.output/'report.json').write_text(json.dumps(report,indent=2)+'\n')
            (args.output/'console.log').write_text('\n'.join(logs)+'\n')
            await hc.close();await gc.close();await hb.close();await gb.close()
    assert not report['errors'],report['errors']
    print(json.dumps(report,indent=2),flush=True)


if __name__=='__main__':
    coop_smoke.run=run
    coop_smoke.main()
