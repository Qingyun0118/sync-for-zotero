import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { createRequire } from "node:module";
import { parseHTML } from "linkedom";

const require = createRequire(import.meta.url);
const shared = require("../extension/webchat_shared.js");
const source = fs.readFileSync(new URL("../extension/content_script.js", import.meta.url), "utf8");
function between(start, end) {
  const offset = source.indexOf(start);
  const limit = source.indexOf(end, offset + start.length);
  assert.ok(offset >= 0 && limit > offset);
  return source.slice(offset, limit);
}

function harness(html) {
  const { document, window } = parseHTML(`<html><body>${html}</body></html>`);
  window.getComputedStyle = (node) => ({
    display: node.style.display || "block",
    visibility: node.style.visibility || "visible",
  });
  window.Element.prototype.getBoundingClientRect = function () {
    return this.style.display === "contents" || this.style.display === "none"
      ? { width: 0, height: 0 } : { width: 600, height: 80 };
  };
  const adapter = between('  "chatgpt.com": {', '\n\n  "chat.deepseek.com": {')
    .replace('  "chatgpt.com": ', '').replace(/,\s*$/, '');
  const context = vm.createContext({
    document, window, Element: window.Element, URL, TextEncoder, btoa,
    Node: { TEXT_NODE: 3, ELEMENT_NODE: 1, DOCUMENT_POSITION_FOLLOWING: 4 }, shared,
    getCurrentChatUrl: () => "https://chatgpt.com/c/test",
    getCurrentChatId: () => "test",
    simpleHash: (value) => String(value.length),
  });
  return vm.runInContext(`
    ${between("function isVisibleElement(", "function isUsableComposer(")}
    ${between("function extractBestAssistantAnswerCandidate(", "function extractDeepSeekAssistantAnswerText(")}
    ${between("function extractAssistantAnswerText(", "function extractThinking()")}
    ${between("/** Extract original LaTeX source", "// Scrape all messages from the current ChatGPT conversation page")}
    ${between("function removeTransientMessageNodes(", "/**\n * For sites with virtual scrolling")}
    ${between("function hasResponseActionBar(", "function getAssistantMessageNodes()")}
    ${between("function getAssistantMessageNodes()", "function buildAssistantAnchorId(")}
    ${between("function wordJaccardSimilarity(", "/** Extract original LaTeX source")}
    const SITE_ADAPTER = ${adapter};
    ({ document, extractConversationTranscript, getUserMessageCount,
       getAssistantMessageNodes, findMatchingUserTurn, resolveBoundAssistantTurn,
       hasResponseActionBar });
  `, context);
}

test("grouped ChatGPT roles load history and verify the submitted user turn", () => {
  const h = harness(`<div data-turn-key="turn-1">
    <div data-conversation-role="user">
      <div class="attachment">paper.pdf</div>
      <div data-user-message-bubble>请总结这篇论文。</div>
    </div>
    <div data-conversation-role="assistant"><p>这篇论文研究协同控制。</p></div>
  </div>`);
  const transcript = h.extractConversationTranscript();
  assert.equal(transcript.count, 2);
  assert.equal(h.getUserMessageCount(), 1);
  assert.equal(h.getAssistantMessageNodes().length, 1);
  const user = h.findMatchingUserTurn(transcript, 0, "请总结这篇论文。", []);
  assert.equal(user.messageKey, "user:turn-1");
  assert.ok(user.attachments.includes("paper.pdf"));
  const assistant = h.resolveBoundAssistantTurn(transcript, user.messageKey);
  assert.equal(assistant.messageKey, "assistant:turn-1");
  assert.equal(assistant.text, "这篇论文研究协同控制。");
});

test("history extraction preserves plaintext diagrams after pruning code card controls", () => {
  const diagram = "      /\\\n     /  \\\n____/____\\____";
  const h = harness(`<div data-turn-key="diagram">
    <div data-conversation-role="assistant">
      <div data-markdown-text-style="assistant-message"><p>尖峰：</p><div>
        <div>纯文本<button>复制代码</button></div>
        <div><code class="language-plaintext">${diagram}</code></div>
      </div><p>所以 Fisher 信息大。</p></div>
    </div>
  </div>`);
  const transcript = h.extractConversationTranscript();
  assert.equal(transcript.count, 1);
  assert.equal(transcript.messages[0].text,
    `尖峰：\n\n\`\`\`plaintext\n${diagram}\n\`\`\`\n\n所以 Fisher 信息大。`);
});

