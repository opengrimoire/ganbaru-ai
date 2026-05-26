const params = new URLSearchParams(location.search);
const originalUrl = params.get("url") ?? "";
const host = params.get("host") ?? "";
const rule = params.get("rule") ?? "";
const remaining = Number(params.get("remaining") ?? "0");

const hostEl = document.getElementById("host");
const ruleEl = document.getElementById("rule");
const remainingEl = document.getElementById("remaining");
const backButton = document.getElementById("back");
const allowButton = document.getElementById("allow");
const closeButton = document.getElementById("close");

hostEl.textContent = host;
ruleEl.textContent = rule;
remainingEl.textContent = Number.isFinite(remaining) && remaining > 0
  ? `${Math.ceil(remaining / 60)} min left in focus`
  : "";

backButton.addEventListener("click", () => {
  history.back();
});

allowButton.addEventListener("click", () => {
  chrome.runtime.sendMessage({
    type: "allow_temporary",
    host,
    url: originalUrl,
  });
});

closeButton.addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "close_tab" });
});
