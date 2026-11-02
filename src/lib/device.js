// Device context that can accompany an alert. Pure helpers plus one browser-only watcher.
// The Battery Status API exists in Chrome/Edge/Android only. Where it is missing Saathi reports
// "not available" instead of inventing a number.

export const LOW_BATTERY_PERCENT = 15;

export function normalizeBattery(raw) {
  if (!raw || !Number.isFinite(Number(raw.level))) return null;
  const level = Math.round(Math.min(1, Math.max(0, Number(raw.level))) * 100);
  return { level, charging: Boolean(raw.charging) };
}

export const batteryLabel = (b) => (b ? `${b.level}%${b.charging ? " · charging" : ""}` : "Not available on this browser");

export const isLowBattery = (b, threshold = LOW_BATTERY_PERCENT) => Boolean(b && !b.charging && b.level <= threshold);

// Calls onChange(battery|null) now and whenever level/charging changes. Returns a cleanup function.
export function watchBattery(onChange) {
  if (typeof navigator === "undefined" || typeof navigator.getBattery !== "function") {
    onChange(null);
    return () => {};
  }
  let manager = null;
  let stopped = false;
  const read = () => onChange(normalizeBattery({ level: manager.level, charging: manager.charging }));
  navigator.getBattery().then((m) => {
    if (stopped) return;
    manager = m;
    read();
    m.addEventListener("levelchange", read);
    m.addEventListener("chargingchange", read);
  }).catch(() => onChange(null));
  return () => {
    stopped = true;
    if (manager) {
      manager.removeEventListener("levelchange", read);
      manager.removeEventListener("chargingchange", read);
    }
  };
}
