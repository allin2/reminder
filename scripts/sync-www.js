#!/usr/bin/env node
/* Copy web runtime assets into www/ for Capacitor */
"use strict";

const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const www = path.join(root, "www");

const FILES = [
  "index.html",
  "app-core.js",
  "sw.js",
  "manifest.json",
  "icon.svg",
  "icon-192.png",
  "icon-512.png"
];

const DIRS = ["lib"];

function rmrf(p) {
  fs.rmSync(p, { recursive: true, force: true });
}

function copyFile(rel) {
  const from = path.join(root, rel);
  const to = path.join(www, rel);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
}

rmrf(www);
fs.mkdirSync(www, { recursive: true });

for (const f of FILES) {
  if (!fs.existsSync(path.join(root, f))) {
    console.error("missing:", f);
    process.exit(1);
  }
  copyFile(f);
}

for (const d of DIRS) {
  const src = path.join(root, d);
  if (!fs.existsSync(src)) continue;
  for (const name of fs.readdirSync(src)) {
    if (name.endsWith(".js")) copyFile(path.join(d, name));
  }
}

// minimal service worker path note: sw.js is relative; Capacitor serves from www root
const count = fs.readdirSync(www).length + fs.readdirSync(path.join(www, "lib")).length;
console.log("www synced:", count, "entries");
