const params = new URLSearchParams(location.search);
const blockedPageId = params.get("blocked") ?? "";

const titleEl = document.getElementById("blocked-title");
const remainingEl = document.getElementById("remaining");
const closeButton = document.getElementById("close");
const faviconEl = document.getElementById("favicon");

const BLOCKED_PAGE_STORAGE_PREFIX = "blockedPage:";

function blockedPageStore() {
  return chrome.storage.session ?? chrome.storage.local;
}

function faviconUrl(siteHost) {
  const pageUrl = `https://${siteHost}/`;
  const encoded = encodeURIComponent(pageUrl);
  return chrome.runtime.getURL(`/_favicon/?pageUrl=${encoded}&size=64`);
}

function displayHost(siteHost) {
  return siteHost.replace(/^www\./i, "");
}

async function loadBlockedPageState() {
  if (!blockedPageId) return null;
  const key = `${BLOCKED_PAGE_STORAGE_PREFIX}${blockedPageId}`;
  const stored = await blockedPageStore().get(key);
  return stored[key] ?? null;
}

const state = await loadBlockedPageState();
const host = typeof state?.host === "string" ? state.host : "";
const remaining = typeof state?.remainingSeconds === "number" ? state.remainingSeconds : 0;

titleEl.textContent = `${host ? displayHost(host) : "This site"} is blocked`;
remainingEl.textContent = Number.isFinite(remaining) && remaining > 0
  ? `${Math.ceil(remaining / 60)} min left in focus`
  : "Focus session active";

if (host) faviconEl.src = faviconUrl(host);
faviconEl.addEventListener("load", () => {
  faviconEl.hidden = false;
});
faviconEl.addEventListener("error", () => {
  faviconEl.hidden = true;
});

closeButton.addEventListener("click", () => {
  chrome.tabs.getCurrent((tab) => {
    if (tab?.id) {
      chrome.tabs.remove(tab.id);
      return;
    }
    chrome.runtime.sendMessage({ type: "close_tab" });
  });
});
