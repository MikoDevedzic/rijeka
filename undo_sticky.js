const fs   = require('fs')
const path = require('path')

// 1. Remove CSS
const CSS = path.join('C:\\Users\\mikod\\OneDrive\\Desktop\\Rijeka\\frontend\\src\\components\\blotter\\TradeBookingWindow.css')
let css = fs.readFileSync(CSS, 'utf8')
css = css.replace(`
/* Analytics panel — always visible, sticks to bottom of scroll area */
.tbw-analytics-sticky {
  position: sticky;
  bottom: -12px;
  margin: 0 -14px -12px;
  padding: 10px 14px 12px;
  background: var(--panel);
  border-top: 1px solid var(--border);
  z-index: 10;
  flex-shrink: 0;
}
`, '')
fs.writeFileSync(CSS, css, 'utf8')
console.log('✓ CSS removed')

// 2. Remove the sticky wrapper div from JSX
const TBW = path.join('C:\\Users\\mikod\\OneDrive\\Desktop\\Rijeka\\frontend\\src\\components\\blotter\\TradeBookingWindow.jsx')
let src = fs.readFileSync(TBW, 'utf8')

// Remove opening wrapper
src = src.replace(`            <div className='tbw-analytics-sticky'>\n`, '')
// Remove closing wrapper
src = src.replace(`            </div>\n            <Row`, `            <Row`)

fs.writeFileSync(TBW, src, 'utf8')
console.log('✓ Sticky wrapper removed from JSX')
console.log('✅ Reverted.')
