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
