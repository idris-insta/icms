import { create } from "zustand";
import { apiFetch } from "../lib/core";

const THEME_KEY = "icms_theme";
const PAGE_KEY = "icms_page";

/**
 * Cross-cutting UI state: which page is showing, the theme, and the alert
 * badge count. Previously these were useState in App and a useState inside
 * ThemeToggle that could drift out of sync with the <html> class.
 */
export const useUI = create((set, get) => ({
  page: localStorage.getItem(PAGE_KEY) || "dashboard",
  dark: localStorage.getItem(THEME_KEY) === "dark",
  alertCount: 0,
  _alertTimer: null,

  setPage: (page) => { localStorage.setItem(PAGE_KEY, page); set({ page }); },

  setDark: (dark) => {
    document.documentElement.classList.toggle("dark-invert", dark);
    localStorage.setItem(THEME_KEY, dark ? "dark" : "light");
    set({ dark });
  },
  toggleDark: () => get().setDark(!get().dark),

  /** Apply the persisted theme to <html> on boot. */
  applyTheme: () => {
    document.documentElement.classList.toggle("dark-invert", get().dark);
  },

  refreshAlerts: async () => {
    try {
      const r = await apiFetch("/alerts");
      set({ alertCount: (r.counts?.critical || 0) + (r.counts?.warning || 0) });
    } catch { /* the badge is not worth surfacing an error for */ }
  },

  /** Start the 5-minute alert poll. Idempotent — a second call is a no-op. */
  startAlertPolling: () => {
    if (get()._alertTimer) return;
    get().refreshAlerts();
    const t = setInterval(() => get().refreshAlerts(), 5 * 60 * 1000);
    set({ _alertTimer: t });
  },

  stopAlertPolling: () => {
    const t = get()._alertTimer;
    if (t) clearInterval(t);
    set({ _alertTimer: null });
  },
}));
