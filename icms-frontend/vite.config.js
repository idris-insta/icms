import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',      // listen on all interfaces (needed for Tailscale)
    port: 7000,
    allowedHosts: 'all',  // allow Tailscale hostnames
  }
})
