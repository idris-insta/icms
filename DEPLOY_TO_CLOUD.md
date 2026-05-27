# ICMS — Deploy to Cloud (Step by Step)

Your app has 3 parts that need hosting:
| Part | What it is | Where to host |
|------|-----------|---------------|
| PostgreSQL DB | Database | Railway / Supabase / Render |
| Node.js API | Backend | Railway / Render |
| React (Vite) | Frontend | Vercel / Netlify |

---

## ✅ Option 1 — Railway (Easiest — recommended)
**Cost:** Free tier available · ~$5/mo for always-on
**URL:** https://railway.app

### Deploy Backend + Database on Railway

**Step 1 — Install Railway CLI**
```bash
npm install -g @railway/cli
railway login
```

**Step 2 — Deploy the backend**
```bash
cd /mnt/d/CLAUDE/icms-backend
railway init          # creates a new project
railway up            # deploys the code
```

**Step 3 — Add PostgreSQL**
- Go to https://railway.app → your project → **+ Add Service** → **Database** → **PostgreSQL**
- Railway auto-sets `DATABASE_URL` as an environment variable

**Step 4 — Set environment variables** (in Railway dashboard → your backend service → Variables)
```
JWT_SECRET=your-long-random-secret-here-change-this
UPLOAD_DIR=./uploads
```
Railway sets `PORT` and `DATABASE_URL` automatically.

**Step 5 — Seed the database**
```bash
# Get your Railway DB connection string from dashboard, then:
railway run node -e "
const { Pool } = require('pg');
const fs = require('fs');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
pool.query(fs.readFileSync('./schema.sql', 'utf8')).then(() => { console.log('Done!'); process.exit(); });
"
```

**Step 6 — Get your backend URL**
Railway gives you a URL like: `https://icms-backend-production.up.railway.app`

---

### Deploy Frontend on Vercel

**Step 1 — Install Vercel CLI**
```bash
npm install -g vercel
```

**Step 2 — Set your backend URL**
Edit `/mnt/d/CLAUDE/icms-frontend/.env.example`:
```
VITE_API_URL=https://your-backend-url.up.railway.app
```

**Step 3 — Deploy**
```bash
cd /mnt/d/CLAUDE/icms-frontend
vercel
```
When prompted:
- Framework: **Vite**
- Build command: `npm run build`
- Output directory: `dist`

**Step 4 — Set environment variable in Vercel**
- Go to https://vercel.com → your project → **Settings** → **Environment Variables**
- Add: `VITE_API_URL` = `https://your-backend-url.up.railway.app`
- Redeploy

✅ Your app is now live at `https://your-app.vercel.app`

---

## ✅ Option 2 — Render (Also free)
**URL:** https://render.com

### Backend on Render
1. Go to https://render.com → **New** → **Web Service**
2. Connect your GitHub repo (push code to GitHub first — see below)
3. Settings:
   - **Root directory:** `icms-backend`
   - **Build command:** `npm install`
   - **Start command:** `node src/index.js`
4. Add **PostgreSQL** database: New → PostgreSQL
5. Add env vars: `DATABASE_URL` (from Render DB), `JWT_SECRET`

### Frontend on Render
1. New → **Static Site**
2. Root directory: `icms-frontend`
3. Build command: `npm install && npm run build`
4. Publish directory: `dist`
5. Add env var: `VITE_API_URL=https://your-backend.onrender.com`

---

## ✅ Option 3 — VPS (Full control, ~$5/month)
**Best for:** Production use, custom domain, persistent files
**Providers:** DigitalOcean, Linode, Vultr, Hetzner

### Step 1 — Get a server
- DigitalOcean → Create Droplet → Ubuntu 22.04 → $6/mo (1GB RAM)
- Note your server IP: `YOUR_SERVER_IP`

### Step 2 — SSH in and install dependencies
```bash
ssh root@YOUR_SERVER_IP

# Install Node.js
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs

# Install PostgreSQL
apt install -y postgresql postgresql-contrib

# Install PM2 (keeps app running forever)
npm install -g pm2

# Install Nginx (web server / reverse proxy)
apt install -y nginx
```

### Step 3 — Setup PostgreSQL
```bash
sudo -u postgres psql -c "CREATE USER icms WITH PASSWORD 'icms123';"
sudo -u postgres psql -c "CREATE DATABASE icms OWNER icms;"
sudo -u postgres psql -d icms -f /var/www/icms-backend/schema.sql
```

### Step 4 — Upload your code
```bash
# From your local WSL terminal:
scp -r /mnt/d/CLAUDE/icms-backend root@YOUR_SERVER_IP:/var/www/icms-backend
scp -r /mnt/d/CLAUDE/icms-frontend root@YOUR_SERVER_IP:/var/www/icms-frontend
```

### Step 5 — Start the backend with PM2
```bash
# On the server:
cd /var/www/icms-backend
npm install
pm2 start src/index.js --name icms-api
pm2 save
pm2 startup   # auto-start on reboot
```

### Step 6 — Build the frontend
```bash
cd /var/www/icms-frontend
# Edit src/ICMSPreview.jsx: set VITE_API_URL to your domain or IP
npm install
npm run build
# Built files are in /var/www/icms-frontend/dist
```

### Step 7 — Configure Nginx
```bash
nano /etc/nginx/sites-available/icms
```
Paste this config:
```nginx
server {
    listen 80;
    server_name YOUR_SERVER_IP;   # or your domain

    # Frontend
    root /var/www/icms-frontend/dist;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    # Backend API proxy
    location /api/ {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```
```bash
ln -s /etc/nginx/sites-available/icms /etc/nginx/sites-enabled/
nginx -t
systemctl restart nginx
```

✅ App is live at `http://YOUR_SERVER_IP`

### Step 8 — Add free SSL (HTTPS)
```bash
apt install -y certbot python3-certbot-nginx
certbot --nginx -d yourdomain.com
```

---

## 📤 Push code to GitHub first (needed for Render/Railway auto-deploy)

```bash
# Install git if needed
apt install git   # or: sudo apt install git (WSL)

cd /mnt/d/CLAUDE
git init
git add icms-backend icms-frontend
git commit -m "ICMS full stack app"

# Create a repo on github.com, then:
git remote add origin https://github.com/YOUR_USERNAME/icms.git
git push -u origin main
```

---

## 🔐 Important: Change secrets before going live!

Edit `D:\CLAUDE\icms-backend\.env` and change:
```
JWT_SECRET=use-a-long-random-string-like-this-one-abc123xyz789
```
And change the default password:
- Login to app → Settings, or run SQL:
```sql
UPDATE users SET password_hash = '<bcrypt hash of new password>' WHERE email = 'owner@icms.com';
```

---

## 📊 Comparison

| | Railway | Render | VPS |
|--|---------|--------|-----|
| Difficulty | ⭐ Easy | ⭐ Easy | ⚙️ Medium |
| Free tier | ✅ Yes | ✅ Yes | ❌ ~$5/mo |
| Always on (free) | ❌ Sleeps | ❌ Sleeps | ✅ Yes |
| Custom domain | ✅ | ✅ | ✅ |
| File uploads persist | ❌ | ❌ | ✅ |
| Full control | ❌ | ❌ | ✅ |

**Recommendation:**
- **Just to share / test** → Railway or Render (free)
- **Real production use** → VPS (DigitalOcean $6/mo) — file uploads persist, never sleeps

---

*Saved at: `D:\CLAUDE\DEPLOY_TO_CLOUD.md`*
