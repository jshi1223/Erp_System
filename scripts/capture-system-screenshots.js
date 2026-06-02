const fs = require('fs/promises');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

const BROWSER_PATHS = [
  'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
];

const BASE_URL = process.env.KVSK_DOCS_BASE_URL || 'http://localhost:3000';
const DEBUG_PORT = 9222;
const VIEWPORT = { width: 1920, height: 1080, deviceScaleFactor: 1 };
const LOGIN_USERNAME = process.env.KVSK_DOCS_LOGIN_USER || 'admin';
const LOGIN_PASSWORD = process.env.KVSK_DOCS_LOGIN_PASS || 'admin123';

const screenshots = [
  { file: '01-dashboard.png', url: `${BASE_URL}/admin`, waitFor: '#dashboard' },
  { file: '02-projects.png', url: `${BASE_URL}/admin?panel=project-records`, waitFor: '#project-records-section' },
  { file: '03-ongoing-projects.png', url: `${BASE_URL}/admin?view=ongoing-projects`, waitFor: '#ongoing-projects-body' },
  { file: '04-project-transactions.png', url: `${BASE_URL}/admin?view=all`, waitFor: '#table-body' },
  { file: '05-service-orders.png', url: `${BASE_URL}/service-operations`, waitFor: '#accounts-receivable-page, .accounts-receivable-page' },
  { file: '06-ap-purchasing.png', url: `${BASE_URL}/accounts-payable?tab=purchase-orders`, waitFor: '#ap-purchasing-root' },
  { file: '07-accounts-payable.png', url: `${BASE_URL}/accounts-payable`, waitFor: '#accounts-payable-page, .accounts-payable-page' },
  { file: '08-accounts-receivable.png', url: `${BASE_URL}/accounts-receivable`, waitFor: '#accounts-receivable-page, .accounts-receivable-page' },
  { file: '09-reports.png', url: `${BASE_URL}/reports`, waitFor: '#reports-page, .reports-page' },
  { file: '10-sidebar-open.png', url: `${BASE_URL}/admin`, waitFor: '#dashboard', openSidebar: true }
];

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function escapeRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function waitForDebugger(port) {
  const url = `http://127.0.0.1:${port}/json/version`;
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) {
        return await res.json();
      }
    } catch (_) {}
    await delay(250);
  }
  throw new Error(`Timed out waiting for browser debugger on port ${port}`);
}

async function openPageSocket(port) {
  const listUrl = `http://127.0.0.1:${port}/json/list`;
  const res = await fetch(listUrl);
  if (!res.ok) {
    throw new Error(`Unable to read Edge targets (${res.status})`);
  }
  const targets = await res.json();
  const page = (Array.isArray(targets) ? targets : []).find((target) => target.type === 'page');
  if (!page?.webSocketDebuggerUrl) {
    throw new Error('No page target available for browser automation.');
  }
  return page.webSocketDebuggerUrl;
}

function createCdpClient(wsUrl) {
  const ws = new WebSocket(wsUrl);
  const pending = new Map();
  let nextId = 1;

  ws.addEventListener('message', (event) => {
    const text = typeof event.data === 'string' ? event.data : Buffer.from(event.data).toString('utf8');
    const msg = JSON.parse(text);
    if (msg.id) {
      const entry = pending.get(msg.id);
      if (!entry) return;
      pending.delete(msg.id);
      if (msg.error) {
        entry.reject(new Error(msg.error.message || `CDP error for ${entry.method}`));
      } else {
        entry.resolve(msg.result || {});
      }
    }
  });

  const ready = new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', reject, { once: true });
  });

  return {
    ready,
    async send(method, params = {}) {
      await ready;
      const id = nextId++;
      const payload = { id, method, params };
      const result = new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject, method });
      });
      ws.send(JSON.stringify(payload));
      return result;
    },
    close() {
      try { ws.close(); } catch (_) {}
    }
  };
}

async function waitForExpression(client, expression, timeoutMs = 10000, intervalMs = 250) {
  const deadline = Date.now() + timeoutMs;
  let lastValue = null;
  while (Date.now() < deadline) {
    const result = await client.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true
    });
    lastValue = result?.result?.value;
    if (lastValue) return lastValue;
    await delay(intervalMs);
  }
  throw new Error(`Timed out waiting for expression: ${expression}`);
}

