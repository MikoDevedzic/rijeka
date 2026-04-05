const fs = require('fs')

// Check index.css
const css = fs.readFileSync('C:\\Users\\mikod\\OneDrive\\Desktop\\Rijeka\\frontend\\src\\index.css','utf8')
const lines = css.split('\n')
console.log('=== index.css first 80 lines ===')
lines.slice(0,80).forEach((l,i)=>console.log(i+1,l))
