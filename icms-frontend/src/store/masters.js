import { create } from "zustand";
import { apiFetch } from "../lib/core";

/**
 * Reference data (suppliers / SKUs / ports) shared by every page.
 *
 * Before this store each page re-fetched all 500+ SKUs on mount and on every
 * debounced search keystroke. `ensureLoaded` fetches once and de-duplicates
 * concurrent callers by holding on to the in-flight promise, so ten components
 * mounting at once produce one request, not ten.
 */
export const useMasters = create((set, get) => ({
  suppliers: [],
  skus: [],
  ports: [],
  loaded: false,
  loading: false,
  error: "",
  _inflight: null,

  /** Fetch reference data once. Pass `true` to force a refresh after an edit. */
  ensureLoaded: async (force = false) => {
    const s = get();
    if (s.loaded && !force) return;
    if (s._inflight) return s._inflight;

    const p = (async () => {
      set({ loading: true, error: "" });
      try {
        const [sup, sku, prt] = await Promise.all([
          apiFetch("/masters/suppliers?limit=5000"),
          apiFetch("/masters/skus?limit=5000"),
          apiFetch("/masters/ports?limit=5000"),
        ]);
        set({
          suppliers: sup.suppliers || [],
          skus: sku.skus || [],
          ports: prt.ports || [],
          loaded: true,
          loading: false,
        });
      } catch (e) {
        set({ error: e.message, loading: false });
      } finally {
        set({ _inflight: null });
      }
    })();

    set({ _inflight: p });
    return p;
  },

  refresh: () => get().ensureLoaded(true),

  supplierById: (id) => get().suppliers.find(s => String(s.id) === String(id)) || null,
}));
