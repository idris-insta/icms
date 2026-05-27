# ICMS — Access from Anywhere with Tailscale

Tailscale gives your PC a permanent private IP (like 100.x.x.x) reachable
from any of your devices without port forwarding or cloud hosting.

---

## What Tailscale does for ICMS

| Without Tailscale | With Tailscale |
|-------------------|---------------|
| Only works on localhost | Works on phone, laptop, anywhere |
| Need cloud server to share | No cloud needed |
| Complex port forwarding | Zero config |
| HTTP only | HTTPS via Funnel |

---

## STEP 1 — Install Tailscale

### On your Windows PC (where ICMS runs):
1. Download from https://tailscale.com/download/windows
2. Install → it adds a tray icon
3. Click **Log in** → sign in with Google/GitHub/email (free account)

### On your phone / other laptop:
- iPhone/Android: search "Tailscale" in App Store / Play Store
- Mac/Linux: https://tailscale.com/download
- Sign in with the SAME account

---

## STEP 2 — Get your PC's Tailscale IP

After installing on your PC:
1. Click the Tailscale tray icon
2. You'll see your IP — something like: **100.64.1.5**
   (or check: https://login.tailscale.com/admin/machines)

---

## STEP 3 — Start ICMS as normal

In WSL, run your usual start commands:
```bash
docker start icms-pg

# Terminal 1 — backend
cd /mnt/d/CLAUDE/icms-backend
node node_modules/nodemon/bin/nodemon.js src/index.js

# Terminal 2 — frontend
cd /mnt/d/CLAUDE/icms-frontend
node node_modules/vite/bin/vite.js --host
```

> ⚠️ The `--host` flag is important — it makes Vite listen on all network
> interfaces, not just localhost.

---

## STEP 4 — Access from any device

From your phone, another laptop, anywhere with Tailscale installed:

Open browser → **http://100.64.1.5:5173**
(replace 100.64.1.5 with YOUR Tailscale IP)

That's it. ✅

---

## STEP 5 (Optional) — Use a hostname instead of IP

Tailscale gives your machine a name like `idris-pc.tail1234.ts.net`

So you can use:
```
http://idris-pc.tail1234.ts.net:5173
```

Find your machine name at: https://login.tailscale.com/admin/machines

---

## STEP 6 (Optional) — Share with teammates via Tailscale

### Option A: Add them to your Tailscale network
1. Go to https://login.tailscale.com/admin/users
2. Invite their email → they install Tailscale → can access your PC's IP

### Option B: Tailscale Funnel (public HTTPS URL, no account needed)
Funnel exposes your app to the entire internet via a secure HTTPS URL.

```bash
# Install Tailscale on WSL/Linux
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up

# Expose frontend (port 5173) publicly
sudo tailscale funnel 5173
```

You get a URL like: **https://idris-pc.tail1234.ts.net**
Share this link — anyone can open it, no Tailscale needed.

> Note: Funnel requires Tailscale account with funnel enabled
> Enable at: https://login.tailscale.com/admin/dns → HTTPS Certificates

---

## Quick Start Commands (WSL)

```bash
# Start everything + expose via Tailscale
docker start icms-pg &
cd /mnt/d/CLAUDE/icms-backend && node node_modules/nodemon/bin/nodemon.js src/index.js &
sleep 2
cd /mnt/d/CLAUDE/icms-frontend && node node_modules/vite/bin/vite.js --host
```

Then access at: http://YOUR_TAILSCALE_IP:5173

---

## Fix: Vite blocks external connections

If you see "Blocked request" error when accessing via Tailscale IP,
edit `D:\CLAUDE\icms-frontend\vite.config.js` (or create it):

```js
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',   // allow all network access
    port: 5173,
    allowedHosts: 'all',
  }
})
```

---

## Summary

| Goal | What to do |
|------|-----------|
| Access from your own phone/laptop | Install Tailscale on both → use Tailscale IP |
| Share with 1-2 teammates | Invite them to your Tailscale network |
| Share public link (anyone) | Use Tailscale Funnel |
| Permanent production hosting | See DEPLOY_TO_CLOUD.md |

*Saved at: D:\CLAUDE\TAILSCALE_GUIDE.md*