test("assistant images outside markdown and inside image buttons remain in order", () => {
  const h = harness(`<div data-turn-key="images"><div data-conversation-role="assistant">
    <div data-markdown-text-style="assistant-message"><p>之前。</p></div>
    <button><img src="https://example.com/diagram.png" alt="示意图"></button>
    <div data-markdown-text-style="assistant-message"><p>之后。</p></div>
    <button>复制回答</button>
  </div></div>`);
  const text = h.extractConversationTranscript().messages[0].text;
  assert.ok(text.includes('![示意图](<https://example.com/diagram.png>)'));
  assert.ok(text.indexOf('之前。') < text.indexOf('![示意图]'));
  assert.ok(text.indexOf('![示意图]') < text.indexOf('之后。'));
  assert.doesNotMatch(text, /复制回答/);
});

test("image-only SVG answers are retained instead of filtered as empty", () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg"><text>USV 示意图</text></svg>';
  const h = harness(`<div data-turn-key="svg"><div data-conversation-role="assistant">
    <div><img data-d-component="svg" alt="" src="data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}"></div>
  </div></div>`);
  const transcript = h.extractConversationTranscript();
  assert.equal(transcript.count, 1);
  assert.match(transcript.messages[0].text, /data:image\/svg\+xml;base64,/);
});

