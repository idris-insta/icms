#!/usr/bin/env bash
# ─── ICMS Stop Script ────────────────────────────────────────────────────────
echo "🛑 Stopping ICMS services..."
pkill -f "node.*src/index.js" 2>/dev/null && echo "  ✅ Backend stopped" || echo "  ⏭  Backend was not running"
pkill -f "node.*vite"         2>/dev/null && echo "  ✅ Frontend stopped" || echo "  ⏭  Frontend was not running"
echo "Done. (PostgreSQL container left running — use 'docker stop icms-pg' to stop it too)"
