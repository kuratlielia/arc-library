import { useMemo, useSyncExternalStore } from "react";

/** Shared by calendar and date-range-picker, which both re-export it, so one copy keeps their "today" in step. */
const dateKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const fromKey = (key: string) => {
  const [year = 1970, month = 1, day = 1] = key.split("-").map(Number);
  return new Date(year, month - 1, day);
};

/** Today turns over at local midnight; returning to the tab, focusing the window or waking the device reads it again. */
const subscribeToday = (notify: () => void) => {
  let timer = 0;
  const schedule = () => {
    const now = new Date();
    const nextMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    timer = window.setTimeout(() => { notify(); schedule(); }, nextMidnight.getTime() - now.getTime() + 1000);
  };
  const onVisible = () => { if (document.visibilityState === "visible") notify(); };
  schedule();
  document.addEventListener("visibilitychange", onVisible);
  window.addEventListener("focus", notify);
  return () => { window.clearTimeout(timer); document.removeEventListener("visibilitychange", onVisible); window.removeEventListener("focus", notify); };
};
const readToday = () => dateKey(new Date());
const serverToday = () => "";

/** The viewer's local date. Undefined on the server and during hydration, so markup never depends on the server clock or time zone; afterwards it follows the real date across midnight. */
export function useToday() {
  const key = useSyncExternalStore(subscribeToday, readToday, serverToday);
  return useMemo(() => (key ? fromKey(key) : undefined), [key]);
}
