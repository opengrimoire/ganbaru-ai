const connectionEl = document.getElementById("connection");
const modeEl = document.getElementById("mode");
const remainingEl = document.getElementById("remaining");
const lastBlockedEl = document.getElementById("last-blocked");
const reasonEl = document.getElementById("reason");

function phaseLabel(phase) {
  if (phase === "focus") return "Focus";
  if (phase === "short_break") return "Short break";
  if (phase === "long_break") return "Long break";
  return "Inactive";
}

function render(state) {
  connectionEl.textContent = state.connected ? "Connected" : "Disconnected";
  modeEl.textContent = state.active ? phaseLabel(state.phase) : "Inactive";
  remainingEl.textContent = typeof state.remainingSeconds === "number"
    ? `${Math.ceil(state.remainingSeconds / 60)} min`
    : "-";
  lastBlockedEl.textContent = state.lastBlockedHost ?? "-";
  reasonEl.textContent = state.reason ?? "";
}

chrome.runtime.sendMessage({ type: "get_status" }, async (fresh) => {
  if (fresh) {
    render(fresh);
    return;
  }
  const stored = await chrome.storage.local.get("status");
  render(stored.status ?? { connected: false, active: false, phase: "inactive" });
});
