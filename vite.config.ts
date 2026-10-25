import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],

  // Vercel sets VERCEL_ENV (production | preview | development) at build time. Vite only exposes
  // VITE_* vars to the client, so pass it through for the dev auth bypass (src/lib/devAuth.ts).
  define: {
    'import.meta.env.VITE_VERCEL_ENV': JSON.stringify(process.env.VERCEL_ENV ?? ''),
  },

  server: {
      proxy: {
        '/api': {
          target: 'http://localhost:3000',
          changeOrigin: true,
        },
      },
    },
})
