# Rijeka Deploy Checklist

## Day 7 — Deploy frontend to app.rijeka.app

### Step 1: Push to GitHub
```cmd
cd C:\Users\mikod\OneDrive\Desktop\Rijeka
git add .
git commit -m "Sprint 2 Day 6/7: FastAPI backend + trades blotter + deploy config"
git push
```

### Step 2: Create Netlify site
1. Go to app.netlify.com → Add new site → Import an existing project
2. Connect GitHub → select `open-source-cross-asset-pricing-and-risk-platform`
3. Netlify auto-reads `netlify.toml` — no manual settings needed
4. Click Deploy

### Step 3: Set custom domain
1. Netlify → Site settings → Domain management → Add custom domain
2. Add: `app.rijeka.app`
3. In Namecheap → Advanced DNS → Add CNAME:
   - Host: `app`
   - Value: `[your-netlify-subdomain].netlify.app`

### Step 4: Add env vars to Netlify
Site settings → Environment variables → Add:
- `VITE_SUPABASE_URL` = `https://upuewetohnocfshkhafg.supabase.co`
- `VITE_SUPABASE_ANON_KEY` = `[your anon key]`

### Step 5: Update Supabase redirect URLs
Supabase Dashboard → Authentication → URL Configuration:
- Site URL: `https://app.rijeka.app`
- Redirect URLs: add `https://app.rijeka.app/**`

---

## Day 6 — Deploy backend to Render

### Step 1: Create Render web service
1. Go to render.com → New → Web Service
2. Connect GitHub → select repo
3. Root directory: `backend`
4. Build command: `pip install -r requirements.txt`
5. Start command: `uvicorn main:app --host 0.0.0.0 --port $PORT`

### Step 2: Set env vars in Render dashboard
- `DATABASE_URL` = get from Supabase → Settings → Database → Connection string (URI)
- `SUPABASE_JWT_SECRET` = Supabase → Settings → API → JWT Secret

### Step 3: Set custom domain
Render → Service → Settings → Custom Domain → Add: `api.rijeka.app`
In Namecheap → Add CNAME:
- Host: `api`
- Value: `[your-render-service].onrender.com`

### Step 4: Verify
```
curl https://api.rijeka.app/health
# → {"status":"ok","service":"rijeka-risk-api","version":"0.1.0"}
```

---

## Supabase redirect URLs (after deploy)
Add these to Supabase Auth → URL Configuration → Redirect URLs:
- http://localhost:5173/**
- https://app.rijeka.app/**