test("role heading and sibling markdown produce the full formatted answer", () => {
  const h = harness(`<div data-turn-key="group">
    <div data-content-search-unit-key="group:0:user">
      <h4 class="sr-only">你说：</h4>
      <div class="attachment">paper.pdf</div>
      <div data-user-message-bubble>用3-5个要点概括该论文的主要内容。</div>
      <div class="turn-action-controls"><button aria-label="Copy message">Copy</button></div>
    </div>
    <div data-content-search-unit-key="group:2:assistant">
      <h4 data-conversation-role="assistant" class="sr-only">ChatGPT 说：</h4>
      <div><div data-markdown-text-style="assistant-message">
        <h2>论文要点</h2><p>研究问题与方法。</p>
        <ol><li>主要发现一。</li><li>主要发现二。</li></ol>
        <p>意义与局限。</p>
      </div></div>
    </div>
    <div class="turn-action-controls"><button aria-label="Copy">Copy</button></div>
  </div>`);
  const transcript = h.extractConversationTranscript();
  assert.equal(transcript.count, 2);
  assert.match(transcript.messages[1].text, /## 论文要点/);
  assert.match(transcript.messages[1].text, /1\. 主要发现一。/);
  assert.match(transcript.messages[1].text, /2\. 主要发现二。/);
  assert.match(transcript.messages[1].text, /意义与局限。/);
  assert.doesNotMatch(transcript.messages[1].text, /ChatGPT|Copy/);
  assert.ok(transcript.messages[0].attachments.includes("paper.pdf"));
  assert.equal(h.hasResponseActionBar(), true);
});

test("a role heading alone is not an answer and the user's toolbar is not completion", () => {
  const h = harness(`<div data-turn-key="streaming">
    <div data-content-search-unit-key="streaming:0:user">
      <div data-user-message-bubble>Question</div>
      <div class="turn-action-controls"><button aria-label="Copy">Copy</button></div>
    </div>
    <div data-content-search-unit-key="streaming:2:assistant">
      <h4 data-conversation-role="assistant" class="sr-only">ChatGPT 说：</h4>
      <div data-markdown-text-style="assistant-message"></div>
    </div>
  </div>`);
  assert.equal(h.extractConversationTranscript().count, 1);
  assert.equal(h.hasResponseActionBar(), false);
  h.document.querySelector('[data-markdown-text-style]').innerHTML = '<p>Actual answer</p>';
  assert.equal(h.extractConversationTranscript().messages[1].text, "Actual answer");
  assert.equal(h.hasResponseActionBar(), false);
});

test("multiple answer blocks retain formulas and never include the user prompt", () => {
  const h = harness(`<div data-turn-key="math">
    <div data-content-search-unit-key="math:0:user"><div data-user-message-bubble>PRIVATE PROMPT</div></div>
    <div data-content-search-unit-key="math:2:assistant">
      <h4 data-conversation-role="assistant" class="sr-only">ChatGPT said:</h4>
      <div data-markdown-text-style="assistant-message"><p>First paragraph.</p></div>
      <div data-markdown-text-style="assistant-message">
        <p>Equation: <span data-math-source="x^2"><span class="katex"><span class="katex-html">x²</span></span></span></p>
        <p>Last paragraph.</p>
      </div>
    </div>
  </div>`);
  const text = h.extractConversationTranscript().messages[1].text;
  assert.match(text, /First paragraph\./);
  assert.match(text, /\$x\^2\$/);
  assert.match(text, /Last paragraph\./);
  assert.doesNotMatch(text, /ChatGPT said|PRIVATE PROMPT/);
});

test("mixed legacy shells, semantic containers and bubbles are not duplicated", () => {
  const h = harness(`<section data-turn="user" data-turn-id="old-user">
    <div data-message-author-role="user" data-message-id="user-id">
      <div data-conversation-role="user"><div data-user-message-bubble>Old prompt</div></div>
    </div>
  </section><article data-turn="assistant">
    <div data-message-author-role="assistant" data-message-id="assistant-id">Old answer</div>
  </article><div data-turn-key="new-turn">
    <div data-user-message-bubble>New prompt</div>
    <div data-conversation-role="assistant">New answer</div>
  </div>`);
  const transcript = h.extractConversationTranscript();
  assert.deepEqual(Array.from(transcript.messages, (m) => [m.messageKey, m.role]), [
    ["user-id", "user"], ["assistant-id", "assistant"],
    ["user:new-turn", "user"], ["assistant:new-turn", "assistant"],
  ]);
  assert.equal(h.getUserMessageCount(), 2);
  assert.equal(h.getAssistantMessageNodes().length, 2);
});

test("role-only section layouts retain stable keys as answer text streams", () => {
  const h = harness(`<section data-turn="user" data-turn-id="u">Question</section>
    <section data-turn="assistant" data-turn-id="a">Partial answer</section>`);
  const before = h.extractConversationTranscript();
  h.document.querySelector('[data-turn="assistant"]').textContent = "Completed answer";
  const after = h.extractConversationTranscript();
  assert.equal(after.count, 2);
  assert.equal(after.messages[1].messageKey, before.messages[1].messageKey);
  assert.equal(h.findMatchingUserTurn(after, before.count, "Question", before.messages), null);
});

test("display contents messages are readable while hidden conversation trees stay excluded", () => {
  const h = harness(`<div data-turn-key="visible">
    <div data-conversation-role="user" style="display:contents"><div data-user-message-bubble>Question</div></div>
    <div data-conversation-role="assistant" style="display:contents"><p>Answer</p></div>
  </div><div style="display:none"><div data-conversation-role="user">Stale prompt</div></div>
  <div aria-hidden="true"><div data-message-author-role="assistant">Stale answer</div></div>
  <section data-turn="assistant" hidden>Hidden answer</section>
  <div data-conversation-role="system">System</div>`);
  assert.deepEqual(Array.from(h.extractConversationTranscript().messages, (m) => m.text), ["Question", "Answer"]);
});

test("reads a submitted file card rendered beside the message bubble", () => {
  // Current ChatGPT renders the uploaded card in the turn wrapper, outside the
  // node that carries data-message-author-role, so the message node alone
  // yields no attachments and delivery verification would reject the send.
  const h = harness(`<div data-testid="conversation-turn-1">
    <div class="file-card">
      <div>Xu 等 - 2026 - Never Too Cocky to Cooperate.pdf</div>
      <div>PDF</div>
    </div>
    <div data-message-author-role="user"><div data-user-message-bubble>请概述这篇论文。</div></div>
  </div>
  <div data-testid="conversation-turn-2">
    <div data-message-author-role="assistant"><p>本文研究水下协同。</p></div>
  </div>`);
  const transcript = h.extractConversationTranscript();
  const user = transcript.messages.find((message) => message.role === "user");
  assert.deepEqual(
    Array.from(user.attachments || []),
    ["Xu 等 - 2026 - Never Too Cocky to Cooperate.pdf"],
  );
});

test("does not read turn chrome as an attachment on a prompt-only turn", () => {
  const h = harness(`<div data-testid="conversation-turn-1">
    <img src="https://chatgpt.com/avatar.png" alt="">
    <div data-message-author-role="user"><div data-user-message-bubble>只要问题，没有附件。</div></div>
  </div>`);
  const transcript = h.extractConversationTranscript();
  const user = transcript.messages.find((message) => message.role === "user");
  assert.deepEqual(Array.from(user.attachments || []), []);
});

test("a shortened card name still verifies the submitted PDF", () => {
  const expected = "Xu 等 - 2026 - Never Too Cocky to Cooperate An FIM and RL-Based USV-AUV Collaborative System for Underwater Tasks.pdf";
  const h = harness(`<div data-testid="conversation-turn-1">
    <div class="card">
      <div class="name">Xu 等 - 2026 - Never Too Cocky to Co…</div>
      <div class="type">PDF</div>
    </div>
    <div data-message-author-role="user"><div data-user-message-bubble>请概述这篇论文。</div></div>
  </div>`);
  const user = h.extractConversationTranscript().messages.find((message) => message.role === "user");
  const contract = shared.classifySubmittedPdfContract(user.attachments || [], expected);
  assert.equal(contract.contractVerified, true);
});

test("a title attribute recovers the full card name", () => {
  const expected = "paper-with-a-very-long-name.pdf";
  const h = harness(`<div data-testid="conversation-turn-1">
    <div class="card" title="${expected}">
      <div class="name">paper-with-a-very-lon…</div>
      <div class="type">PDF</div>
    </div>
    <div data-message-author-role="user"><div data-user-message-bubble>总结。</div></div>
  </div>`);
  const user = h.extractConversationTranscript().messages.find((message) => message.role === "user");
  const contract = shared.classifySubmittedPdfContract(user.attachments || [], expected);
  assert.equal(contract.contractVerified, true);
  assert.equal(contract.filenameMatched, true);
});

test("a prompt that only mentions a PDF is not an attachment", () => {
  const h = harness(`<div data-testid="conversation-turn-1">
    <div data-message-author-role="user"><div data-user-message-bubble>请总结这篇 PDF 论文的主要贡献…</div></div>
  </div>`);
  const user = h.extractConversationTranscript().messages.find((message) => message.role === "user");
  assert.deepEqual(Array.from(user.attachments || []), []);
});

test("a card whose label shares the name's text node still verifies", () => {
  const expected = "Xu 等 - 2026 - Never Too Cocky to Cooperate An FIM and RL-Based USV-AUV Collaborative System for Underwater Tasks.pdf";
  const h = harness(`<div data-testid="conversation-turn-1">
    <div class="card"><div class="name">Xu 等 - 2026 - Never Too Cocky to Co… PDF</div></div>
    <div data-message-author-role="user"><div data-user-message-bubble>请概述。</div></div>
  </div>`);
  const user = h.extractConversationTranscript().messages.find((message) => message.role === "user");
  const contract = shared.classifySubmittedPdfContract(user.attachments || [], expected);
  assert.equal(contract.contractVerified, true);
});

test("finds the card without any site turn attribute", () => {
  // Current ChatGPT no longer exposes a conversation-turn testid, so the
  // boundary has to come from the structure instead.
  const expected = "Xu 等 - 2026 - Never Too Cocky to Cooperate.pdf";
  const h = harness(`<div class="turn-shell">
    <div class="card"><div class="name">Xu 等 - 2026 - Never Too Cocky to Co…</div><div class="type">PDF</div></div>
    <div data-message-author-role="user"><div data-user-message-bubble>请概述。</div></div>
  </div>
  <div data-message-author-role="assistant"><p>本文研究……</p></div>`);
  const user = h.extractConversationTranscript().messages.find((message) => message.role === "user");
  const contract = shared.classifySubmittedPdfContract(user.attachments || [], expected);
  assert.equal(contract.contractVerified, true);
});

test("never reads a sibling message's citations as this turn's attachment", () => {
  const h = harness(`<div class="thread">
    <div class="card"><div class="name">Earlier answer citation.pdf</div><div class="type">PDF</div></div>
    <div data-message-author-role="user"><div data-user-message-bubble>只要问题，没有附件。</div></div>
    <div data-message-author-role="assistant">参考 Xu 等 - 2026 - Never Too Cocky …</div>
  </div>`);
  const user = h.extractConversationTranscript().messages.find((message) => message.role === "user");
  assert.deepEqual(Array.from(user.attachments || []), []);
});

test("finds a card rendered as the block above the bubble", () => {
  const expected = "Xu 等 - 2026 - Never Too Cocky to Cooperate.pdf";
  const h = harness(`<div class="thread">
    <div class="block">
      <div class="card" title="${expected}"><div class="name">Never Too Cocky to Co…</div><div class="type">PDF</div></div>
    </div>
    <div class="bubble">
      <div data-message-author-role="user"><div data-user-message-bubble>请概述。</div></div>
    </div>
  </div>`);
  const user = h.extractConversationTranscript().messages.find((message) => message.role === "user");
  const contract = shared.classifySubmittedPdfContract(user.attachments || [], expected);
  assert.equal(contract.contractVerified, true);
});

test("a previous turn above the bubble is not this turn's attachment", () => {
  const h = harness(`<div class="thread">
    <div class="previous-turn">
      <div class="card"><div class="name">Previous turn paper.pdf</div><div class="type">PDF</div></div>
      <div data-message-author-role="assistant">上一轮的回答。</div>
    </div>
    <div data-message-author-role="user"><div data-user-message-bubble>新一轮提问，没有附件。</div></div>
  </div>`);
  const user = h.extractConversationTranscript().messages.find((message) => message.role === "user");
  assert.deepEqual(Array.from(user.attachments || []), []);
});
