import subprocess, json, sys, time, xml.etree.ElementTree as ET
from pathlib import Path
from device import ADB, PKG, ROOT, cmd, ev

RUN_ID = ROOT.name
APK_HASH = "de9e63771d3caca0a454562dfd608b44a3d75743a45bff89c4c9ab3b3c19231c"

def run_diag(mode):
    d = ROOT / ('diag-' + mode)
    d.mkdir(parents=True, exist_ok=True)
    
    # 1. 启动非截断连续 logcat 采集
    logcat_file = open(d / 'continuous-logcat.txt', 'wb')
    logcat_proc = subprocess.Popen(ADB + ['logcat', '-v', 'threadtime,epoch'], stdout=logcat_file)
    print(f"[{mode}] Started continuous logcat PID {logcat_proc.pid}")
    
    def snap(label):
        snaps = {
            'screen': ('exec-out', 'screencap', '-p'),
            'trace': ('shell', 'run-as', PKG, 'cat', 'shared_prefs/alarm_trace.xml'),
            'delivery': ('shell', 'run-as', PKG, 'cat', 'shared_prefs/attention_alarm.xml'),
            'window': ('shell', 'dumpsys', 'window'),
            'alarm': ('shell', 'dumpsys', 'alarm'),
            'power': ('shell', 'dumpsys', 'power'),
            'notification': ('shell', 'dumpsys', 'notification')
        }
        for name, args in snaps.items():
            ext = '.png' if name == 'screen' else '.txt'
            p = subprocess.run(ADB + list(args), capture_output=True, timeout=30)
            (d / f"{label}-{name}{ext}").write_bytes(p.stdout)
    
    try:
        # 确保屏幕唤醒且 App 在前台
        cmd('shell', 'input', 'keyevent', 'KEYCODE_WAKEUP')
        cmd('shell', 'am', 'start', '-W', '-n', f"{PKG}/.MainActivity")
        time.sleep(2)
        
        # 获取时钟样本与环境
        initial_pid = cmd('shell', 'pidof', PKG).decode().strip().split()[0]
        uptime_raw = cmd('shell', 'cat', '/proc/uptime').decode().split()[0]
        wall_now = int(time.time() * 1000)
        
        # 创建待测排程事项 (30 秒后触发)
        lead_sec = 30
        target_at = wall_now + lead_sec * 1000
        item_id = f"diag-{mode}-{wall_now}"
        
        create_js = f"""
        (async () => {{
            const A = __ATTENTION_INBOX__;
            await A.ready();
            A.closeAllSheets();
            const it = A.makeItem({{
                id: {json.dumps(item_id)},
                title: '实机诊断 {mode}',
                priority: 'important',
                triggerAt: {target_at},
                status: 'waiting',
                isFallbackTrigger: false
            }});
            A.state.items.push(it);
            await A.saveAsync();
            await new Promise(r => setTimeout(r, 2500));
            return {{
                id: it.id,
                rev: it.rev,
                triggerAt: it.triggerAt,
                localTrigger: it.localTrigger,
                priority: it.priority,
                delivery_mode: it.delivery_mode,
                reminderEvents: it.reminderEvents
            }};
        }})()
        """
        item_meta = ev(create_js)
        (d / 'item.json').write_text(json.dumps(item_meta, ensure_ascii=False, indent=2))
        snap('scheduled')
        
        # 记录已分配的 token（防止后续高频响铃/窗口采样事件导致 stage: item 被循环容量淘汰）
        assigned_tokens = set()
        sched_trace = d / 'scheduled-trace.txt'
        if sched_trace.exists() and sched_trace.stat().st_size > 0:
            try:
                xml_root = ET.fromstring(sched_trace.read_text())
                raw_ev = xml_root.find("string[@name='events']")
                if raw_ev is not None and raw_ev.text:
                    for e in json.loads(raw_ev.text):
                        if e.get('detail') == item_id and 'token' in e:
                            assigned_tokens.add(e['token'])
            except Exception:
                pass
        
        # 转移到测试场景
        cmd('shell', 'input', 'keyevent', 'KEYCODE_HOME')
        cold_meta = None
        if mode == 'other':
            cmd('shell', 'am', 'start', '-a', 'android.settings.SETTINGS')
        elif mode == 'foreground':
            cmd('shell', 'am', 'start', '-W', '-n', f"{PKG}/.MainActivity")
        elif mode == 'asleep':
            cmd('shell', 'input', 'keyevent', 'KEYCODE_SLEEP')
        elif mode == 'cold':
            cold_pid = cmd('shell', 'pidof', PKG).decode().strip()
            cmd('shell', 'run-as', PKG, '/system/bin/kill', '-9', cold_pid)
            remaining_pid = subprocess.run(ADB + ['shell', 'pidof', PKG], capture_output=True).stdout.decode().strip()
            cold_meta = {
                'method': 'kill -9 injection via run-as (non-force-stop)',
                'killedPid': cold_pid,
                'remainingPid': remaining_pid
            }
            (d / 'cold-meta.json').write_text(json.dumps(cold_meta, indent=2))
            cmd('shell', 'input', 'keyevent', 'KEYCODE_SLEEP')
        
        print(f"[{mode}] ARMED: item={item_id} target={target_at} ({time.strftime('%H:%M:%S', time.localtime(target_at/1000))}) tokens={assigned_tokens}")
        
        # 监控时间窗口：到点后 +3, +10, +30, +60, +120 秒
        seen = []
        delays = [3, 10, 30, 60, 120]
        observed_received = False
        observed_visible = False
        last_delay = 0
        
        for delay in delays:
            last_delay = delay
            now = time.time()
            target_epoch = target_at / 1000.0 + delay
            if now < target_epoch:
                time.sleep(target_epoch - now)
            
            snap(f"due-{delay}")
            trace_path = d / f"due-{delay}-trace.txt"
            if trace_path.exists() and trace_path.stat().st_size > 0:
                try:
                    xml_root = ET.fromstring(trace_path.read_text())
                    raw_ev = xml_root.find("string[@name='events']")
                    if raw_ev is not None and raw_ev.text:
                        events = json.loads(raw_ev.text)
                        for e in events:
                            if e not in seen:
                                seen.append(e)
                except Exception as ex:
                    pass
            
            # 匹配此 item 的所有 trace 事件（通过已锁定的 assigned_tokens 或当前看到的关联）
            for e in seen:
                if e.get('detail') == item_id and 'token' in e:
                    assigned_tokens.add(e['token'])
            matched = [e for e in seen if e.get('token') in assigned_tokens]
            
            observed_received = any(e.get('stage') == 'received' for e in matched)
            observed_visible = any(e.get('stage') == 'windowVisible' for e in matched)
            print(f"[{mode}] OBSERVED +{delay}s: received={observed_received}, visible={observed_visible}")
            if observed_visible:
                break
        
        # 记录未主动打开 App 前的接收状态
        unopened_received = observed_received
        unopened_visible = observed_visible
        
        # 若未接收，现在打开 App 检查是否才开始收到（证实是否被系统延迟至前台）
        cmd('shell', 'input', 'keyevent', 'KEYCODE_WAKEUP')
        cmd('shell', 'am', 'start', '-W', '-n', f"{PKG}/.MainActivity")
        time.sleep(3)
        snap('after-open')
        
        after_open_trace = d / 'after-open-trace.txt'
        after_open_seen = []
        if after_open_trace.exists() and after_open_trace.stat().st_size > 0:
            try:
                xml_root = ET.fromstring(after_open_trace.read_text())
                raw_ev = xml_root.find("string[@name='events']")
                if raw_ev is not None and raw_ev.text:
                    after_open_seen = json.loads(raw_ev.text)
            except Exception:
                pass
        
        for e in after_open_seen:
            if e.get('detail') == item_id and 'token' in e:
                assigned_tokens.add(e['token'])
        matched_after = [e for e in after_open_seen if e.get('token') in assigned_tokens]
        received_after_open = any(e.get('stage') == 'received' for e in matched_after)
        
        # 清理事项与投递
        cleanup_res = ev(f"""
        (async () => {{
            const A = __ATTENTION_INBOX__;
            await A.ready();
            await A.completeItem({json.dumps(item_id)});
            await A.saveAsync();
            const B = Capacitor.Plugins.SystemBridge;
            const active = await B.activeAlarmDeliveries();
            for (const x of active.alarms || []) {{
                if (x.itemId === {json.dumps(item_id)}) {{
                    await B.stopAlarmDelivery({{ id: x.id, token: x.token }});
                }}
            }}
            return {{
                completed: true,
                remainingActive: await B.activeAlarmDeliveries()
            }};
        }})()
        """)
        (d / 'cleanup.json').write_text(json.dumps(cleanup_res, ensure_ascii=False, indent=2))
        
        # 汇总结论
        result = {
            'mode': mode,
            'runId': RUN_ID,
            'apkHash': APK_HASH,
            'itemId': item_id,
            'targetAt': target_at,
            'initialPid': initial_pid,
            'coldMeta': cold_meta,
            'observedDelay': last_delay,
            'unopenedReceived': unopened_received,
            'unopenedVisible': unopened_visible,
            'receivedAfterOpen': received_after_open,
            'matchedEvents': matched_after or matched
        }
        (d / 'result.json').write_text(json.dumps(result, ensure_ascii=False, indent=2))
        print(f"[{mode}] FINISHED: unopenedReceived={unopened_received}, receivedAfterOpen={received_after_open}")
        return result
        
    finally:
        # 停止连续 logcat
        logcat_proc.terminate()
        try:
            logcat_proc.wait(timeout=5)
        except Exception:
            logcat_proc.kill()
        logcat_file.close()
        print(f"[{mode}] Closed continuous logcat.")

if __name__ == '__main__':
    mode = sys.argv[1]
    res = run_diag(mode)
    print(json.dumps(res, ensure_ascii=False, indent=2))
