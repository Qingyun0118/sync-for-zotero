import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = fs.readFileSync(
  new URL("../extension/content_script.js", import.meta.url),
  "utf8",
);
const collectionCode = source.slice(
  source.indexOf("function parseDeepSeekHistoryHref("),
  source.indexOf("function collectHistoryEntries()"),
);

function elementMatchesSelector(element, selector) {
  const sel = String(selector).trim();
  if (sel === "aside") return element.tagName === "ASIDE";
  if (sel === "nav") return element.tagName === "NAV";
  if (sel.startsWith("[role=")) return element.attrs.role === "navigation";
  if (sel.includes("[class*=")) {
    const token = sel.match(/class\*="([^"]+)"/)?.[1] || "";
    return String(element.className).toLowerCase().includes(token);
  }
  if (sel.includes("[data-testid*=")) {
    const token = sel.match(/data-testid\*="([^"]+)"/)?.[1] || "";
    return String(element.attrs["data-testid"] || "").toLowerCase().includes(token);
  }
  return false;
}

class FakeElement {
  constructor(tagName, { className = "", attrs = {}, anchors = [], text = "" } = {}) {
    this.tagName = tagName.toUpperCase();
    this.className = className;
    this.attrs = attrs;
    this.anchors = anchors;
    this.text = text;
  }

  getAttribute(name) {
    return this.attrs[name] ?? null;
  }

  get textContent() {
    if (this.text) return this.text;
    return this.anchors.map((anchor) => anchor.textContent).join("");
  }

  matches(selector) {
    return String(selector)
      .split(",")
      .some((part) => elementMatchesSelector(this, part));
  }

  querySelectorAll(selector) {
    if (selector === "a[href]") return this.anchors;
    return [];
  }
}

function fakeAnchor(href, title) {
  return new FakeElement("a", { attrs: { href }, text: title });
}

function runCollection({ roots = [], body = null }) {
  const document = {
    body,
    querySelectorAll(selector) {
      return roots.filter((root) => elementMatchesSelector(root, selector));
    },
  };
  const context = vm.createContext({
    URL,
    Element: FakeElement,
    window: { location: { origin: "https://chat.deepseek.com", href: "https://chat.deepseek.com/" } },
    shared: { normalizeComposerText: (text) => String(text || "").trim() },
    document,
  });
  vm.runInContext(collectionCode, context);
  return vm.runInContext("collectDeepSeekHistoryEntriesWithRoot()", context);
}

test("collects history links from the body when no semantic root exists", () => {
  const body = new FakeElement("body", {
    anchors: [
      fakeAnchor("/a/chat/s/d0cc9a5c-3215-4570-9955-c482fe8f3a2b", "深度学习笔记"),
      fakeAnchor("/a/chat/s/394854f6-d217-4a4a-a47b-060dddc4d5e6", "RLHF 论文阅读"),
      fakeAnchor("/a/chat/s/c4d6fccc-0eb9-492a-803b-2d3e6e6f7081", "Zotero 配置"),
    ],
  });

  const result = runCollection({ roots: [], body });

  assert.equal(result.root, body);
  assert.equal(result.history.length, 3);
  assert.equal(result.history[0].id, "d0cc9a5c-3215-4570-9955-c482fe8f3a2b");
  assert.equal(result.history[1].title, "RLHF 论文阅读");
});

test("prefers a semantic sidebar root when one exists", () => {
  const aside = new FakeElement("aside", {
    className: "ds-sidebar",
    anchors: [fakeAnchor("/a/chat/s/394854f6-d217-4a4a-a47b-060dddc4d5e6", "RLHF 论文阅读")],
  });
  const body = new FakeElement("body", {
    anchors: [
      fakeAnchor("/a/chat/s/394854f6-d217-4a4a-a47b-060dddc4d5e6", "RLHF 论文阅读"),
      fakeAnchor("/a/chat/s/d0cc9a5c-3215-4570-9955-c482fe8f3a2b", "深度学习笔记"),
    ],
  });

  const result = runCollection({ roots: [aside], body });

  assert.equal(result.root, aside);
  assert.equal(result.history.length, 1);
});

test("returns no entries when neither roots nor history links exist", () => {
  const result = runCollection({ roots: [], body: new FakeElement("body") });

  assert.equal(result.root, null);
  assert.equal(result.history.length, 0);
});
