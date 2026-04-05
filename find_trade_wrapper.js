const fs = require('fs')

// Check CSS for tbw-body scroll
const css = fs.readFileSync('C:\\Users\\mikod\\OneDrive\\Desktop\\Rijeka\\frontend\\src\\components\\blotter\\TradeBookingWindow.css','utf8')
console.log('=== tbw-body CSS ===')
const i = css.indexOf('tbw-body')
console.log(css.slice(i, i+300))

// Find the trade tab outer wrapper in JSX
const s = fs.readFileSync('C:\\Users\\mikod\\OneDrive\\Desktop\\Rijeka\\frontend\\src\\components\\blotter\\TradeBookingWindow.jsx','utf8')

// Find where the trade tab starts - look for activeTab
const tabContent = s.indexOf("activeTab==='trade' &&")
console.log('\ntrade tab content at:', tabContent)
if (tabContent > 0) console.log(JSON.stringify(s.slice(tabContent, tabContent+300)))

// Also look for the wrapper that contains both the form AND analytics
// Search for the div that wraps everything in the trade tab
const tbwTradeBody = s.indexOf("className='tbw-body'")
console.log('\ntbw-body class usage at:', tbwTradeBody)
if (tbwTradeBody > 0) console.log(JSON.stringify(s.slice(tbwTradeBody-50, tbwTradeBody+200)))
