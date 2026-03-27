const fs = require('fs');
const path = require('path');

const ROOT = 'C:\\Users\\mikod\\OneDrive\\Desktop\\Rijeka';

function write(rel, content) {
  const full = path.join(ROOT, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, 'utf8');
  console.log('wrote:', rel);
}

// ─── frontend/netlify.toml ─────────────────────────────────────────────────────
// Netlify reads this from the repo root or the base directory.
// We set base = "frontend" so Netlify builds from there.
write('netlify.toml', `[build]
  base    = "frontend"
  command = "npm run build"
  publish = "frontend/dist"

[build.environment]
  NODE_VERSION = "20"

# SPA fallback — all routes serve index.html
[[redirects]]
  from   = "/*"
  to     = "/index.html"
  status = 200

# Security headers
[[headers]]
  for = "/*"
  [headers.values]
    X-Frame-Options        = "DENY"
    X-Content-Type-Options = "nosniff"
    Referrer-Policy        = "strict-origin-when-cross-origin"
    Permissions-Policy     = "camera=(), microphone=(), geolocation=()"
`);

// ─── render.yaml ──────────────────────────────────────────────────────────────
// Place in repo root. Render reads this for auto-deploy configuration.
write('render.yaml', `services:
  - type: web
    name: rijeka-api
    runtime: python
    rootDir: backend
    buildCommand: pip install -r requirements.txt
    startCommand: uvicorn main:app --host 0.0.0.0 --port $PORT
    plan: free
    autoDeploy: true
    envVars:
      - key: DATABASE_URL
        sync: false          # set manually in Render dashboard
      - key: SUPABASE_JWT_SECRET
        sync: false          # set manually in Render dashboard
      - key: FRONTEND_URL
        value: https://app.rijeka.app
`);

// ─── docs/DEPLOY_CHECKLIST.md ─────────────────────────────────────────────────
write('docs/DEPLOY_CHECKLIST.md', `# Rijeka Deploy Checklist

## Day 7 — Deploy frontend to app.rijeka.app

### Step 1: Push to GitHub
\`\`\`cmd
cd C:\\Users\\mikod\\OneDrive\\Desktop\\Rijeka
git add .
git commit -m "Sprint 2 Day 6/7: FastAPI backend + trades blotter + deploy config"
git push
\`\`\`

### Step 2: Create Netlify site
1. Go to app.netlify.com → Add new site → Import an existing project
2. Connect GitHub → select \`open-source-cross-asset-pricing-and-risk-platform\`
3. Netlify auto-reads \`netlify.toml\` — no manual settings needed
4. Click Deploy

### Step 3: Set custom domain
1. Netlify → Site settings → Domain management → Add custom domain
2. Add: \`app.rijeka.app\`
3. In Namecheap → Advanced DNS → Add CNAME:
   - Host: \`app\`
   - Value: \`[your-netlify-subdomain].netlify.app\`

### Step 4: Add env vars to Netlify
Site settings → Environment variables → Add:
- \`VITE_SUPABASE_URL\` = \`https://upuewetohnocfshkhafg.supabase.co\`
- \`VITE_SUPABASE_ANON_KEY\` = \`[your anon key]\`

### Step 5: Update Supabase redirect URLs
Supabase Dashboard → Authentication → URL Configuration:
- Site URL: \`https://app.rijeka.app\`
- Redirect URLs: add \`https://app.rijeka.app/**\`

---

## Day 6 — Deploy backend to Render

### Step 1: Create Render web service
1. Go to render.com → New → Web Service
2. Connect GitHub → select repo
3. Root directory: \`backend\`
4. Build command: \`pip install -r requirements.txt\`
5. Start command: \`uvicorn main:app --host 0.0.0.0 --port $PORT\`

### Step 2: Set env vars in Render dashboard
- \`DATABASE_URL\` = get from Supabase → Settings → Database → Connection string (URI)
- \`SUPABASE_JWT_SECRET\` = Supabase → Settings → API → JWT Secret

### Step 3: Set custom domain
Render → Service → Settings → Custom Domain → Add: \`api.rijeka.app\`
In Namecheap → Add CNAME:
- Host: \`api\`
- Value: \`[your-render-service].onrender.com\`

### Step 4: Verify
\`\`\`
curl https://api.rijeka.app/health
# → {"status":"ok","service":"rijeka-risk-api","version":"0.1.0"}
\`\`\`

---

## Supabase redirect URLs (after deploy)
Add these to Supabase Auth → URL Configuration → Redirect URLs:
- http://localhost:5173/**
- https://app.rijeka.app/**
`);

console.log('\n✅  Deploy config complete.');
console.log('\nFiles written:');
console.log('  netlify.toml         → root (Netlify reads this automatically)');
console.log('  render.yaml          → root (Render reads this automatically)');
console.log('  docs/DEPLOY_CHECKLIST.md → step-by-step deploy guide');
