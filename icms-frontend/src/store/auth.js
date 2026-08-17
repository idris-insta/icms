import { create } from "zustand";
import { apiFetch } from "../lib/core";

/**
 * Authentication state. The token lives in localStorage (apiFetch reads it
 * there) and the decoded user lives here so any component can read it without
 * prop-drilling from App.
 */
export const useAuth = create((set, get) => ({
  user: null,
  ready: false,          // true once the initial /auth/me round-trip has settled
  hydrating: false,

  /** Restore the session from a stored token. Safe to call more than once. */
  hydrate: async () => {
    if (get().hydrating || get().ready) return;
    set({ hydrating: true });
    const token = localStorage.getItem("icms_token");
    if (!token) { set({ user: null, ready: true, hydrating: false }); return; }
    try {
      const user = await apiFetch("/auth/me");
      set({ user, ready: true, hydrating: false });
    } catch {
      localStorage.removeItem("icms_token");
      set({ user: null, ready: true, hydrating: false });
    }
  },

  setUser: (user) => set({ user, ready: true }),

  logout: () => {
    localStorage.removeItem("icms_token");
    set({ user: null });
  },

  /** Role check used by the UI to hide actions the API would reject anyway. */
  can: (...roles) => {
    const r = get().user?.role;
    return !!r && (r === "owner" || roles.includes(r));
  },
}));
