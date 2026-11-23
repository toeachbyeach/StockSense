const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const log = require('../logger');

puppeteer.use(StealthPlugin());

const DEFAULT_PUPPETEER_ARGS = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',       // Prevents /dev/shm exhaustion in Docker containers
  '--disable-gpu',                 // Prevents GPU process fork failures in headless environments
  '--no-zygote',                   // Avoids zygote process tree fork overhead in container
  '--disable-breakpad',            // Disables crashpad handler threads
  '--disable-crash-reporter',
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-background-networking',
  '--disable-background-timer-throttling',
  '--disable-backgrounding-occluded-windows',
  '--disable-renderer-backgrounding',
  '--disable-blink-features=AutomationControlled',
  '--mute-audio',
  '--disable-ipc-flooding-protection'
];

/**
 * Launches a hardened Chromium instance suitable for Docker containers.
 * @param {string[]} customArgs - Additional CLI args to include.
 * @returns {Promise<import('puppeteer').Browser>}
 */
async function launchBrowser(customArgs = []) {
  const args = [...DEFAULT_PUPPETEER_ARGS, ...customArgs];
  return await puppeteer.launch({
    headless: "new",
    args
  });
}

/**
 * Safely closes a browser instance, ensuring no lingering processes or zombies.
 * @param {import('puppeteer').Browser} browser
 */
async function safeCloseBrowser(browser) {
  if (!browser) return;
  try {
    const proc = browser.process();
    await Promise.race([
      browser.close().catch(() => {}),
      new Promise(resolve => setTimeout(resolve, 5000))
    ]);
    if (proc && !proc.killed) {
      try {
        proc.kill('SIGKILL');
      } catch (_) {}
    }
  } catch (e) {
    try {
      browser.process()?.kill('SIGKILL');
    } catch (_) {}
  }
}

// Concurrency mutex: ensures only 1 browser instance runs at a time
// to prevent thread/PID exhaustion inside containerized environments.
let lockChain = Promise.resolve();

function withScraperLock(fn) {
  const result = lockChain.then(() => fn());
  // Keep chain going even if current task throws
  lockChain = result.catch(() => {});
  return result;
}

module.exports = {
  puppeteer,
  DEFAULT_PUPPETEER_ARGS,
  launchBrowser,
  safeCloseBrowser,
  withScraperLock
};
