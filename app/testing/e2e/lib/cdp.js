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
