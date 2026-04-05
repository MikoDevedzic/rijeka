const fs = require('fs')
const s = fs.readFileSync('C:\\Users\\mikod\\OneDrive\\Desktop\\Rijeka\\frontend\\src\\components\\blotter\\TradeBookingWindow.jsx','utf8')

// Find window size
const wi = s.indexOf('useState({ w:')
console.log('Window size:', JSON.stringify(s.slice(wi, wi+50)))

// Count font sizes in ScenarioTab
const tabStart = s.indexOf('function ScenarioTab(')
const tabEnd   = s.indexOf('\nexport default function TradeBookingWindow(')
const tab = s.slice(tabStart, tabEnd)

const sizes = {}
const re = /fontSize:'([^']+)'/g
let m
while((m=re.exec(tab))!==null){
  sizes[m[1]] = (sizes[m[1]]||0)+1
}
console.log('\nFont sizes in ScenarioTab:')
Object.entries(sizes).sort().forEach(([k,v])=>console.log(' ',k,'=>',v,'occurrences'))
