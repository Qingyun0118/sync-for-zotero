import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

const backgroundSource = fs.readFileSync(
  new URL("../extension/background.js", import.meta.url),
  "utf8",
);
const contentScriptSource = fs.readFileSync(
  new URL("../extension/content_script.js", import.meta.url),
  "utf8",
);

const KEEPALIVE_START = "// --- keepalive:";
const KEEPALIVE_END = "// --- end keepalive";

function sliceKeepaliveBlock(source) {
  const start = source.indexOf(KEEPALIVE_START);
  const endMarker = source.indexOf(KEEPALIVE_END, start);
  assert.ok(start >= 0, "keepalive block start marker not found");
  assert.ok(endMarker > start, "keepalive block end marker not found");
  return source.slice(start, endMarker + KEEPALIVE_END.length);
}

test("SW_KEEPALIVE refreshes the relay status immediately and is debounced", () => {
  const clock = { now: 1_000_000 };
  const heartbeats = [];
  const messageListeners = [];
  const tabActivatedListeners = [];
  const windowFocusListeners = [];

  const context = vm.createContext({
    console,
    Date: { now: () => clock.now },
    heartbeat: () => {
      heartbeats.push(clock.now);
      return Promise.resolve();
    },
    chrome: {
      runtime: {
        onMessage: { addListener: (fn) => messageListeners.push(fn) },
      },
      tabs: {
        onActivated: { addListener: (fn) => tabActivatedListeners.push(fn) },
      },
      windows: {
        WINDOW_ID_NONE: -1,
        onFocusChanged: { addListener: (fn) => windowFocusListeners.push(fn) },
      },
    },
  });
  vm.runInContext(sliceKeepaliveBlock(backgroundSource), context);

  assert.equal(messageListeners.length, 1);
  assert.equal(tabActivatedListeners.length, 1);
  assert.equal(windowFocusListeners.length, 1);

  let response = null;
  const handled = messageListeners[0]({ type: "SW_KEEPALIVE" }, {}, (value) => {
    response = value;
  });
  assert.equal(handled, true);
  assert.equal(heartbeats.length, 1);
  assert.equal(response?.ok, true);

  messageListeners[0]({ type: "SW_KEEPALIVE" }, {}, () => {});
  assert.equal(heartbeats.length, 1, "second ping inside the debounce window");

  assert.equal(
    messageListeners[0]({ type: "HISTORY_UPDATE" }, {}, () => {}),
    undefined,
    "unrelated messages are left to the other listeners",
  );
  assert.equal(heartbeats.length, 1);

  clock.now += 4_001;
  tabActivatedListeners[0]();
  assert.equal(heartbeats.length, 2);

  clock.now += 4_001;
  windowFocusListeners[0](-1);
  assert.equal(heartbeats.length, 2, "WINDOW_ID_NONE must not refresh");
  windowFocusListeners[0](1);
  assert.equal(heartbeats.length, 3);
});

test("chat tabs keep the worker warm and refresh on focus or visibility", () => {
  const clock = { now: 2_000_000 };
  const sent = [];
  const intervals = [];
  const documentListeners = {};
  const windowListeners = {};

  const documentStub = {
    hidden: false,
    addEventListener: (type, fn) => {
      (documentListeners[type] ||= []).push(fn);
    },
  };
  const windowStub = {
    addEventListener: (type, fn) => {
      (windowListeners[type] ||= []).push(fn);
    },
  };
  const context = vm.createContext({
    console,
    Date: { now: () => clock.now },
    setInterval: (fn, ms) => {
      intervals.push({ fn, ms });
      return intervals.length;
    },
    document: documentStub,
    window: windowStub,
    chrome: {
      runtime: {
        sendMessage: (message, callback) => {
          sent.push(message);
          if (typeof callback === "function") callback();
        },
        get lastError() {
          return undefined;
        },
      },
    },
  });
  vm.runInContext(sliceKeepaliveBlock(contentScriptSource), context);

  assert.equal(sent.length, 1);
  assert.equal(sent[0].type, "SW_KEEPALIVE");
  assert.equal(typeof sent[0].at, "number");

  assert.equal(intervals.length, 1);
  assert.equal(intervals[0].ms, 15_000);
  intervals[0].fn();
  assert.equal(sent.length, 2);

  assert.equal(documentListeners.visibilitychange?.length, 1);
  documentStub.hidden = false;
  documentListeners.visibilitychange[0]();
  assert.equal(sent.length, 3);
  documentStub.hidden = true;
  documentListeners.visibilitychange[0]();
  assert.equal(sent.length, 3, "hidden tabs must not re-ping on visibilitychange");

  assert.equal(windowListeners.focus?.length, 1);
  assert.equal(windowListeners.pageshow?.length, 1);
  windowListeners.focus[0]();
  windowListeners.pageshow[0]();
  assert.equal(sent.length, 5);
});
