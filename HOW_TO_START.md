# ICMS — How to Start the App (Step by Step)

> **Your terminal is WSL/bash** (`idris@IDRIS:~$`)
> Use the bash commands below. Windows `D:\` becomes `/mnt/d/` in WSL.

---

## ✅ Prerequisites (one-time setup)
Make sure these are installed:
- **Docker Desktop** — https://www.docker.com/products/docker-desktop
- **Node.js** (v18+) — https://nodejs.org

---

## 🚀 Every Time You Want to Run the App

### STEP 1 — Start Docker Desktop
Open **Docker Desktop** from the Windows Start menu and wait until the whale icon in the taskbar is solid (not animating).

---

### STEP 2 — Start the PostgreSQL Database
```bash
docker start icms-pg
```
✅ You should see: `icms-pg`

> **First time only** (if container doesn't exist yet):
> ```bash
> docker run -d --name icms-pg -e POSTGRES_PASSWORD=icms123 -e POSTGRES_DB=icms -p 5432:5432 postgres:16
> docker exec -i icms-pg psql -U postgres -d icms < /mnt/d/CLAUDE/icms-backend/schema.sql
> ```

---

### STEP 3 — Start the Backend API
Open a **new terminal tab** and run:
```bash
cd /mnt/d/CLAUDE/icms-backend
node node_modules/nodemon/bin/nodemon.js src/index.js
```
✅ You should see:
```
[nodemon] starting `node src/index.js`
ICMS API running on port 3001
```
> Leave this terminal open — the backend must keep running.

---

### STEP 4 — Start the Frontend
Open **another new terminal tab** and run:
```bash
cd /mnt/d/CLAUDE/icms-frontend
node node_modules/vite/bin/vite.js
```
✅ You should see:
```
VITE ready in ...ms
➜  Local:   http://localhost:5173/
```
> Leave this terminal open too.

---

### STEP 5 — Open the App
Go to: **http://localhost:5173**

---

## 🔐 Login Credentials

| Field    | Value          |
|----------|----------------|
| Email    | owner@icms.com |
| Password | owner123       |

---

## 🌐 App URLs

| Service     | URL                             |
|-------------|---------------------------------|
| Frontend    | http://localhost:5173           |
| Backend API | http://localhost:3001/api       |
| Health check| http://localhost:3001/api/health|

---

## ⚡ Quick Start — paste this whole block in bash

```bash
# Start DB
docker start icms-pg

# Start backend in background tab
cd /mnt/d/CLAUDE/icms-backend && node node_modules/nodemon/bin/nodemon.js src/index.js &

# Wait 2 seconds, then start frontend
sleep 2
cd /mnt/d/CLAUDE/icms-frontend && node node_modules/vite/bin/vite.js
```
Then open **http://localhost:5173**

> To stop everything: press `Ctrl+C` twice (stops frontend, then backend)

---

## 🛑 How to Stop the App

1. Press `Ctrl + C` in the frontend terminal
2. Press `Ctrl + C` in the backend terminal
3. Stop the database (optional):
   ```bash
   docker stop icms-pg
   ```

---

## 🔧 Troubleshooting

| Problem | Fix |
|---------|-----|
| `Port 3001 already in use` | `kill $(lsof -t -i:3001)` |
| `Port 5173 already in use` | `kill $(lsof -t -i:5173)` |
| `docker: command not found` | Open Docker Desktop first, then try again |
| Database connection error | Make sure Docker Desktop is running: `docker start icms-pg` |
| `Cannot find module` | Run `npm install` in both `/mnt/d/CLAUDE/icms-backend` and `/mnt/d/CLAUDE/icms-frontend` |
| Blank white page in browser | Backend isn't running — check Step 3 terminal for errors |
| `bash: cd: too many arguments` | You copied a Windows path — use `/mnt/d/` not `D:\` |

---

*Saved at: `/mnt/d/CLAUDE/HOW_TO_START.md`*
