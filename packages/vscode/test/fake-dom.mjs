// a minimal DOM for the Cockpit's kit tests (src/cockpit-style.js): just what el/btn/rail/table use. Not a browser:
// no HTML parsing, so a test can prove text never becomes markup.
class FakeText {
  constructor(text) {
    this.nodeType = 3;
    this.textContent = String(text);
  }
}

class FakeElement {
  constructor(tag) {
    this.nodeType = 1;
    this.tagName = String(tag).toUpperCase();
    this.localName = String(tag).toLowerCase();
    this.children = []; // every child node, elements and text
    this.className = "";
    this.dataset = {};
    this.attributes = {};
    this.listeners = {};
    this._text = null;
  }
  get textContent() {
    return this._text !== null ? this._text : this.children.map((c) => c.textContent).join("");
  }
  set textContent(v) {
    this._text = String(v);
    this.children = [];
  }
  append(...kids) {
    for (const k of kids) {
      this._text = null;
      this.children.push(typeof k === "string" ? new FakeText(k) : k);
    }
  }
  replaceChildren(...kids) {
    this._text = null;
    this.children = [];
    this.append(...kids);
  }
  addEventListener(type, fn) {
    (this.listeners[type] ||= []).push(fn);
  }
  dispatch(type, event = {}) {
    for (const fn of this.listeners[type] || []) fn({ type, target: this, ...event });
  }
  setAttribute(k, v) {
    this.attributes[k] = String(v);
  }
  getAttribute(k) {
    if (k === "class") return this.className || null;
    if (k === "title" && this.title !== undefined) return String(this.title);
    return k in this.attributes ? this.attributes[k] : null;
  }
  // every descendant element, depth first
  descendants() {
    return this.children.filter((c) => c.nodeType === 1).flatMap((c) => [c, ...c.descendants()]);
  }
  find(selector) {
    return this.findAll(selector)[0] || null;
  }
  // tag, .class, tag.class (enough for the tests)
  findAll(selector) {
    const [, tag, cls] = /^([a-z0-9]*)(?:\.([\w-]+))?$/i.exec(selector) || [];
    return this.descendants().filter((n) => (!tag || n.localName === tag.toLowerCase()) && (!cls || n.className.split(/\s+/).includes(cls)));
  }
}

export function createDocument() {
  return {
    createElement: (tag) => new FakeElement(tag),
    createTextNode: (text) => new FakeText(text),
  };
}

let previous;
let installed = false;
export function install() {
  if (!installed) previous = Object.getOwnPropertyDescriptor(globalThis, "document");
  installed = true;
  const doc = createDocument();
  globalThis.document = doc;
  return doc;
}
export function uninstall() {
  if (previous) Object.defineProperty(globalThis, "document", previous);
  else delete globalThis.document;
  installed = false;
}
