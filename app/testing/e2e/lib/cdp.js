/**
 * A minimal Chrome DevTools Protocol driver: enough to open pages, click, type, read text and
 * take screenshots, with no dependency beyond Node's built-in WebSocket (Node 22+).
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { findChrome, ARTIFACT_DIR } from './config.js';

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Launch headless Chrome with a throwaway profile (so nothing is remembered between runs).
 * @returns {Promise<{port: number, close: () => void}>}
 */
export async function launchChrome() {
  const binary = findChrome();
  if (!binary) {
    throw new Error('Chrome not found. Install Chrome/Chromium or set CHROME_PATH to its executable.');
  }

  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'triviaforge-chrome-'));
  const proc = spawn(
    binary,
    [
      '--headless=new',
      '--remote-debugging-port=0', // pick a free port; Chrome reports it in DevToolsActivePort
      `--user-data-dir=${profile}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-gpu',
      '--hide-scrollbars',
      '--no-sandbox', // needed when running as root in containers/CI
      'about:blank',
    ],
    { stdio: 'ignore' }
  );

  let port = null;
  for (let i = 0; i < 100 && !port; i++) {
    try {
      port = parseInt(fs.readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0], 10);
    } catch {
      await sleep(150);
    }
  }
  if (!port) {
    proc.kill();
    throw new Error('Chrome did not start (no DevTools port).');
  }

  return {
    port,
    close: () => {
      proc.kill();
      fs.rmSync(profile, { recursive: true, force: true });
    },
  };
}

export class Page {
  /** Open a new tab. */
  static async open(chrome, url = 'about:blank') {
    const res = await fetch(`http://127.0.0.1:${chrome.port}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' });
    const target = await res.json();
    const page = new Page(target.webSocketDebuggerUrl);
    await page.ready;
    await page.send('Page.enable');
    await page.send('Runtime.enable');
    page.errors = [];
    page.on('Runtime.exceptionThrown', (p) => page.errors.push(p.exceptionDetails?.exception?.description || p.exceptionDetails?.text));
    page.on('Runtime.consoleAPICalled', (p) => {
      if (p.type === 'error') page.errors.push('console.error: ' + p.args.map((a) => a.value ?? a.description).join(' '));
    });
    return page;
  }

  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.id = 0;
    this.pending = new Map();
    this.handlers = new Map();
    this.ready = new Promise((resolve) => this.ws.addEventListener('open', resolve));
    this.ws.addEventListener('message', (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
      } else if (msg.method) {
        (this.handlers.get(msg.method) || []).forEach((handler) => handler(msg.params));
      }
    });
  }

  on(method, fn) {
    this.handlers.set(method, [...(this.handlers.get(method) || []), fn]);
  }

  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }

  async goto(url) {
    await this.send('Page.navigate', { url });
    await sleep(900);
  }

  /** Evaluate an expression in the page (awaits promises) and return its value. */
  async eval(expression) {
    const r = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) {
      throw new Error('eval failed: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text) + '\n' + expression.slice(0, 200));
    }
    return r.result.value;
  }

  async waitFor(expression, { timeout = 8000, label = expression } = {}) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      try {
        if (await this.eval(expression)) return true;
      } catch {
        // the page may be mid-navigation
      }
      await sleep(100);
    }
    throw new Error(`timed out waiting for: ${label}`);
  }

  setViewport(width, height, mobile = false) {
    return this.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile });
  }

  /** Save a screenshot (into TEST_ARTIFACTS_DIR) and return its path. */
  async shot(name) {
    if (this.closed) throw new Error('tab is closed');
    fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
    const file = path.join(ARTIFACT_DIR, `${name}.png`);
    const r = await Promise.race([
      this.send('Page.captureScreenshot', { format: 'png' }),
      sleep(5000).then(() => { throw new Error('screenshot timed out'); }),
    ]);
    fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
    return file;
  }

  // ---- reading the page (text matching ignores case: CSS often uppercases labels) ----

  text() {
    return this.eval('document.body.innerText');
  }

  has(text) {
    return this.eval(`document.body.innerText.toLowerCase().includes(${JSON.stringify(text.toLowerCase())})`);
  }

  waitText(text, opts) {
    return this.waitFor(`document.body.innerText.toLowerCase().includes(${JSON.stringify(text.toLowerCase())})`, {
      ...opts,
      label: `text "${text}"`,
    });
  }

  /** Is an element on the page AND actually visible (v-show keeps hidden elements in the DOM)? */
  visible(selector) {
    return this.eval(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); return !!e && e.getClientRects().length > 0; })()`);
  }

  count(selector) {
    return this.eval(`document.querySelectorAll(${JSON.stringify(selector)}).length`);
  }

  // ---- acting on the page ----

  /** Click the first enabled element matching `selector` whose text contains `text`. */
  clickText(text, selector = 'button') {
    return this.eval(`(() => {
      const el = [...document.querySelectorAll(${JSON.stringify(selector)})].find(b => b.innerText.trim().includes(${JSON.stringify(text)}) && !b.disabled);
      if (!el) throw new Error('no enabled ' + ${JSON.stringify(selector)} + ' with text: ' + ${JSON.stringify(text)});
      el.click();
      return true;
    })()`);
  }

  /** Set an input's value the way a user typing would (fires input + change). */
  fill(selector, value) {
    return this.eval(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) throw new Error('no element ' + ${JSON.stringify(selector)});
      el.value = ${JSON.stringify(value)};
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()`);
  }

  mouse(type, x, y, extra = {}) {
    return this.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', ...extra });
  }

  /**
   * Drag like a person does, through Chrome's own drag-and-drop machinery: press on the source, move
   * until the browser starts the drag, hover the target and release. (Dispatching DragEvents from a
   * script skips all of that, and misses bugs such as a drag that Chrome cancels because the layout
   * moved when it started.)
   *
   * @param {{selector: string, index: number}} source - the element to pick up
   * @param {string} targetExpr - a page expression giving the drop point `{x, y}`. It is evaluated
   *   after the drag has started, so it sees any layout change the drag caused.
   * @returns {Promise<{started: boolean, cancelled: boolean}>} `cancelled` = the page got a dragend
   *   before the drop, i.e. the browser abandoned the drag
   */
  async realDrag({ selector, index }, targetExpr) {
    if (!this.dragging) {
      this.dragging = { data: null };
      await this.send('Input.setInterceptDrags', { enabled: true });
      this.on('Input.dragIntercepted', (p) => (this.dragging.data = p.data));
    }
    this.dragging.data = null;
    await this.eval(`window.__dragEnded = false; if (!window.__dragListener) { window.__dragListener = true; document.addEventListener('dragend', () => (window.__dragEnded = true), true); } true`);
    const src = await this.center(selector, index);
    await this.mouse('mouseMoved', src.x, src.y, { button: 'none' });
    await this.mouse('mousePressed', src.x, src.y, { buttons: 1, clickCount: 1 });
    for (let i = 1; i <= 5; i++) {
      await this.mouse('mouseMoved', src.x + i * 3, src.y + i * 3, { buttons: 1 });
      await sleep(30);
    }
    await sleep(200);
    if (!this.dragging.data) {
      await this.mouse('mouseReleased', src.x, src.y, { buttons: 0, clickCount: 1 });
      return { started: false, cancelled: await this.eval('window.__dragEnded') };
    }
    const data = this.dragging.data;
    const target = await this.eval(targetExpr);
    const steps = 8;
    for (let i = 1; i <= steps; i++) {
      const x = src.x + ((target.x - src.x) * i) / steps;
      const y = src.y + ((target.y - src.y) * i) / steps;
      await this.send('Input.dispatchDragEvent', { type: i === 1 ? 'dragEnter' : 'dragOver', x, y, data });
      await sleep(40);
    }
    await this.send('Input.dispatchDragEvent', { type: 'dragOver', x: target.x, y: target.y, data });
    await sleep(80);
    const cancelled = await this.eval('window.__dragEnded');
    await this.send('Input.dispatchDragEvent', { type: 'drop', x: target.x, y: target.y, data });
    await this.mouse('mouseReleased', target.x, target.y, { buttons: 0, clickCount: 1 });
    return { started: true, cancelled };
  }

  /** Where to click an element: its centre-left, scrolled into view. */
  center(selector, index = 0) {
    return this.eval(`(() => {
      const e = document.querySelectorAll(${JSON.stringify(selector)})[${index}];
      e.scrollIntoView({ block: 'center' });
      const r = e.getBoundingClientRect();
      return { x: r.x + Math.min(40, r.width / 2), y: r.y + r.height / 2, right: r.right - 10 };
    })()`);
  }

  /** Close the tab itself (closing only the DevTools connection would leave the page running). */
  async closeTab() {
    this.closed = true;
    await this.send('Page.close').catch(() => {});
    await sleep(1800);
  }

  disconnect() {
    try {
      this.ws.close();
    } catch {
      // already closed
    }
  }

  /** Errors worth failing a test over: uncaught exceptions and console errors, minus known noise. */
  realErrors() {
    return this.errors.filter((e) => !/favicon|Failed to load resource|net::ERR|WebSocket|WAKE LOCK|ResizeObserver/i.test(e));
  }
}
