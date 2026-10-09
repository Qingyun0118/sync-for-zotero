import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import test from "node:test";
const source = fs.readFileSync(new URL("../extension/background.js", import.meta.url), "utf8");
const commandCode = source.slice(source.indexOf("let commandRunning = false;"), source.indexOf("async function runTitleTask("));
const queryStart = source.indexOf("async function pollForQuery()");
const queryCode = source.slice(queryStart, source.indexOf("// ---------------------------------------------------------------------------\n// Pipeline", queryStart));

test("a title mutation holds off query claims and duplicate command polls", async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const calls = [];
  const context = vm.createContext({
    pipelineRunning: false, zoteroConnected: true, SERVER: "local", SITE_CONFIGS: {},
    relayFetch: async () => ({ json: async () => ({ command: null }) }),
    serverGet: async (path) => { calls.push(path); return { command: { type: "RENAME_CHAT" } }; },
    runTitleTask: async () => { calls.push("rename"); await gate; },
  });
  const api = vm.runInContext(`${commandCode}\n${queryCode}\n({pollForCommand,pollForQuery})`, context);
  const pending = api.pollForCommand();
  await new Promise((resolve) => setImmediate(resolve));
  await Promise.all([api.pollForQuery(), api.pollForCommand()]);
  assert.deepEqual(calls, ["/poll_title", "rename"]);
  release(); await pending;
  await api.pollForQuery();
  assert.equal(calls.at(-1), "/poll_query");
});

test("title polling is blocked while query discovery is in flight", async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  let commands = 0;
  const context = vm.createContext({
    pipelineRunning: false, zoteroConnected: true,
    relayFetch: async () => { commands++; return { json: async () => ({ command: null }) }; },
    serverGet: async () => { await gate; return { status: "idle" }; },
  });
  const api = vm.runInContext(`${commandCode}\n${queryCode}\n({pollForCommand,pollForQuery})`, context);
  const pending = api.pollForQuery();
  await api.pollForCommand();
  assert.equal(commands, 0);
  release(); await pending;
});
