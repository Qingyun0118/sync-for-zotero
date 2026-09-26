import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const injectedSource = fs.readFileSync(
  path.resolve(testDir, "../extension/injected.js"),
  "utf8",
);

const HISTORY_CACHE_EVENT = "SYNC_ZOTERO_DEEPSEEK_HISTORY_CACHE";
const FETCH_PAGE_URL = "https://chat.deepseek.com/api/v0/chat_session/fetch_page";
const FETCH_PAGE_MORE_URL = `${FETCH_PAGE_URL}?page=2`;
const FETCH_PAGE_STALE_URL = `${FETCH_PAGE_URL}?page=9`;
const CREATE_SESSION_URL = "https://chat.deepseek.com/api/v0/chat_session/create";

function jsonResponse(payload) {
  return {
    ok: true,
    headers: {
      get(name) {
        return String(name || "").toLowerCase() === "content-type"
          ? "application/json; charset=utf-8"
          : null;
      },
    },
    clone() {
      return jsonResponse(payload);
    },
    async text() {
      return JSON.stringify(payload);
    },
  };
}

function fetchPagePayload(entries) {
  return {
    code: 0,
    msg: "",
    data: {
      biz_code: 0,
      biz_msg: "",
      biz_data: {
        chat_sessions: entries,
        has_more: false,
      },
    },
  };
}

// A history-shaped response whose entries cannot be normalized (schema
// drift): the extractor reports invalid_source for genuine history
// endpoints in this state.
function degradedHistoryPayload() {
  return fetchPagePayload([{ id: "not-a-valid-id", name: "DeepSeek" }]);
}

// A bootstrap response from a non-history endpoint whose URL contains
// "session": before the URL heuristic was tightened, the extractor treated
// its nested arrays as history candidates, failed to normalize every entry,
// and produced a spurious "invalid_source" snapshot.
function createSessionPayload() {
  return {
    code: 0,
    msg: "",
    data: {
      biz_code: 0,
      biz_msg: "",
      biz_data: {
        chat_session: { id: "9c8b7a65-4321-0fed-cba9-876543210fed", title: null },
        model_configs: {
          list: [
            { id: 1, name: "deepseek-chat" },
            { id: 2, name: "deepseek-reasoner" },
          ],
        },
      },
    },
  };
}

function createHarness(payloads) {
  const postedMessages = [];
  const window = {
    __syncZoteroFetchPatched: 0,
    location: {
      href: "https://chat.deepseek.com/",
      origin: "https://chat.deepseek.com",
      hostname: "chat.deepseek.com",
      pathname: "/",
    },
    addEventListener() {},
    postMessage(payload) {
      postedMessages.push(payload);
    },
    fetch: async (url) => jsonResponse(payloads[String(url)]),
    XMLHttpRequest: class {},
  };

  vm.runInNewContext(injectedSource, {
    Request: class {},
    TextDecoder,
    URL,
    clearTimeout,
    console,
    document: { querySelector: () => null },
    setTimeout,
    window,
  });

  async function flush() {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  return {
    window,
    async request(url) {
      await window.fetch(url, { method: "GET" });
      await flush();
    },
    historySnapshot() {
      return window.__syncZoteroDeepSeekCache?.history || null;
    },
    historyMessages() {
      return postedMessages.filter(
        (message) => message.type === HISTORY_CACHE_EVENT,
      );
    },
  };
}

test("a degraded history response never replaces a healthy snapshot", async () => {
  const harness = createHarness({
    [FETCH_PAGE_URL]: fetchPagePayload([
      { id: "8f3a2b1c-4d5e-6f70-8a9b-0c1d2e3f4a5b", title: "Attention Is All You Need" },
    ]),
    [FETCH_PAGE_STALE_URL]: degradedHistoryPayload(),
  });

  await harness.request(FETCH_PAGE_URL);
  assert.equal(harness.historySnapshot().status, "ok");

  await harness.request(FETCH_PAGE_STALE_URL);

  const snapshot = harness.historySnapshot();
  assert.equal(snapshot.status, "ok");
  assert.equal(snapshot.history.length, 1);
  assert.equal(snapshot.history[0].id, "8f3a2b1c-4d5e-6f70-8a9b-0c1d2e3f4a5b");
  assert.equal(harness.historyMessages().length, 1);
  assert.equal(harness.historyMessages().at(-1).snapshot.status, "ok");
});

test("responses from non-history endpoints are ignored entirely", async () => {
  const harness = createHarness({
    [CREATE_SESSION_URL]: createSessionPayload(),
  });

  await harness.request(CREATE_SESSION_URL);

  assert.equal(harness.historySnapshot(), null);
  assert.equal(harness.historyMessages().length, 0);
});

test("responses from non-history endpoints never downgrade a healthy snapshot", async () => {
  const harness = createHarness({
    [FETCH_PAGE_URL]: fetchPagePayload([
      { id: "8f3a2b1c-4d5e-6f70-8a9b-0c1d2e3f4a5b", title: "Attention Is All You Need" },
    ]),
    [CREATE_SESSION_URL]: createSessionPayload(),
  });

  await harness.request(FETCH_PAGE_URL);
  await harness.request(CREATE_SESSION_URL);

  const snapshot = harness.historySnapshot();
  assert.equal(snapshot.status, "ok");
  assert.equal(snapshot.history.length, 1);
  assert.equal(harness.historyMessages().length, 1);
});

test("a degraded history response is stored when no healthy snapshot exists", async () => {
  const harness = createHarness({
    [FETCH_PAGE_STALE_URL]: degradedHistoryPayload(),
  });

  await harness.request(FETCH_PAGE_STALE_URL);

  assert.equal(harness.historySnapshot().status, "invalid_source");
  assert.equal(harness.historyMessages().length, 1);
});

test("a newer healthy snapshot replaces an older healthy snapshot", async () => {
  const harness = createHarness({
    [FETCH_PAGE_URL]: fetchPagePayload([
      { id: "8f3a2b1c-4d5e-6f70-8a9b-0c1d2e3f4a5b", title: "Attention Is All You Need" },
    ]),
    [FETCH_PAGE_MORE_URL]: fetchPagePayload([
      { id: "8f3a2b1c-4d5e-6f70-8a9b-0c1d2e3f4a5b", title: "Attention Is All You Need" },
      { id: "1a2b3c4d-5e6f-7081-92a3-b4c5d6e7f809", title: "Zotero history notes" },
    ]),
  });

  await harness.request(FETCH_PAGE_URL);
  await harness.request(FETCH_PAGE_MORE_URL);

  const snapshot = harness.historySnapshot();
  assert.equal(snapshot.status, "ok");
  assert.equal(snapshot.history.length, 2);
  assert.equal(harness.historyMessages().length, 2);
  assert.deepEqual(
    harness.historyMessages().map((message) => message.snapshot.status),
    ["ok", "ok"],
  );
});
