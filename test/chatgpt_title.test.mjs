import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import test from "node:test";
import { createRequire } from "node:module";
import { parseHTML } from "linkedom";
const require = createRequire(import.meta.url);
const shared = require("../extension/webchat_shared.js");
const source = fs.readFileSync(new URL("../extension/content_script.js", import.meta.url), "utf8");
const start = source.indexOf("async function handleRenameChat(");
const end = source.indexOf("// Message listener for history mutations.", start);

function harness({ dialog = false, language = "zh", saveWorks = true, busy = false, actualId = "chat-1", layout = "row", menuOpensOn = "click", menuItemRole = true, saveOn = "enter" } = {}) {
  const { document, window } = parseHTML('<html><body><nav><div id="row"><a href="https://chatgpt.com/c/chat-1">Original</a></div><div><a href="https://chatgpt.com/c/other">Other</a></div></nav></body></html>');
  const row = document.getElementById("row");
  const link = row.querySelector("a");
  let clicks = 0;
  let scrapes = 0;
  const openMenu = () => {
    clicks++;
    const menu = document.createElement("div");
    menu.id = "menu"; menu.setAttribute("role", "menu");
    const rename = document.createElement("button");
    if (menuItemRole) rename.setAttribute("role", "menuitem");
    rename.textContent = language === "zh" ? "重命名" : "Rename";
    menu.append(rename); document.body.append(menu);
    rename.addEventListener("click", () => {
      menu.remove();
      const input = document.createElement("input");
      input.type = "text"; input.value = link.textContent;
      const container = dialog ? document.createElement("div") : row;
      if (dialog) { container.setAttribute("role", "dialog"); document.body.append(container); }
      container.append(input);
      const save = () => { if (saveWorks) link.textContent = input.value; input.remove(); if (dialog) container.remove(); };
      if (dialog) {
        const button = document.createElement("button");
        button.textContent = language === "zh" ? "保存" : "Save";
        button.addEventListener("click", save); container.append(button);
      } else if (saveOn === "blur") {
        // Some builds commit the inline editor on blur rather than Enter.
        input.blur = save;
      } else input.addEventListener("keydown", (event) => { if (event.key === "Enter") save(); });
    });
  };
  const makeMenuButton = () => {
    const button = document.createElement("button");
    if (layout === "labeled") button.setAttribute("aria-label", "More options");
    else { button.setAttribute("aria-haspopup", "menu"); button.setAttribute("aria-controls", "menu"); }
    if (menuOpensOn === "pointerdown") button.addEventListener("pointerdown", openMenu);
    else if (menuOpensOn === "keydown") button.addEventListener("keydown", (event) => { if (event.key === "Enter") openMenu(); });
    else button.addEventListener("click", openMenu);
    return button;
  };
  if (layout === "ancestor") {
    // The overflow control sits beside an inner wrapper, not beside the link.
    const wrap = document.createElement("div");
    wrap.append(link); row.prepend(wrap); row.append(makeMenuButton());
  } else if (layout === "labeled") {
    row.append(makeMenuButton());
  } else if (layout === "ambiguous") {
    row.append(makeMenuButton(), makeMenuButton());
  } else if (layout === "hover") {
    // React only mounts the control once the pointer reaches the row.
    const reveal = () => { if (!row.querySelector("button")) row.append(makeMenuButton()); };
    row.addEventListener("mouseover", reveal);
    row.addEventListener("pointerover", reveal);
  } else {
    row.append(makeMenuButton());
  }
  let now = 0;
  class KeyboardEvent extends window.Event {
    constructor(type, init) { super(type, init); this.key = init.key; }
  }
  const context = vm.createContext({
    document, shared, SITE_ADAPTER: { siteId: "chatgpt" },
    getCurrentChatUrl: () => `https://chatgpt.com/c/${actualId}`,
    getCurrentChatId: () => actualId,
    isConversationStillRunning: () => busy,
    isVisibleElement: (node) => !node.hidden && node.isConnected,
    workerSleep: async (ms) => { now += ms; }, Date: { now: () => now },
    MouseEvent: window.Event, Event: window.Event, KeyboardEvent,
    HTMLInputElement: window.HTMLInputElement,
    scrapeHistory: async () => { scrapes++; },
  });
  const run = vm.runInContext(`${source.slice(start, end)}\nhandleRenameChat`, context);
  const request = { chatUrl: "https://chatgpt.com/c/chat-1", chatId: "chat-1", expectedTitle: "Original", title: "Ma 等 · 2026 · Cooperative Control" };
  return { run: (overrides = {}) => run({ ...request, ...overrides }), document, clicks: () => clicks, scrapes: () => scrapes, title: request.title };
}

