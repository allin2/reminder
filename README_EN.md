# Attention Inbox (安心收件箱)

> **Remember less. Miss nothing.**  
> *Local-first attention wakeup and future commitment custody.*

[English](./README_EN.md) | [简体中文](./README.md)

[![Tests](https://img.shields.io/badge/Tests-862%20passed-1b6b4a.svg)](#verification--testing)
[![Architecture](https://img.shields.io/badge/Architecture-Local--first%20%7C%20Zero--build-3d5a80.svg)](#architecture--file-map)
[![Platform](https://img.shields.io/badge/Platform-Web%20PWA%20%7C%20Android-9a6b12.svg)](#android-app--packaging)
[![License](https://img.shields.io/badge/License-Noncommercial-muted.svg)](#credits--license)

---

## Why Attention Inbox?

Have you ever felt this way:
- Your Todo lists (Todoist, TickTick) grow endlessly. Opening the app greets you with a wall of tasks, triggering hoarding anxiety;
- In an effort not to miss anything, you are forced to categorize, tag, assign priorities, manage kanban boards, and time-block—**the management tool itself becomes a heavy cognitive tax**;
- A reminder notification pops up, you swipe it away without thinking (or open it for a second), only to completely forget about it later;
- Or simply because you're busy at that moment, you tap "Done" prematurely to silence the ping, accidentally archiving an unfinished item forever.

**Attention Inbox is not another complex Todo app, nor a project management board.**  
Its sole purpose is: **to let you hand over things you need to pay attention to in the future at near-zero friction, then completely and safely forget about them; when the right time arrives, the system will reliably wake up your attention with sufficient intensity and rigorously confirm whether you have actually seen it.**

---

## Six Core Principles & Usage Logics

```text
┌─────────────────────────────────────────────────────────────┐
│                    Capture (Instant Capture)                │
│         Natural language · Fuzzy input never blocked        │
└──────────────┬──────────────────────────────┬───────────────┘
               │ (Time extracted)             │ (Time unclear)
               ▼                              ▼
┌─────────────────────────────┐┌──────────────────────────────┐
│        Future View          ││         Needs Review         │
│   Under custody; not on Home││  Subtle badge; Review Window │
└──────────────┬──────────────┘└──────────────┬───────────────┘
               │ (Due wakeup)                 │ (Clarification)
               ▼                              │
┌─────────────────────────────────────────────▼───────────────┐
│                    Now / Due (Needs Attention)              │
│       Normal Notification / Staggered Re-alerts / Alarm     │
└──────────────┬──────────────────────────────┬───────────────┘
               │                              │
     ┌─────────┴─────────┐          ┌─────────┴─────────┐
     ▼                   ▼          ▼                   ▼
[Acknowledged]        [Snooze 2h]       [Dismiss / Mute]      [Completed]
(Confirmed seen,     (Back to wait,     (Mute sound only,    (The ONLY way
 NOT completed)       re-alert later)    keep active)         to archive)
```

### 1. Capture Never Fails
- Parses natural language dates and colloquial expressions: *"Remind me to buy coffee beans Friday afternoon"*, *"Team sync 3rd Thursday every month"*, *"Tomorrow 10am"*, *"This weekend"*.
- **Zero-friction capture**: Even if the input contains no date/time or is syntactically incomplete, the system will never throw an error or block you. It gracefully saves it into **Needs Review**, preserving your cognitive flow.

### 2. Future Hidden by Default
- **Core Rule: Commitments in the future must not drain your present cognitive bandwidth.**
- The Home view only presents items that deserve your immediate attention right now. There is no overwhelming "Upcoming" backlog to induce dread.
- Future commitments reside peacefully in the dedicated "Future" calendar view, visible only when you intentionally choose to inspect them.

### 3. Acknowledged ≠ Completed
- A fatal flaw of traditional task managers: dismissing a notification or tapping "seen" often marks an item as done.
- In Attention Inbox:
  - Tapping **"Acknowledged" (我知道了)** confirms to the system: *"I have seen this notice."* The persistent ringing stops, but the item **remains active** (tucked cleanly into the subtle "Acknowledged & Active" counter).
  - Tapping **"Completed" (完成)** is the **sole legitimate exit** to archive an item.

### 4. 3-Tier Escalating Wakeup (Actually Reaches You)
The system never assumes "delivery equals user noticed". Wakeups escalate based on importance:
- **Normal items**: Single standard notification.
- **Important items (☆)**: Initial notification + staggered follow-up re-alerts every ~30 minutes (up to 4 times), preventing accidental dismissal.
- **Critical items (🚨)**: Android **full-screen lockscreen alarm** (`setAlarmClock` + wake screen + looping ringtone + vibration pattern + keyguard bypass). It provides 4 clear action exits: *Acknowledged / Snooze 2 Hours / Completed / Dismiss (mute only)*. It pierces through Doze mode and silent settings.

### 5. Dual-Stage Deadline Protection
- Even if you have already clicked "Acknowledged", as long as an item has a hard deadline and remains uncompleted:
- The system sounds independent wakeup alarms at **24 hours before deadline (p24)** and **2 hours before deadline (p2)**, ensuring critical commitments never slip past the final hour.

### 6. 100% Local-First & Privacy First
- Your data lives strictly in your device's `IndexedDB` (with automated `localStorage` mirror fallback).
- **No account required, no login, zero tracking, no remote server dependency.** It functions seamlessly offline with 100% data sovereignty.

---

## Typical Scenarios

| Scenario | What You Do | How Attention Inbox Responds |
|---|---|---|
| **A sudden thought while walking** | Tap `+` at bottom right, type *"Call Bob Tuesday 3pm to review proposal"* | 5-second capture; time parsed automatically. The item enters Future custody; Home remains pristine and empty. |
| **Vague chore with uncertain timing** | Type *"Take the car in for maintenance sometime"* | Precise time cannot be extracted. Safely stored in **Needs Review**, gently surfaced during your scheduled Review Window. |
| **Alarm rings while in a meeting** | Full-screen lockscreen alarm fires; tap **Snooze** | The ringtone silences immediately; automatically rescheduled to re-alert you in 2 hours. |
| **Saw the reminder, will do it soon** | Alert banner appears; tap **Acknowledged** | Periodic re-alerts cease; item collapses into the "Acknowledged & Active" counter. You can focus on current work without fear of accidental completion. |
| **Approaching critical project deadline** | A task is due tomorrow at 18:00 (already ACKed this morning) | At 18:00 today (T-24h) and 16:00 tomorrow (T-2h), the system triggers two independent high-priority alarm rescues. |

---

## Quick Start

This project uses a **Zero-Build, purely static architecture**. No `npm run build`, no bundler configuration required.

### Option A: Web / PWA (Cross-platform, instant use)
1. Open `index.html` directly in any modern browser (Chrome, Safari, Edge). (Optimized for mobile view ~390px width).
2. **Load Sample Data**: If opening for the first time, go to **Mine → Load Sample Data** to immediately experience the full lifecycle.
3. **PWA Installation**: In your mobile browser, tap "Share → Add to Home Screen" to install it as an offline-first Web App.

### Option B: Android Native App (Full-screen alarm & lockscreen wakeup)
- A prebuilt self-signed debug APK is included in the repository: [`releases/安心收件箱-debug.apk`](file:///Users/qlyf/Developer/reminder/releases/%E5%AE%89%E5%BF%83%E6%94%B6%E4%BB%B6%E7%AE%B1-debug.apk).
- Supports Android 12+ exact alarm permissions and Android 13+ notification permissions, enabling background screen wakeup, ringtones, and reboot schedule restoration.

---

## Core Interactions Cheat Sheet

| Action / View | Interaction & Business Semantics |
|---|---|
| **Quick Capture (+)** | Natural language one-liner; **capture never fails**, unparsed inputs route to Needs Review. |
| **Now / Due View** | Shows only items requiring attention right now; **no anxiety-inducing upcoming list**. |
| **Acknowledged (ACK)** | Confirms you've seen it; stops nag cycle; **never marks as completed**. |
| **Snooze** | 6 flexible options in-app; lockscreen alarm & notification actions default to **2 hours**. |
| **Completed (Done)** | Explicit confirmation of completion; archives the item (the only normal archive path). |
| **Needs Review** | Inbox for fuzzy items; entry remains subtle until your Review Window arrives. |
| **Future View** | All future items under custody + calendar view; hidden from Home by default. |
| **Archive** | Chronological log of completed items; can be restored with a single click. |
| **Full-Screen Alarm** | For important/critical items; wakes screen, plays alarm ringtone over lockscreen with 4 action exits. |
| **Offline Notes** | Built-in lightweight Markdown notes; supports pinning and project associations. |
| **AI Parsing (Optional)** | Optional BYOK (Bring Your Own Key) for OpenAI-compatible models; gracefully falls back to local regex. |

---

## Hardcore Engineering & Reliability

Beneath its calm, minimalist exterior lies a hardened engine refined across 11 rounds of concurrency and consistency audits:

- **D41 Unified Transaction Model**:
  - Eliminates dropped user operations during asynchronous storage commits. Employs **Draft Isolation**: native lockscreen actions execute in an invisible memory draft, publishing to the UI only after `IndexedDB` confirms commit success.
  - Commands targeting the same item during an active commit are explicitly rejected with a retry prompt. Unrelated user actions are recorded with stable IDs and replayed sequentially into the draft, preventing UI tearing and race conditions.
- **Authoritative Persistence & Restart Consistency**:
  - `IndexedDB` serves as the authoritative backend, with `localStorage` acting as a best-effort mirror. Every commit writes an isolated deep snapshot, ensuring state read upon restart matches exactly what the user saw.
- **Android 14 Real-Device Emulator Verification**:
  - Audited via Chrome DevTools Protocol (CDP) on Android 14 emulators down to DOM, IndexedDB, memory footprint (PSS 82.7 MB), `AlarmManager` reconciliation, and cold-boot integrity (`BootRestoreReceiver`).

---

## Verification & Testing

The repository features an exhaustive automated test suite (including simulated disk restarts and a 36-combination concurrency matrix):

```bash
npm test
```

**Test Results (862 assertions passing):**
- `test-unit.js`: **29 passed** (Natural language parser, calendar/ACK recurrence, storage adapters)
- `test-native-reminders.js`: **105 passed** (Android notification projection, alarm routing, DND suppression, deadline staging)
- `test-smoke.js`: **161 passed** (End-to-end lifecycle, home view architecture, banner & full-screen alarm semantics)
- `test-regressions.js`: **567 passed** (D41 unified transactions, concurrent commit isolation, command replay, simulated restart consistency, 3 native actions × 6 UI commands × success/fail matrix)

---

## Architecture & File Map

```text
├── index.html                  # App single-page structure & styling
├── app-core.js                 # Central orchestrator (state machine, UI render, FIFO gate, replay)
├── styles.css                  # UI stylesheet
├── sw.js / manifest.json       # PWA Service Worker & web manifest
├── lib/
│   ├── parse-cn.js             # Chinese natural language date parser (modular UMD)
│   ├── repeat.js               # Recurrence engine (calendar-anchored vs ACK-anchored)
│   ├── reminder.js             # DND quiet hours, escalation policy, dual-stage deadline protection
│   ├── storage.js              # IndexedDB authoritative storage adapter
│   └── native-reminders.js     # Capacitor native reminder projection & reconciliation layer
├── android/                    # Capacitor 6 Android platform project
│   └── app/src/main/java/space/alliswell/inbox/
│       ├── AlarmActivity.java          # Full-screen lockscreen alarm activity
│       ├── SystemBridgePlugin.java     # Bridge plugin for exact alarms & notification channels
│       └── BootRestoreReceiver.java    # Boot-completed broadcast receiver for alarm restoration
├── test-unit.js                # Core unit test suite
├── test-smoke.js               # Acceptance smoke tests
├── test-native-reminders.js    # Native reminder projection tests
└── test-regressions.js         # Concurrency, transaction & restart regression tests
```

---

## Android App & Packaging

To inspect native code or build your own signed APK:

```bash
npm ci
npm run sync:www      # Sync web assets to www/
npm run cap:sync      # Sync to android/ project
npm run cap:open      # Open in Android Studio for build & run
```

- **Requirements**: Node.js ≥ 18, JDK 17, Android Studio + Android SDK (API 34).

---

## Credits & License

This project incorporates design philosophies and capabilities from the [alliswell](https://github.com/allin2/alliswell) ecosystem, tailored strictly to the Attention Inbox V0.2 specification.  
Copyrights and licenses adhere to respective upstream declarations.
