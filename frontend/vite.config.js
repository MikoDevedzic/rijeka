import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
export default defineConfig({
  plugins: [
    react({ jsxRuntime: 'automatic' }),
    tailwindcss(),
  ],
  server: {
    proxy: {
      '/api': 'http://localhost:8000',
      '/auth': 'http://localhost:8000',
    }
  },
  // The built app calls the API by its address (lib/api.js); a preview never forwards a stray relative path to
  // whatever happens to listen on :8000 (a developer's API on the shared database).
  preview: { proxy: {} },
  // Unit tests are vitest's; the browser journeys in e2e/ are Playwright's (npm run e2e).
  test: { exclude: ['e2e/**', 'node_modules/**', 'dist/**'] },
  build: {
    rollupOptions: {
      output: {
        // The framework and the two libraries every signed-in page needs are their own
        // chunks, so a release that changes app code does not refetch them; three and
        // exceljs are already dynamic (lib/three.js, LegDetailsTab).
        manualChunks(id) {
          if (!id.includes('node_modules/')) return undefined
          if (id.includes('node_modules/react/') || id.includes('node_modules/react-dom/') || id.includes('node_modules/scheduler/')) return 'react'
          if (id.includes('node_modules/react-router')) return 'router'
          if (id.includes('node_modules/@supabase/')) return 'supabase'
          return undefined
        },
      },
    },
  },
  oxc: false,
})