for (const language of ["zh", "en"]) for (const dialog of [true, false]) {
  test(`renames only the bound conversation and verifies ${language} ${dialog ? "dialog" : "inline"} save`, async () => {
    const h = harness({ language, dialog });
    const result = await h.run();
    assert.equal(result.status, "synced");
    assert.equal(result.title, h.title);
    assert.equal(h.scrapes(), 1);
    assert.equal(h.document.querySelector('a[href$="/other"]').textContent, "Other");
    assert.equal((await h.run()).status, "synced");
    assert.equal(h.clicks(), 1, "replayed task is idempotent");
  });
}
test("refuses a mismatched conversation before opening any menu", async () => {
  const h = harness({ actualId: "other" });
  assert.equal((await h.run()).status, "failed");
  assert.equal(h.clicks(), 0);
});
test("preserves a manual title change instead of overwriting it", async () => {
  const h = harness();
  assert.equal((await h.run({ expectedTitle: "Stale title" })).status, "conflict");
  assert.equal(h.clicks(), 0);
});
test("does not call a failed save successful", async () => {
  const h = harness({ saveWorks: false });
  assert.equal((await h.run()).status, "failed");
  assert.equal(h.scrapes(), 0);
});
test("does not rename while an answer is generating", async () => {
  const h = harness({ busy: true });
  assert.equal((await h.run()).status, "failed");
  assert.equal(h.clicks(), 0);
});

test("does not borrow an adjacent conversation menu from a shared container", async () => {
  const h = harness();
  const row = h.document.getElementById("row");
  row.append(h.document.querySelector('a[href$="/other"]'));
  assert.equal((await h.run()).status, "failed");
  assert.equal(h.clicks(), 0);
});

test("expired tasks cannot rename after relay timeout", async () => {
  const h = harness();
  assert.equal((await h.run({ expiresAt: 0 })).status, "failed");
  assert.equal(h.clicks(), 0);
});

// The sidebar moved the overflow control out of the link and behind a hover
// over the years; each of these layouts must still resolve to one row.
for (const layout of ["ancestor", "labeled", "hover"]) {
  test(`finds the overflow control in the ${layout} sidebar layout`, async () => {
    const h = harness({ layout });
    const result = await h.run();
    assert.equal(result.status, "synced");
    assert.equal(result.title, h.title);
    assert.equal(h.clicks(), 1);
  });
}

test("refuses to guess when one row holds several overflow controls", async () => {
  const h = harness({ layout: "ambiguous" });
  const result = await h.run();
  assert.equal(result.status, "failed");
  assert.equal(h.clicks(), 0);
  assert.match(result.error, /未找到会话操作菜单/);
});

test("reports what the row held when no overflow control exists", async () => {
  const h = harness();
  h.document.getElementById("row").querySelector("button").remove();
  const result = await h.run();
  assert.equal(result.status, "failed");
  assert.equal(h.clicks(), 0);
  assert.match(result.error, /行内无按钮/);
});

// Radix opens its menus on pointerdown, the item roles drifted over time, and
// the inline editor has committed on both Enter and blur.
for (const [name, options] of [
  ["a pointerdown-only menu", { menuOpensOn: "pointerdown" }],
  ["a keyboard-only menu", { menuOpensOn: "keydown" }],
  ["menu items without the menuitem role", { menuItemRole: false }],
  ["an editor that commits on blur", { saveOn: "blur" }],
]) {
  test(`renames through ${name}`, async () => {
    const h = harness(options);
    const result = await h.run();
    assert.equal(result.status, "synced");
    assert.equal(result.title, h.title);
    assert.equal(h.clicks(), 1);
    assert.equal(h.scrapes(), 1);
  });
}
