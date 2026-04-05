const fs = require('fs')
const path = require('path')

const files = [
  'C:\\Users\\mikod\\OneDrive\\Desktop\\Rijeka\\frontend\\src\\components\\blotter\\TradeBookingWindow.css',
  'C:\\Users\\mikod\\OneDrive\\Desktop\\Rijeka\\frontend\\src\\components\\blotter\\BlotterShell.css',
  'C:\\Users\\mikod\\OneDrive\\Desktop\\Rijeka\\frontend\\src\\components\\layout\\AppBar.jsx',
]

files.forEach(f => {
  try {
    const s = fs.readFileSync(f, 'utf8')
    console.log('\n===', path.basename(f), '===')
    console.log(s.slice(0, 800))
  } catch(e) { console.log('NOT FOUND:', f) }
})
