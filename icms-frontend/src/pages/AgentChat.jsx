import { useState, useEffect, useRef, useCallback, useMemo, createContext, useContext } from "react";
import { apiFetch, apiUpload, apiDownload, useToast, useConfirm, exportCSV, fmtINR, fmtUSD, fmtCur, STATUS_STYLE, KANBAN_COL_COLOR, STATUSES, CONTAINER_TYPES, CURRENCIES, PRIORITY_COLOR, PRIORITY_BG, Badge, PriorityBadge, BarChart, Progress, Spinner, Err, KPICard, TH, TD } from "../lib/core";
// ─── AI ASSISTANT ─────────────────────────────────────────────────────────────
const AgentChat = () => {
  const [open, setOpen]       = useState(false);
  const [msgs, setMsgs]       = useState([]);
  const [input, setInput]     = useState("");
  const [busy, setBusy]       = useState(false);
  const bodyRef = useRef(null);

  useEffect(() => { if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight; }, [msgs, open]);

  const send = async () => {
    const q = input.trim();
    if (!q || busy) return;
    setInput("");
    setMsgs(m => [...m, { role: "user", text: q }]);
    setBusy(true);
    try {
      const r = await apiFetch("/agent/ask", { method: "POST", body: JSON.stringify({ question: q }) });
      setMsgs(m => [...m, { role: "ai", text: r.answer || "(no answer)" }]);
    } catch (e) {
      setMsgs(m => [...m, { role: "ai", text: `⚠️ ${e.message}` }]);
    } finally { setBusy(false); }
  };

  const SUGGESTIONS = ["Which POs need payment this week?", "Summarize supplier balances", "Which containers are arriving soon?", "Draft a follow-up email for overdue shipments"];

  return (
    <>
      <button onClick={() => setOpen(o => !o)} title="AI Assistant"
        style={{ position: "fixed", bottom: 24, left: 264, zIndex: 80, width: 52, height: 52, borderRadius: "50%", border: "none", cursor: "pointer", background: "linear-gradient(135deg,#7c3aed,#4f46e5)", color: "#fff", fontSize: 22, boxShadow: "0 6px 20px rgba(79,70,229,0.4)" }}>
        {open ? "×" : "✨"}
      </button>
      {open && (
        <div style={{ position: "fixed", bottom: 88, left: 264, zIndex: 80, width: 420, height: 520, background: "#fff", borderRadius: 16, border: "1px solid #e2e8f0", boxShadow: "0 12px 40px rgba(0,0,0,0.18)", display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <div style={{ padding: "12px 16px", background: "linear-gradient(135deg,#7c3aed,#4f46e5)", color: "#fff", fontWeight: 700, fontSize: 14 }}>✨ ICMS Assistant <span style={{ fontWeight: 400, fontSize: 11, opacity: 0.8 }}>— asks your live data</span></div>
          <div ref={bodyRef} style={{ flex: 1, overflowY: "auto", padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
            {msgs.length === 0 && (
              <div>
                <div style={{ color: "#64748b", fontSize: 12, marginBottom: 10 }}>Ask anything about your orders, payments, suppliers or shipments:</div>
                {SUGGESTIONS.map(s => (
                  <button key={s} onClick={() => { setInput(s); }} style={{ display: "block", width: "100%", textAlign: "left", marginBottom: 6, padding: "8px 12px", background: "#f5f3ff", border: "1px solid #ddd6fe", borderRadius: 8, cursor: "pointer", fontSize: 12, color: "#5b21b6" }}>{s}</button>
                ))}
              </div>
            )}
            {msgs.map((m, i) => (
              <div key={i} style={{ alignSelf: m.role === "user" ? "flex-end" : "flex-start", maxWidth: "85%", padding: "9px 13px", borderRadius: 12, fontSize: 13, lineHeight: 1.5, whiteSpace: "pre-wrap", background: m.role === "user" ? "#4f46e5" : "#f1f5f9", color: m.role === "user" ? "#fff" : "#0f172a" }}>{m.text}</div>
            ))}
            {busy && <div style={{ color: "#94a3b8", fontSize: 12 }}>Thinking…</div>}
          </div>
          <div style={{ padding: 10, borderTop: "1px solid #e2e8f0", display: "flex", gap: 8 }}>
            <input value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => e.key === "Enter" && send()}
              placeholder="Ask the assistant…" style={{ flex: 1, padding: "9px 12px", border: "1px solid #e2e8f0", borderRadius: 8, fontSize: 13, outline: "none" }} />
            <button onClick={send} disabled={busy} style={{ padding: "9px 16px", background: "#4f46e5", border: "none", borderRadius: 8, cursor: "pointer", color: "#fff", fontWeight: 700, fontSize: 13, opacity: busy ? 0.6 : 1 }}>➤</button>
          </div>
        </div>
      )}
    </>
  );
};

export { AgentChat };
