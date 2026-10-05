import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = fs.readFileSync(
  new URL("../extension/content_script.js", import.meta.url),
  "utf8",
);
const helperCode = source.slice(
  source.indexOf("function applyFilesToComposerFileInput("),
  source.indexOf("async function attachPDF("),
);

function createHarness({ inputs = [] } = {}) {
  const dispatched = [];
  class FakeDataTransfer {
    constructor() {
      this.items = {
        added: [],
        add(file) {
          this.added.push(file);
        },
      };
      Object.defineProperty(this, "files", {
        get: () => ({ length: this.items.added.length, items: this.items.added }),
      });
    }
  }
  class FakeEvent {
    constructor(type, options = {}) {
      this.type = type;
      this.bubbles = options.bubbles === true;
    }
  }
  const document = {
    querySelector(selector) {
      return inputs.find((input) => input.selector === selector) || null;
    },
  };
  const file = { name: "paper.pdf", type: "application/pdf" };
  const context = vm.createContext({
    DataTransfer: FakeDataTransfer,
    Event: FakeEvent,
    document,
    files: [file],
  });
  vm.runInContext(helperCode, context);
  return {
    file,
    dispatched,
    run(selectors) {
      return vm.runInContext(
        `applyFilesToComposerFileInput(files, ${JSON.stringify(selectors)})`,
        context,
      );
    },
  };
}

function makeInput(overrides = {}) {
  const dispatched = [];
  return {
    selector: 'input[type="file"]',
    tagName: "INPUT",
    type: "file",
    disabled: false,
    accept: ".pdf,.png,.txt",
    files: null,
    dispatchEvent(event) {
      dispatched.push(event.type);
      return true;
    },
    dispatched,
    ...overrides,
  };
}

test("attaches the file through the composer file input when one exists", () => {
  const input = makeInput();
  const harness = createHarness({ inputs: [input] });

  const applied = harness.run(['input[type="file"]']);

  assert.equal(applied, true);
  assert.ok(input.files);
  assert.equal(input.files.length, 1);
  assert.deepEqual(input.dispatched, ["input", "change"]);
});

test("falls back when no file input matches", () => {
  const harness = createHarness({ inputs: [] });

  const applied = harness.run(['input[type="file"]']);

  assert.equal(applied, false);
});

test("ignores disabled inputs and inputs that reject PDFs", () => {
  const disabled = makeInput({ disabled: true });
  const noPdf = makeInput({ accept: ".png,.jpg", selector: 'input[accept*="image"]' });
  const harness = createHarness({ inputs: [disabled, noPdf] });

  const applied = harness.run(['input[type="file"]', 'input[accept*="image"]']);

  assert.equal(applied, false);
  assert.equal(disabled.dispatched.length, 0);
  assert.equal(noPdf.dispatched.length, 0);
});
