// Render src/legal/*.js to static pages for the landing site (netlify_drop/terms.html, privacy.html).
import { writeFileSync, mkdirSync } from 'node:fs'
import { TERMS, TERMS_META } from '../src/legal/terms.js'
import { PRIVACY, PRIVACY_META } from '../src/legal/privacy.js'
const esc = s => s.replace(/&/g,'&amp;').replace(/</g,'&lt;')
const page = (meta, sections, other) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(meta.title)} · Rijeka</title><meta name="robots" content="index,follow">
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;600&family=IBM+Plex+Sans:wght@400;600;700&display=swap" rel="stylesheet">
<style>:root{--bg:#000;--text:#f0f0f0;--dim:#8a8a8a;--accent:#0dd4a8;--border:#1e1e1e}body{margin:0;background:var(--bg);color:var(--text);font-family:'IBM Plex Sans',system-ui,sans-serif}
header{display:flex;align-items:center;height:44px;padding:0 20px;border-bottom:1px solid var(--border)}header a.brand{font-weight:700;letter-spacing:.2em;color:var(--accent);text-decoration:none}
header nav{margin-left:auto;display:flex;gap:16px}header nav a{font-family:'IBM Plex Mono',monospace;font-size:11px;letter-spacing:.14em;color:var(--dim);text-decoration:none}
main{max-width:820px;margin:0 auto;padding:28px 20px 60px}h1{font-family:'IBM Plex Mono',monospace;font-size:16px;letter-spacing:.3em;color:var(--accent);margin:0 0 4px}
.meta{font-family:'IBM Plex Mono',monospace;font-size:11px;letter-spacing:.1em;color:var(--dim);margin:0 0 22px}h2{font-size:15px;margin:20px 0 6px}p{font-size:14.5px;line-height:1.65;margin:0 0 8px}
footer{margin-top:32px;font-family:'IBM Plex Mono',monospace;font-size:11px;letter-spacing:.08em;color:var(--dim)}footer a{color:var(--accent);text-decoration:none}</style></head>
<body><header><a class="brand" href="/">RIJEKA</a><nav><a href="/terms.html">TERMS</a><a href="/privacy.html">PRIVACY</a><a href="https://app.rijeka.app">OPEN THE PLATFORM</a></nav></header>
<main><h1>${esc(meta.title).toUpperCase()}</h1><p class="meta">Rijeka LLC · version ${meta.version} · last updated ${esc(meta.updated)}</p>
${sections.map(s => `<section><h2>${esc(s.h)}</h2>${s.p.map(t => `<p>${esc(t)}</p>`).join('')}</section>`).join('\n')}
<footer>See also the <a href="${other.href}">${other.label}</a>. Questions: miko@rijeka.app</footer></main></body></html>\n`
mkdirSync('../netlify_drop', { recursive: true })
writeFileSync('../netlify_drop/terms.html',   page(TERMS_META, TERMS,     { href: '/privacy.html', label: 'Privacy Notice' }))
writeFileSync('../netlify_drop/privacy.html', page(PRIVACY_META, PRIVACY, { href: '/terms.html',   label: 'Terms of Service' }))
console.log('wrote netlify_drop/terms.html and privacy.html')
