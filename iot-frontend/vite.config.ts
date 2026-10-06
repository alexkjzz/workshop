import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // xfwd: the backend uses X-Forwarded-For for login rate limiting.
      '/api': { target: 'http://127.0.0.1:3001', xfwd: true },
    },
  },
})
