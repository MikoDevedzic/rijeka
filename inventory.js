const fs   = require('fs')
const path = require('path')
const SRC  = 'C:\\Users\\mikod\\OneDrive\\Desktop\\Rijeka\\frontend\\src'

function walkDir(dir) {
  let files = []
  for (const entry of fs.readdirSync(dir)) {
    const full = path.join(dir, entry)
    const stat = fs.statSync(full)
    if (stat.isDirectory() && !entry.startsWith('.') && entry !== 'node_modules') {
      files = files.concat(walkDir(full))
    } else if (entry.endsWith('.jsx') || entry.endsWith('.css')) {
      files.push(full)
    }
  }
  return files
}

const files = walkDir(SRC)
console.log('=== ALL JSX + CSS FILES ===')
files.forEach(f => {
  const rel = path.relative(SRC, f)
  const s = fs.readFileSync(f, 'utf8')
  const lines = s.split('\n').length
  // Count font size occurrences
  const oldFonts = (s.match(/fontSize:'0\.[0-9]+rem'/g)||[]).length
  const spaceFonts = (s.match(/Space Grotesk/g)||[]).length
  const dmFonts = (s.match(/DM Mono/g)||[]).length
  console.log(`${rel} — ${lines} lines | old-fonts:${oldFonts} | SG:${spaceFonts} | DM:${dmFonts}`)
})
