import { useState, useEffect, useRef, useCallback, useMemo, createContext, useContext } from "react";
import { apiFetch, apiUpload, apiDownload, useToast, useConfirm, exportCSV, fmtINR, fmtUSD, fmtCur, STATUS_STYLE, KANBAN_COL_COLOR, STATUSES, CONTAINER_TYPES, CURRENCIES, PRIORITY_COLOR, PRIORITY_BG, Badge, PriorityBadge, BarChart, Progress, Spinner, Err, KPICard, TH, TD } from "../lib/core";
// ─── KANBAN ───────────────────────────────────────────────────────────────────
const Kanban = () => {
  const [groups, setGroups]       = useState({});
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState("");
  const [qtyModal, setQtyModal]   = useState(null); // { card, fromCol, toCol, items }
  const [qtyItems, setQtyItems]   = useState([]);
  const [savingQty, setSavingQty] = useState(false);
  const dragCard                  = useRef(null);
  const cols = ["Draft","Confirmed","Loaded","Shipped","In Transit","Arrived","Delivered"];

  const loadGroups = () => {
    apiFetch("/orders/kanban").then(setGroups).catch(e => setError(e.message)).finally(() => setLoading(false));
  };
  useEffect(loadGroups, []);

  const onDragStart = (card, fromCol) => { dragCard.current = { card, fromCol }; };

  const onDrop = async (toCol) => {
    if (!dragCard.current || dragCard.current.fromCol === toCol) return;
    const { card, fromCol } = dragCard.current;
    dragCard.current = null;
    // If moving to Loaded/Shipped/Arrived — prompt qty edit
    if (["Loaded","Shipped","Arrived"].includes(toCol)) {
      try {
        const full = await apiFetch(`/orders/${card.id}`);
        setQtyItems((full.items || []).map(i => ({ ...i })));
        setQtyModal({ card, fromCol, toCol });
      } catch (e) { setError(e.message); }
      return;
    }
    await commitStatus(card, fromCol, toCol);
  };

  const commitStatus = async (card, fromCol, toCol, updatedItems) => {
    setGroups(prev => {
      const next = { ...prev };
      next[fromCol] = (next[fromCol] || []).filter(c => c.id !== card.id);
      next[toCol]   = [{ ...card }, ...(next[toCol] || [])];
      return next;
    });
    try {
      await apiFetch(`/orders/${card.id}/status`, { method: "PATCH", body: JSON.stringify({ status: toCol }) });
      if (updatedItems) {
        await apiFetch(`/orders/${card.id}`, { method: "PUT", body: JSON.stringify({ items: updatedItems }) });
      }
    } catch (e) {
      setError(e.message);
      setGroups(prev => {
        const next = { ...prev };
        next[toCol]   = (next[toCol] || []).filter(c => c.id !== card.id);
        next[fromCol] = [card, ...(next[fromCol] || [])];
        return next;
      });
    }
  };

  const confirmQtyAndMove = async () => {
    if (!qtyModal) return;
    setSavingQty(true);
    await commitStatus(qtyModal.card, qtyModal.fromCol, qtyModal.toCol, qtyItems);
    setSavingQty(false);
    setQtyModal(null);
  };

  if (loading) return <div style={{ padding: 24, flex: 1 }}><Spinner /></div>;

  return (
    <div style={{ padding: 24, overflowY: "auto", flex: 1 }}>
      {/* Qty edit modal */}
      {qtyModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 60, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
          <div style={{ background: "#fff", borderRadius: 14, padding: 24, width: "100%", maxWidth: 700, maxHeight: "80vh", overflowY: "auto" }}>
            <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>✏️ Update Quantities — {qtyModal.card.po_number}</div>
            <div style={{ fontSize: 12, color: "#64748b", marginBottom: 16 }}>Moving to <strong>{qtyModal.toCol}</strong> — verify or adjust quantities if anything changed during shipping</div>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr style={{ background: "#1e3a5f" }}>
                  {["Item","Thickness","Size","Liner/Color","Total CTN","Total Roll","KG/PKG"].map(h =>
                    <th key={h} style={{ padding: "7px 8px", color: "#fff", fontWeight: 600, fontSize: 11, textAlign: "left", border: "1px solid #2d4f7f" }}>{h}</th>
                  )}
                </tr>
              </thead>
              <tbody>
                {qtyItems.map((item, idx) => (
                  <tr key={idx} style={{ background: idx % 2 === 0 ? "#fff" : "#f8fafc" }}>
                    <td style={{ padding: "5px 8px", border: "1px solid #e2e8f0" }}>{item.item_name}</td>
                    <td style={{ padding: "5px 8px", border: "1px solid #e2e8f0" }}>{item.thickness}</td>
                    <td style={{ padding: "5px 8px", border: "1px solid #e2e8f0" }}>{item.size}</td>
                    <td style={{ padding: "5px 8px", border: "1px solid #e2e8f0" }}>{item.liner_color}</td>
                    <td style={{ padding: "3px 4px", border: "1px solid #e2e8f0" }}>
                      <input type="number" value={item.total_ctn} onChange={e => setQtyItems(prev => prev.map((r, i) => i === idx ? { ...r, total_ctn: e.target.value } : r))}
                        style={{ width: "100%", border: "1px solid #e2e8f0", borderRadius: 4, padding: "4px 6px", fontSize: 12, outline: "none", textAlign: "right" }} />
                    </td>
                    <td style={{ padding: "3px 4px", border: "1px solid #e2e8f0" }}>
                      <input type="number" value={item.total_roll} onChange={e => setQtyItems(prev => prev.map((r, i) => i === idx ? { ...r, total_roll: e.target.value } : r))}
                        style={{ width: "100%", border: "1px solid #e2e8f0", borderRadius: 4, padding: "4px 6px", fontSize: 12, outline: "none", textAlign: "right" }} />
                    </td>
                    <td style={{ padding: "3px 4px", border: "1px solid #e2e8f0" }}>
                      <input type="number" value={item.kg_pkg} onChange={e => setQtyItems(prev => prev.map((r, i) => i === idx ? { ...r, kg_pkg: e.target.value } : r))}
                        style={{ width: "100%", border: "1px solid #e2e8f0", borderRadius: 4, padding: "4px 6px", fontSize: 12, outline: "none", textAlign: "right" }} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 16 }}>
              <button onClick={() => setQtyModal(null)} style={{ padding: "8px 18px", background: "#f1f5f9", border: "1px solid #e2e8f0", borderRadius: 8, cursor: "pointer", fontSize: 13 }}>Cancel</button>
              <button onClick={async () => { await commitStatus(qtyModal.card, qtyModal.fromCol, qtyModal.toCol); setQtyModal(null); }} style={{ padding: "8px 18px", background: "#f1f5f9", border: "1px solid #e2e8f0", borderRadius: 8, cursor: "pointer", fontSize: 13 }}>Skip (no changes)</button>
              <button onClick={confirmQtyAndMove} disabled={savingQty} style={{ padding: "8px 18px", background: "#3b82f6", border: "none", borderRadius: 8, cursor: "pointer", fontSize: 13, color: "#fff", fontWeight: 600 }}>{savingQty ? "Saving…" : "Confirm & Move"}</button>
            </div>
          </div>
        </div>
      )}

      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, color: "#0f172a", margin: 0 }}>Container Status Board</h1>
        <p style={{ color: "#64748b", fontSize: 12, marginTop: 2 }}>Drag cards to update status · Moving to Loaded/Shipped/Arrived prompts quantity review</p>
      </div>
      <Err msg={error} />
      <div style={{ display: "flex", gap: 10, overflowX: "auto", paddingBottom: 8 }}>
        {cols.map(col => {
          const cards = groups[col] || [];
          const color = KANBAN_COL_COLOR[col] || "#94a3b8";
          return (
            <div key={col} style={{ minWidth: 200, flexShrink: 0 }}
              onDragOver={e => e.preventDefault()}
              onDrop={() => onDrop(col)}>
              <div style={{ padding: "8px 12px", borderRadius: "8px 8px 0 0", background: color, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ color: "#fff", fontWeight: 700, fontSize: 12 }}>{col}</span>
                <span style={{ background: "rgba(255,255,255,0.3)", color: "#fff", borderRadius: 20, padding: "1px 7px", fontSize: 11, fontWeight: 700 }}>{cards.length}</span>
              </div>
              <div style={{ background: "#f8fafc", borderRadius: "0 0 8px 8px", border: "1px solid #e2e8f0", borderTop: "none", minHeight: 200, padding: 8 }}>
                {cards.map((c, i) => (
                  <div key={i} draggable onDragStart={() => onDragStart(c, col)}
                    style={{ background: "#fff", borderRadius: 8, border: "1px solid #e2e8f0", padding: 12, marginBottom: 8, cursor: "grab", boxShadow: "0 1px 3px rgba(0,0,0,0.06)" }}>
                    <div style={{ fontWeight: 700, fontSize: 12, color: "#1e3a5f", marginBottom: 4 }}>{c.po_number}</div>
                    <div style={{ fontSize: 11, color: "#64748b", marginBottom: 6 }}>{c.supplier}</div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ fontSize: 10, background: "#f1f5f9", padding: "2px 6px", borderRadius: 4, color: "#475569" }}>{c.container}</span>
                      <span style={{ fontSize: 11, fontWeight: 700, color: "#059669" }}>{fmtUSD(c.value)}</span>
                    </div>
                  </div>
                ))}
                {cards.length === 0 && <div style={{ textAlign: "center", padding: "30px 0", color: "#cbd5e1", fontSize: 12 }}>Drop here</div>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export { Kanban };
