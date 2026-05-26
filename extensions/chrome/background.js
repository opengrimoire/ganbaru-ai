const HOST_NAME = "org.opengrimoire.ganbaruai.stopper";
const STATUS_STORAGE_KEY = "status";
const BLOCKED_PAGE_STORAGE_PREFIX = "blockedPage:";
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

function blockedPageStore() {
  return chrome.storage.session ?? chrome.storage.local;
}

async function storeBlockedPageState(originalUrl, decision) {
  const host = decision.host ?? hostFromUrl(originalUrl);
  const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  await blockedPageStore().set({
    [`${BLOCKED_PAGE_STORAGE_PREFIX}${id}`]: {
      host,
      remainingSeconds: typeof decision.remainingSeconds === "number"
        ? decision.remainingSeconds
        : null,
      createdAt: Date.now(),
    },
  });
  return id;
}

function blockedPageUrl(blockedPageId) {
  const params = new URLSearchParams();
  params.set("blocked", blockedPageId);
  return chrome.runtime.getURL(`blocked.html?${params.toString()}`);
}

async function decideAndRedirect(tabId, url) {
  if (!isSupportedPageUrl(url)) return;
  const host = hostFromUrl(url);
  if (!host) return;
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
  const blockedPageId = await storeBlockedPageState(url, decision);
  await chrome.tabs.update(tabId, { url: blockedPageUrl(blockedPageId) });
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
