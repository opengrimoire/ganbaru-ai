const HOST_NAME = "org.opengrimoire.ganbaruai.stopper";
const TEMP_ALLOW_MINUTES = 5;
const TEMP_ALLOW_STORAGE_KEY = "temporaryAllowedHosts";
const STATUS_STORAGE_KEY = "status";
const recentRedirects = new Map();

function sendNativeMessage(message) {
  return new Promise((resolve) => {
    chrome.runtime.sendNativeMessage(HOST_NAME, message, (response) => {
      const error = chrome.runtime.lastError;
      if (error) {
        resolve({
          type: "error",
          connected: false,
          active: false,
          blocked: false,
          reason: error.message,
        });
        return;
      }
      resolve(response);
    });
  });
}

function isSupportedPageUrl(url) {
  return typeof url === "string" && (url.startsWith("http://") || url.startsWith("https://"));
}

function hostFromUrl(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function hostMatchesRule(host, ruleHost) {
  return host === ruleHost || host.endsWith(`.${ruleHost}`);
}

async function getTemporaryAllowedHosts() {
  const stored = await chrome.storage.local.get(TEMP_ALLOW_STORAGE_KEY);
  const value = stored[TEMP_ALLOW_STORAGE_KEY];
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

async function isTemporarilyAllowed(host) {
  const allowedHosts = await getTemporaryAllowedHosts();
  const now = Date.now();
  let changed = false;

  for (const [ruleHost, expiresAt] of Object.entries(allowedHosts)) {
    if (typeof expiresAt !== "number" || expiresAt <= now) {
      delete allowedHosts[ruleHost];
      changed = true;
      continue;
    }
    if (hostMatchesRule(host, ruleHost)) {
      if (changed) {
        await chrome.storage.local.set({ [TEMP_ALLOW_STORAGE_KEY]: allowedHosts });
      }
      return true;
    }
  }

  if (changed) {
    await chrome.storage.local.set({ [TEMP_ALLOW_STORAGE_KEY]: allowedHosts });
  }
  return false;
}

async function allowHostTemporarily(host) {
  const allowedHosts = await getTemporaryAllowedHosts();
  allowedHosts[host] = Date.now() + TEMP_ALLOW_MINUTES * 60 * 1000;
  await chrome.storage.local.set({ [TEMP_ALLOW_STORAGE_KEY]: allowedHosts });
}

async function updateStatus(status) {
  await chrome.storage.local.set({
    [STATUS_STORAGE_KEY]: {
      connected: status.connected === true,
      active: status.active === true,
      phase: typeof status.phase === "string" ? status.phase : "inactive",
      remainingSeconds: typeof status.remainingSeconds === "number" ? status.remainingSeconds : null,
      reason: typeof status.reason === "string" ? status.reason : null,
      lastBlockedHost: typeof status.lastBlockedHost === "string" ? status.lastBlockedHost : null,
      updatedAt: new Date().toISOString(),
    },
  });
}

function blockedPageUrl(originalUrl, decision) {
  const params = new URLSearchParams();
  params.set("url", originalUrl);
  if (decision.host) params.set("host", decision.host);
  if (decision.matchedRuleName) params.set("rule", decision.matchedRuleName);
  if (typeof decision.remainingSeconds === "number") {
    params.set("remaining", String(decision.remainingSeconds));
  }
  return chrome.runtime.getURL(`blocked.html?${params.toString()}`);
}

async function decideAndRedirect(tabId, url) {
  if (!isSupportedPageUrl(url)) return;
  const host = hostFromUrl(url);
  if (!host || await isTemporarilyAllowed(host)) return;
  const redirectKey = `${tabId}:${url}`;
  const lastRedirect = recentRedirects.get(redirectKey);
  if (typeof lastRedirect === "number" && Date.now() - lastRedirect < 3000) return;

  const decision = await sendNativeMessage({ type: "decide_url", url, host });
  await updateStatus({
    ...decision,
    lastBlockedHost: decision?.blocked ? host : null,
  });

  if (!decision || decision.blocked !== true) return;
  recentRedirects.set(redirectKey, Date.now());
  if (recentRedirects.size > 100) {
    const cutoff = Date.now() - 10_000;
    for (const [key, value] of recentRedirects.entries()) {
      if (value < cutoff) recentRedirects.delete(key);
    }
  }
  await chrome.tabs.update(tabId, { url: blockedPageUrl(url, decision) });
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  const url = changeInfo.url ?? tab.url;
  if (!url) return;
  void decideAndRedirect(tabId, url);
});

chrome.webNavigation.onCommitted.addListener((details) => {
  if (details.frameId !== 0) return;
  void decideAndRedirect(details.tabId, details.url);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message !== "object") return false;

  if (message.type === "get_status") {
    sendNativeMessage({ type: "get_state" })
      .then(async (state) => {
        await updateStatus(state);
        sendResponse(state);
      });
    return true;
  }

  if (message.type === "allow_temporary") {
    const host = typeof message.host === "string" ? message.host : null;
    const url = typeof message.url === "string" ? message.url : null;
    if (!host || !url || !sender.tab?.id) {
      sendResponse({ ok: false });
      return false;
    }
    allowHostTemporarily(host)
      .then(() => chrome.tabs.update(sender.tab.id, { url }))
      .then(() => sendResponse({ ok: true }));
    return true;
  }

  if (message.type === "close_tab") {
    if (sender.tab?.id) {
      chrome.tabs.remove(sender.tab.id);
      sendResponse({ ok: true });
      return false;
    }
  }

  return false;
});

void sendNativeMessage({ type: "get_state" }).then(updateStatus);
