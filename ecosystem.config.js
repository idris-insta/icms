const NODE = "/home/luffy/.nvm/versions/node/v24.16.0/bin/node";
module.exports = {
  apps: [
    { name: "icms-backend", script: "src/index.js", cwd: "/home/luffy/icms/icms-backend", interpreter: NODE, autorestart: true, max_restarts: 50, restart_delay: 2000, env: { NODE_ENV: "development", PORT: "6001" } },
    { name: "icms-frontend", script: "node_modules/.bin/vite", args: "--host --port 5173", cwd: "/home/luffy/icms/icms-frontend", interpreter: NODE, autorestart: true, max_restarts: 50, restart_delay: 2000 },
  ],
};
