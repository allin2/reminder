#!/usr/bin/env python3
import json
import sys
import time

import websocket


class Cdp:
    def __init__(self, url):
        self.ws = websocket.create_connection(url, timeout=25, suppress_origin=True)
        self.seq = 0

    def call(self, method, params=None):
        self.seq += 1
        ident = self.seq
        self.ws.send(json.dumps({"id": ident, "method": method, "params": params or {}}))
        while True:
            msg = json.loads(self.ws.recv())
            if msg.get("id") == ident:
                return msg

    def evaluate(self, expression):
        reply = self.call("Runtime.evaluate", {
            "expression": expression,
            "returnByValue": True,
            "awaitPromise": True
        })
        result = reply.get("result", {})
        if result.get("exceptionDetails"):
            raise RuntimeError(json.dumps(result["exceptionDetails"], ensure_ascii=False))
        return result.get("result", {}).get("value")

    def evaluate_json(self, expression):
        return json.loads(self.evaluate(expression))

    def reload(self):
        self.call("Page.reload", {"ignoreCache": True})
        time.sleep(6)


def main():
    if len(sys.argv) != 2:
        raise SystemExit("usage: targeted-cdp-check.py <websocket-url>")
    cdp = Cdp(sys.argv[1])
    cdp.call("Runtime.enable")
    temp_id = "dv-edit-grilling-20260920"

    initial = cdp.evaluate_json(r"""(async()=>{
      const A = window.__ATTENTION_INBOX__;
      await A.ready();
      const F = window.AttentionLib && window.AttentionLib.Feedback;
      const originalMode = A.state.settings.userMode || "beginner";
      A.setUserMode("normal");
      await A.saveAsync();
      const normalMode = document.body.classList.contains("mode-normal");
      const homeSetupVisible = getComputedStyle(document.querySelector("#homeSetup")).display !== "none";
      A.setUserMode(originalMode);
      await A.saveAsync();
      const visited = F.setupSteps(
        {notifications:"granted", exactAlarm:"granted", overlay:"denied", fullScreenIntent:"denied"},
        {backgroundVisited:true, overlayVisited:true}
      );
      const missed = F.setupSteps({}, {
        testRun:{startedAt:1000, feedbackAt:1100},
        testFeedback:{value:"missed", at:1100}
      }).steps.find(s=>s.id==="test");
      return JSON.stringify({
        beforeCount:A.state.items.length,
        beforeIds:A.state.items.map(i=>i.id).sort(),
        originalMode,
        normalMode,
        homeSetupVisible,
        modeRestored:A.state.settings.userMode===originalMode,
        backgroundVisitedNotVerified:(()=>{
          const s=visited.steps.find(x=>x.id==="background");
          return s.done===true && s.verified===false;
        })(),
        overlayVisitedNotVerified:(()=>{
          const s=visited.steps.find(x=>x.id==="overlay");
          return s.done===true && s.verified===false;
        })(),
        missedIsResultNotPass:missed.done===true && missed.verified===false,
        honestCopy:document.body.innerText.includes("为什么建议检查") &&
          document.body.innerText.includes("以本机 60 秒测试为准")
      });
    })()""")

    created = cdp.evaluate_json(r"""(async()=>{
      const A = window.__ATTENTION_INBOX__;
      await A.ready();
      const id = "dv-edit-grilling-20260920";
      A.state.items = A.state.items.filter(i=>i.id!==id);
      const at = Math.floor((Date.now()+86400000)/60000)*60000;
      const d = new Date(at - new Date(at).getTimezoneOffset()*60000);
      const localTrigger = d.toISOString().slice(0,16);
      A.state.items.push(A.makeItem({
        id, title:"DV original title", status:"waiting", priority:"normal",
        triggerAt:at, scheduleBasis:"wall-clock", localTrigger
      }));
      await A.saveAsync();
      A.openEditItem(id);
      document.querySelector("#capText").value = "DV edited title";
      A.saveItemFromForm();
      await new Promise(r=>setTimeout(r,1000));
      await A.saveAsync();
      const item=A.state.items.find(i=>i.id===id);
      return JSON.stringify({
        triggerAt:at,
        localTrigger,
        title:item&&item.title,
        triggerPreserved:!!item&&item.triggerAt===at,
        localTriggerPreserved:!!item&&item.localTrigger===localTrigger,
        count:A.state.items.length
      });
    })()""")

    cdp.reload()
    persisted = cdp.evaluate_json(r"""(async()=>{
      const A=window.__ATTENTION_INBOX__;
      await A.ready();
      const item=A.state.items.find(i=>i.id==="dv-edit-grilling-20260920");
      return JSON.stringify({
        exists:!!item,
        title:item&&item.title,
        triggerAt:item&&item.triggerAt,
        localTrigger:item&&item.localTrigger
      });
    })()""")

    cleanup = cdp.evaluate_json(r"""(async()=>{
      const A=window.__ATTENTION_INBOX__;
      await A.ready();
      A.state.items=A.state.items.filter(i=>i.id!=="dv-edit-grilling-20260920");
      await A.saveAsync();
      return JSON.stringify({remaining:A.state.items.length});
    })()""")
    cdp.reload()
    restored = cdp.evaluate_json(r"""(async()=>{
      const A=window.__ATTENTION_INBOX__;
      await A.ready();
      return JSON.stringify({
        count:A.state.items.length,
        ids:A.state.items.map(i=>i.id).sort(),
        tempExists:A.state.items.some(i=>i.id==="dv-edit-grilling-20260920")
      });
    })()""")
    cdp.ws.close()

    result = {
        "beforeCount": initial["beforeCount"],
        "mode": {
            "normalApplied": initial["normalMode"],
            "homeSetupVisible": initial["homeSetupVisible"],
            "restored": initial["modeRestored"],
        },
        "setupSemantics": {
            "backgroundVisitedNotVerified": initial["backgroundVisitedNotVerified"],
            "overlayVisitedNotVerified": initial["overlayVisitedNotVerified"],
            "missedIsResultNotPass": initial["missedIsResultNotPass"],
            "honestCopy": initial["honestCopy"],
        },
        "edit": {
            "titleUpdated": created["title"] == "DV edited title",
            "triggerPreservedBeforeReload": created["triggerPreserved"],
            "localTriggerPreservedBeforeReload": created["localTriggerPreserved"],
            "persistedAcrossReload": (
                persisted["exists"]
                and persisted["title"] == "DV edited title"
                and persisted["triggerAt"] == created["triggerAt"]
                and persisted["localTrigger"] == created["localTrigger"]
            ),
        },
        "cleanup": {
            "temporaryItemRemoved": not restored["tempExists"],
            "countRestored": restored["count"] == initial["beforeCount"],
            "identitySetRestored": restored["ids"] == initial["beforeIds"],
            "remainingAfterDelete": cleanup["remaining"],
        },
    }
    result["pass"] = all([
        *result["mode"].values(),
        *result["setupSemantics"].values(),
        *result["edit"].values(),
        result["cleanup"]["temporaryItemRemoved"],
        result["cleanup"]["countRestored"],
        result["cleanup"]["identitySetRestored"],
    ])
    print(json.dumps(result, ensure_ascii=False, indent=2))
    raise SystemExit(0 if result["pass"] else 1)


if __name__ == "__main__":
    main()
