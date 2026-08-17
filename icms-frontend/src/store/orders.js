import { create } from "zustand";
import { apiFetch } from "../lib/core";

/**
 * Orders list + the currently-open order.
 *
 * Race conditions this store exists to remove:
 *
 *  1. Stale list responses. The list is refetched on every debounced keystroke.
 *     Responses can arrive out of order, so a slow request for "ab" could land
 *     after a fast one for "abc" and repaint the older results. Every fetch
 *     takes a monotonically increasing ticket and only the newest one is allowed
 *     to write to the store; older ones are discarded on arrival.
 *
 *  2. Lost updates. Two users editing the same order used to silently overwrite
 *     each other. Saves now send `if_unmodified_since` (the `updated_at` the
 *     client loaded) and the API replies 409 if the row moved on.
 *
 *  3. Detail/list divergence. After a save the open detail panel kept showing
 *     pre-save values. Writes now update the list row and the selection from the
 *     same server response.
 */
export const useOrders = create((set, get) => ({
  orders: [],
  selected: null,
  supplierSummary: [],
  loading: false,
  error: "",

  filter: "All",
  search: "",

  _seq: 0,          // ticket issued to the most recent list fetch
  _applied: 0,      // ticket of the response currently rendered

  setFilter: (filter) => set({ filter }),
  setSearch: (search) => set({ search }),
  setError: (error) => set({ error }),
  clearSelection: () => set({ selected: null }),

  /** Refetch the list for the current filter/search. Out-of-order safe. */
  load: async () => {
    const ticket = get()._seq + 1;
    set({ _seq: ticket, loading: true, error: "" });
    try {
      const params = new URLSearchParams();
      const { filter, search } = get();
      if (filter !== "All") params.set("status", filter);
      if (search) params.set("search", search);

      const [oRes, supSumRes] = await Promise.all([
        apiFetch(`/orders?${params}`),
        apiFetch("/orders/supplier-summary"),
      ]);

      // A newer request has been issued since — drop this response.
      if (ticket < get()._seq) return;
      set({
        orders: oRes.orders || [],
        supplierSummary: supSumRes.suppliers || [],
        loading: false,
        _applied: ticket,
      });
    } catch (e) {
      if (ticket < get()._seq) return;
      set({ error: e.message, loading: false });
    }
  },

  refreshSupplierSummary: async () => {
    try {
      const r = await apiFetch("/orders/supplier-summary");
      set({ supplierSummary: r.suppliers || [] });
    } catch { /* summary is secondary; the list already surfaced any outage */ }
  },

  /** Load one order in full (with items) and select it. Toggles when re-clicked. */
  select: async (o) => {
    if (get().selected?.id === o.id) { set({ selected: null }); return; }
    // Show what we already have immediately, then upgrade to the full record.
    set({ selected: o });
    try {
      const full = await apiFetch(`/orders/${o.id}`);
      // Only apply if the user has not moved on to a different order meanwhile.
      if (get().selected?.id === o.id) set({ selected: full });
    } catch { /* keep the summary row we already showed */ }
  },

  fetchFull: (id) => apiFetch(`/orders/${id}`),

  /** Merge a server-returned order into the list and the open selection. */
  applyOrder: (saved) => set((s) => ({
    orders: s.orders.some(o => o.id === saved.id)
      ? s.orders.map(o => (o.id === saved.id ? { ...o, ...saved } : o))
      : [saved, ...s.orders],
    selected: s.selected && s.selected.id === saved.id ? saved : s.selected,
  })),

  /**
   * Create or update. `base` is the order as it was loaded; its `updated_at` is
   * sent back so the API can reject a save that would clobber someone else's.
   * Throws with `.conflict === true` on 409 so the caller can prompt a reload.
   */
  save: async (payload, base) => {
    const isEdit = !!base?.id;
    const body = isEdit
      ? { ...payload, if_unmodified_since: base.updated_at }
      : payload;
    try {
      const saved = await apiFetch(isEdit ? `/orders/${base.id}` : "/orders", {
        method: isEdit ? "PUT" : "POST",
        body: JSON.stringify(body),
      });
      get().applyOrder(saved);
      return saved;
    } catch (e) {
      if (/changed by someone else/i.test(e.message)) e.conflict = true;
      throw e;
    }
  },

  remove: async (id) => {
    await apiFetch(`/orders/${id}`, { method: "DELETE" });
    set((s) => ({
      orders: s.orders.filter(o => o.id !== id),
      selected: s.selected?.id === id ? null : s.selected,
    }));
  },

  /**
   * Move an order to a new status with an optimistic update. If the request
   * fails the previous status is restored, so the board can never be left
   * showing a move the server rejected.
   */
  setStatus: async (id, status, extra = {}) => {
    const prev = get().orders.find(o => o.id === id);
    if (!prev) return;
    const rollback = { ...prev };
    set((s) => ({ orders: s.orders.map(o => (o.id === id ? { ...o, status } : o)) }));
    try {
      const saved = await apiFetch(`/orders/${id}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status, ...extra }),
      });
      get().applyOrder({ ...rollback, ...saved });
      return saved;
    } catch (e) {
      set((s) => ({ orders: s.orders.map(o => (o.id === id ? rollback : o)) }));
      throw e;
    }
  },
}));
