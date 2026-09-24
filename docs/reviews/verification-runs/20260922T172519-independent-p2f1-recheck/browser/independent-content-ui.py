#!/usr/bin/env python3
"""Independent P2-F1 check through actual DOM events on the production page."""
import importlib.util
import json
import pathlib
import subprocess
import tempfile
import threading
import time
import urllib.request

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parents[4]
spec = importlib.util.spec_from_file_location("content_browser", ROOT / "scripts/verification/browser-content-check.py")
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
port, cdp = 19011, 19012

def main():
    server = mod.http.server.ThreadingHTTPServer(("127.0.0.1", port), mod.H)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    profile = tempfile.mkdtemp(prefix="p2f1-independent-ui-")
    proc = subprocess.Popen([mod.CHROME, "--headless=new", f"--user-data-dir={profile}",
        f"--remote-debugging-port={cdp}", "--remote-allow-origins=*", "--no-first-run", "about:blank"],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    result = {}
    try:
        for _ in range(100):
            try:
                tabs = json.load(urllib.request.urlopen(f"http://127.0.0.1:{cdp}/json"))
                break
            except Exception:
                time.sleep(.1)
        c = mod.C(next(x for x in tabs if x.get("type") == "page")["webSocketDebuggerUrl"])
        c.e(f"location.href='http://127.0.0.1:{port}/index.html'; true")
        time.sleep(1.5)
        result = c.e(r"""(async () => {
          const a = window.__ATTENTION_INBOX__, ready = await a.ready(), s = a.state;
          const click = selector => { const el = document.querySelector(selector); if (!el) throw Error('missing '+selector); el.click(); };
          const tick = () => new Promise(resolve => setTimeout(resolve, 25));
          s.items = [{id:'item-p',title:'owned item',projectId:'p',status:'waiting',rev:3,createdAt:Date.now(),updatedAt:Date.now()}];
          s.projects = [{id:'p',name:'P1',color:'#1b6b4a'}]; s.notes = [];
          a.content.bind(); a.content.bind();
          click('[data-tab="notes"]'); click('#btnNewNote');
          const newOpened = document.querySelector('#sheetNote').classList.contains('open');
          document.querySelector('#noteTitle').value = 'UI note';
          document.querySelector('#noteBody').value = '<img src=x onerror=alert(1)> preview';
          click('#swNotePin'); click('#btnNotePreview');
          const preview = document.querySelector('#notePreview').innerHTML;
          click('#btnSaveNote'); await tick();
          const created = s.notes.length === 1 && s.notes[0].pinned === true;
          click('[data-note]');
          const editOpened = document.querySelector('#sheetNoteTitle').textContent === '编辑笔记';
          document.querySelector('#noteTitle').value = 'UI edited'; click('#btnSaveNote'); await tick();
          const edited = s.notes.length === 1 && s.notes[0].title === 'UI edited';
          click('#btnProjects');
          document.querySelector('#projName').value = 'UI project'; click('#btnAddProject'); await tick();
          const addedOnce = s.projects.filter(x => x.name === 'UI project').length === 1;
          click('[data-del-proj="p"]'); await tick();
          const confirmOpened = document.querySelector('#sheetConfirm').classList.contains('open');
          click('#confirmCancel'); await tick();
          const cancelPreserved = s.projects.some(x => x.id === 'p') && s.items[0].projectId === 'p' && s.items[0].rev === 3;
          click('[data-del-proj="p"]'); await tick(); click('#confirmOk'); await tick();
          const deleted = !s.projects.some(x => x.id === 'p') && s.items[0].projectId === '' && s.items[0].rev === 4;
          return { ready, newOpened, created, editOpened, edited, addedOnce, confirmOpened, cancelPreserved, deleted,
            previewEscaped: preview.includes('&lt;img') && !preview.includes('<img'), noteCount:s.notes.length, projectCount:s.projects.length };
        })()""")
    finally:
        proc.terminate()
        server.shutdown()
    (HERE / "independent-content-ui.json").write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps(result, ensure_ascii=False))
    return 0 if result and all(result.get(k) is True for k in (
        "ready", "newOpened", "created", "editOpened", "edited", "addedOnce", "confirmOpened",
        "cancelPreserved", "deleted", "previewEscaped")) else 1

if __name__ == "__main__":
    raise SystemExit(main())
