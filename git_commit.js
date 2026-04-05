// git_commit.js
// Commits and pushes code only. Architecture docs stay local.
// Run from: C:\Users\mikod\OneDrive\Desktop\Rijeka

const { execSync } = require('child_process')
const ROOT = 'C:\\Users\\mikod\\OneDrive\\Desktop\\Rijeka'

process.chdir(ROOT)

// Make sure .gitignore excludes architecture docs
const fs = require('fs')
let gitignore = ''
try { gitignore = fs.readFileSync('.gitignore', 'utf8') } catch(e) {}
if (!gitignore.includes('ARCHITECTURE_')) {
  fs.appendFileSync('.gitignore', '\n# Local architecture docs\nARCHITECTURE_*.md\nSPRINT*_HANDOFF.md\nREAD_*.txt\n*.backup\n*.bak\n')
  console.log('✓ .gitignore updated — architecture docs excluded')
}

try {
  execSync('git add -A', { stdio: 'inherit' })
  execSync('git commit -m "Sprint 5: Curve Scenario tab redesign, Pure Black theme, IBM Plex fonts, sitewide style system, window improvements"', { stdio: 'inherit' })
  execSync('git push origin main', { stdio: 'inherit' })
  console.log('\n✅ Code committed and pushed. Architecture docs remain local only.')
} catch(e) {
  console.error('Git error:', e.message)
}
