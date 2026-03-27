const fs = require('fs');
const path = require('path');

const bookPath = 'C:\\Users\\mikod\\OneDrive\\Desktop\\Rijeka\\frontend\\src\\components\\blotter\\BookTab.jsx';
let src = fs.readFileSync(bookPath, 'utf8');

// Remove the selectedTrades line that references rows before it's defined
src = src.replace(
  `  const [selected, setSelected] = useState(new Set())

  const toggleSelect = (id) => setSelected(prev => {
    const next = new Set(prev)
    next.has(id) ? next.delete(id) : next.add(id)
    return next
  })
  const selectedTrades = rows.filter(t => selected.has(t.id))`,
  `  const [selected, setSelected] = useState(new Set())

  const toggleSelect = (id) => setSelected(prev => {
    const next = new Set(prev)
    next.has(id) ? next.delete(id) : next.add(id)
    return next
  })`
);

// Move selectedTrades calculation to just before it's used (after rows is defined)
src = src.replace(
  `  const TH=({col,label})=>(`,
  `  const selectedTrades = rows.filter(t => selected.has(t.id))

  const TH=({col,label})=>(`
);

fs.writeFileSync(bookPath, src, 'utf8');
console.log('✅  BookTab — rows initialization order fixed');