async function waitForLocationPath(client, pathName, timeoutMs = 10000) {
  const pattern = new RegExp(`^${escapeRegExp(pathName)}(?:[?#].*)?$`);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await client.send('Runtime.evaluate', {
      expression: 'location.pathname + location.search + location.hash',
      returnByValue: true
    });
    const current = String(result?.result?.value || '');
    if (pattern.test(current)) return current;
    await delay(200);
  }
  throw new Error(`Timed out waiting for navigation to ${pathName}`);
}

async function waitForReady(client, selector, timeoutMs = 15000) {
  const selectors = String(selector || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await client.send('Runtime.evaluate', {
      expression: `(() => {
        const ready = document.readyState === 'complete';
        const selectors = ${JSON.stringify(selectors)};
        const ok = !selectors.length || selectors.some((sel) => !!document.querySelector(sel));
        return ready && ok;
      })()`,
      returnByValue: true
    });
    if (result?.result?.value) return true;
    await delay(250);
  }
  throw new Error(`Timed out waiting for ${selector || 'page'} to load`);
}

async function capturePage(client, filePath, { url, waitFor, openSidebar = false }) {
  await client.send('Page.navigate', { url });
  await waitForReady(client, waitFor);
  await delay(1000);

  if (openSidebar) {
    await client.send('Runtime.evaluate', {
      expression: `(() => {
        const btn = document.querySelector('.sidebar-toggle-btn');
        if (btn) btn.click();
        return !!btn;
      })()`,
      returnByValue: true
    });
    await delay(900);
  }

  const shot = await client.send('Page.captureScreenshot', {
    format: 'png',
    fromSurface: true,
    captureBeyondViewport: false
  });
  await fs.writeFile(filePath, Buffer.from(shot.data, 'base64'));
}

async function main() {
  const browserPath = BROWSER_PATHS.find((candidate) => {
    try {
      return require('fs').existsSync(candidate);
    } catch (_) {
      return false;
    }
  });
  if (!browserPath) {
    throw new Error('No supported browser found on this machine.');
  }

  const outputDir = path.join(__dirname, '..', 'docs', 'screenshots');
  await fs.mkdir(outputDir, { recursive: true });

  const userDataDir = path.join(os.tmpdir(), `kinaadman-browser-${Date.now()}`);
  const browserArgs = [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--hide-scrollbars',
    '--remote-debugging-port=' + DEBUG_PORT,
    '--window-size=1920,1080',
    '--force-device-scale-factor=1',
    '--user-data-dir=' + userDataDir,
    'about:blank'
  ];

  const browser = spawn(browserPath, browserArgs, {
    stdio: 'ignore',
    detached: false,
    windowsHide: true
  });

  try {
    await waitForDebugger(DEBUG_PORT);
    const wsUrl = await openPageSocket(DEBUG_PORT);
    const client = createCdpClient(wsUrl);
    await client.ready;
    await client.send('Page.enable');
    await client.send('Runtime.enable');
    await client.send('Network.enable');
    await client.send('DOM.enable');
    await client.send('Emulation.setDeviceMetricsOverride', {
      width: VIEWPORT.width,
      height: VIEWPORT.height,
      deviceScaleFactor: VIEWPORT.deviceScaleFactor,
      mobile: false
    });

    await client.send('Page.navigate', { url: `${BASE_URL}/login` });
    await waitForReady(client, '#login-form');
    const loginResult = await client.send('Runtime.evaluate', {
      expression: `((username, password) => (async () => {
        const res = await fetch('/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password })
        });
        const data = await res.json().catch(() => ({}));
        return { ok: res.ok, status: res.status, data };
      })())(${JSON.stringify(LOGIN_USERNAME)}, ${JSON.stringify(LOGIN_PASSWORD)})`,
      returnByValue: true,
      awaitPromise: true
    });
    const loginPayload = loginResult?.result?.value || {};
    if (!loginPayload.ok || loginPayload?.data?.status !== 'success') {
      throw new Error(loginPayload?.data?.message || `Login failed with HTTP ${loginPayload.status || 'unknown'}`);
    }

    await client.send('Page.navigate', { url: `${BASE_URL}/admin` });
    await waitForReady(client, '#dashboard');
    await delay(1500);

    for (const shot of screenshots) {
      const filePath = path.join(outputDir, shot.file);
      await capturePage(client, filePath, shot);
    }

    client.close();
  } finally {
    try {
      browser.kill('SIGTERM');
    } catch (_) {}
    await delay(500);
    try {
      if (!browser.killed) browser.kill('SIGKILL');
    } catch (_) {}
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
