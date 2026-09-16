import type { EngagementEvent } from "../core/engagement.js";
let enabled = false;
export function enableEngagement(value: boolean) {
  enabled = value;
}
export function track(event: EngagementEvent, onceKey?: string) {
  if (!enabled || navigator.doNotTrack === "1") return;
  try {
    if (onceKey) {
      const key = "ghtrends:event:" + event + ":" + onceKey;
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, "1");
    }
    void fetch("/api/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event }),
      keepalive: true,
    }).catch(() => {});
  } catch {
    /* Metrics must never block research. */
  }
}
