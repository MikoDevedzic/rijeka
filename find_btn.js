const fs   = require('fs')
const path = require('path')
const SRC  = 'C:\\Users\\mikod\\OneDrive\\Desktop\\Rijeka\\frontend\\src'

// 1. Fix tbw-btn-book in CSS
const TBWCSS = path.join(SRC, 'components\\blotter\\TradeBookingWindow.css')
let css = fs.readFileSync(TBWCSS, 'utf8')
console.log('=== tbw-btn-book ===')
const i = css.indexOf('tbw-btn-book')
console.log(css.slice(i, i+200))
