#!/bin/bash
set -e

echo "======================================"
echo "  ICMS - Setup & Run (WSL/Linux)"
echo "======================================"

# ── 1. Node.js ────────────────────────────────────────────────────────────────
if ! command -v node &>/dev/null; then
  echo "[1/6] Installing Node.js 20..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs
else
  echo "[1/6] Node.js already installed: $(node --version)"
fi

# ── 2. PostgreSQL ─────────────────────────────────────────────────────────────
if ! command -v psql &>/dev/null; then
  echo "[2/6] Installing PostgreSQL..."
  sudo apt-get update
  sudo apt-get install -y postgresql postgresql-contrib
else
  echo "[2/6] PostgreSQL already installed: $(psql --version)"
fi

echo "[2/6] Starting PostgreSQL..."
sudo service postgresql start

# ── 3. Clone repo (if not already cloned) ────────────────────────────────────
REPO_DIR="$HOME/icms"
if [ ! -d "$REPO_DIR" ]; then
  echo "[3/6] Cloning repository..."
  git clone https://github.com/idris-insta/icms.git "$REPO_DIR"
else
  echo "[3/6] Repo already exists at $REPO_DIR, pulling latest..."
  git -C "$REPO_DIR" pull
fi
cd "$REPO_DIR"

# ── 4. Database setup ─────────────────────────────────────────────────────────
echo "[4/6] Setting up database..."
sudo -u postgres psql -c "CREATE USER icms_user WITH PASSWORD 'icms123';" 2>/dev/null || true
sudo -u postgres psql -c "CREATE DATABASE icms OWNER icms_user;" 2>/dev/null || true
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE icms TO icms_user;" 2>/dev/null || true
sudo -u postgres psql -d icms -c "GRANT ALL ON SCHEMA public TO icms_user;" 2>/dev/null || true
sudo -u postgres psql -d icms -f icms-backend/schema.sql
sudo -u postgres psql -d icms -c "GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO icms_user;"
sudo -u postgres psql -d icms -c "GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO icms_user;"

# Fix password hash for owner@icms.com / owner123
HASH=$(node -e "const b=require('./icms-backend/node_modules/bcryptjs'); b.hash('owner123',10).then(h=>process.stdout.write(h));" 2>/dev/null || \
       node -e "const b=require('$(npm root -g)/bcryptjs'); b.hash('owner123',10).then(h=>process.stdout.write(h));" 2>/dev/null || true)
if [ -n "$HASH" ]; then
  sudo -u postgres psql -d icms -c "UPDATE users SET password_hash='$HASH' WHERE email='owner@icms.com';" 2>/dev/null || true
fi

# ── 5. Backend ────────────────────────────────────────────────────────────────
echo "[5/6] Installing backend dependencies..."
cd "$REPO_DIR/icms-backend"
npm install

cat > .env << 'EOF'
DATABASE_URL=postgresql://icms_user:icms123@localhost:5432/icms
PORT=6001
JWT_SECRET=icms_jwt_secret_key_2024
EOF

# Kill any existing backend
kill $(lsof -t -i:6001) 2>/dev/null || true
sleep 1

echo "[5/6] Starting backend on port 6001..."
node src/index.js &
BACKEND_PID=$!
sleep 2

if curl -s http://localhost:6001/api/health | grep -q '"ok"'; then
  echo "  ✓ Backend running — http://localhost:6001/api"
else
  echo "  ✗ Backend failed to start. Check logs above."
  exit 1
fi

# ── 6. Frontend ───────────────────────────────────────────────────────────────
echo "[6/6] Installing frontend dependencies..."
cd "$REPO_DIR/icms-frontend"
npm install

# Kill any existing frontend
kill $(lsof -t -i:7000) 2>/dev/null || true
sleep 1

echo "[6/6] Starting frontend on port 7000..."
npm run dev &
FRONTEND_PID=$!
sleep 4

if curl -s -o /dev/null -w "%{http_code}" http://localhost:7000/ | grep -q "200"; then
  echo "  ✓ Frontend running — http://localhost:7000"
else
  echo "  ✗ Frontend failed to start. Check logs above."
  exit 1
fi

# ── Done ──────────────────────────────────────────────────────────────────────
echo ""
echo "======================================"
echo "  ICMS is running!"
echo "======================================"
echo "  Frontend : http://localhost:7000"
echo "  Backend  : http://localhost:6001/api"
echo "  Login    : owner@icms.com / owner123"
echo "======================================"
echo ""
echo "Press Ctrl+C to stop both servers."

# Wait for Ctrl+C and clean up
trap "echo ''; echo 'Stopping servers...'; kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; exit 0" INT
wait
