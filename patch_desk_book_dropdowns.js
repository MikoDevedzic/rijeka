const fs = require('fs');
const path = require('path');
const ROOT = 'C:\\Users\\mikod\\OneDrive\\Desktop\\Rijeka\\frontend\\src';

// ── 1. Patch NewTradeWorkspace — desk/book from org_nodes ────────────────────
const ntwPath = path.join(ROOT, 'components', 'blotter', 'NewTradeWorkspace.jsx');
let ntw = fs.readFileSync(ntwPath, 'utf8');

// Add org nodes state variables after cps/les state
ntw = ntw.replace(
  `  const [cps,setCps]=useState([])
  const [les,setLes]=useState([])`,
  `  const [cps,setCps]=useState([])
  const [les,setLes]=useState([])
  const [desks,setDesks]=useState([])
  const [books,setBooks]=useState([])
  const [filteredBooks,setFilteredBooks]=useState([])`
);

// Fetch desks and books from org_nodes
ntw = ntw.replace(
  `  useEffect(()=>{
    supabase.from('counterparties').select('*').then(({data})=>setCps(data||[]))
    supabase.from('legal_entities').select('*').then(({data})=>setLes(data||[]))
  },[])`,
  `  useEffect(()=>{
    supabase.from('counterparties').select('*').then(({data})=>setCps(data||[]))
    supabase.from('legal_entities').select('*').then(({data})=>setLes(data||[]))
    supabase.from('org_nodes')
      .select('*')
      .eq('is_active', true)
      .order('sort_order')
      .then(({data}) => {
        const nodes = data || []
        setDesks(nodes.filter(n => n.node_type === 'desk'))
        setBooks(nodes.filter(n => n.node_type === 'book'))
        setFilteredBooks(nodes.filter(n => n.node_type === 'book'))
      })
  },[])`
);

// Add desk state with id tracking
ntw = ntw.replace(
  `  const [desk,setDesk]=useState('')
  const [book,setBook]=useState('')`,
  `  const [desk,setDesk]=useState('')
  const [deskId,setDeskId]=useState('')
  const [book,setBook]=useState('')
  const [bookId,setBookId]=useState('')`
);

// Replace desk/book freetext inputs with dropdowns
ntw = ntw.replace(
  `            <div className="row2" style={{marginTop:'0.5rem'}}>
              <div className="fg"><label>DESK</label><input placeholder="RATES TRADING" value={desk} onChange={e=>setDesk(e.target.value)}/></div>
              <div className="fg"><label>BOOK</label><input placeholder="G10 RATES" value={book} onChange={e=>setBook(e.target.value)}/></div>
            </div>`,
  `            <div className="row2" style={{marginTop:'0.5rem'}}>
              <div className="fg">
                <label>DESK</label>
                <select value={deskId} onChange={e=>{
                  const id = e.target.value
                  const d = desks.find(x=>x.id===id)
                  setDeskId(id)
                  setDesk(d?.name||'')
                  // filter books to this desk's children
                  const fb = books.filter(b=>b.parent_id===id)
                  setFilteredBooks(fb)
                  setBookId('')
                  setBook('')
                }}>
                  <option value="">— select desk —</option>
                  {desks.map(d=><option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </div>
              <div className="fg">
                <label>BOOK</label>
                <select value={bookId} onChange={e=>{
                  const id = e.target.value
                  const b = filteredBooks.find(x=>x.id===id)
                  setBookId(id)
                  setBook(b?.name||'')
                }} disabled={!deskId}>
                  <option value="">{deskId?'— select book —':'— select desk first —'}</option>
                  {filteredBooks.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </div>
            </div>`
);

fs.writeFileSync(ntwPath, ntw, 'utf8');
console.log('✅  NewTradeWorkspace.jsx — desk/book wired to org_nodes');

// ── 2. Write SQL to insert book nodes under each desk ────────────────────────
const sql = `-- ============================================================
-- Rijeka — Insert book nodes under each desk
-- Run in Supabase SQL Editor
-- ============================================================

-- First, let's see what desk IDs we have
-- (run this SELECT first to confirm desk IDs before inserting)

SELECT id, name, node_type FROM org_nodes WHERE node_type = 'desk' ORDER BY name;

-- ============================================================
-- Insert books under each desk
-- Uses subqueries to find parent desk ID dynamically
-- ============================================================

INSERT INTO org_nodes (name, node_type, parent_id, is_active, sort_order)
SELECT 'G10 RATES', 'book', id, true, 1
FROM org_nodes WHERE name = 'RATES TRADING' AND node_type = 'desk'
ON CONFLICT DO NOTHING;

INSERT INTO org_nodes (name, node_type, parent_id, is_active, sort_order)
SELECT 'EM RATES', 'book', id, true, 2
FROM org_nodes WHERE name = 'RATES TRADING' AND node_type = 'desk'
ON CONFLICT DO NOTHING;

INSERT INTO org_nodes (name, node_type, parent_id, is_active, sort_order)
SELECT 'INFLATION', 'book', id, true, 3
FROM org_nodes WHERE name = 'RATES TRADING' AND node_type = 'desk'
ON CONFLICT DO NOTHING;

INSERT INTO org_nodes (name, node_type, parent_id, is_active, sort_order)
SELECT 'XVA RATES', 'book', id, true, 4
FROM org_nodes WHERE name = 'RATES TRADING' AND node_type = 'desk'
ON CONFLICT DO NOTHING;

-- FX TRADING books
INSERT INTO org_nodes (name, node_type, parent_id, is_active, sort_order)
SELECT 'G10 FX', 'book', id, true, 1
FROM org_nodes WHERE name = 'FX TRADING' AND node_type = 'desk'
ON CONFLICT DO NOTHING;

INSERT INTO org_nodes (name, node_type, parent_id, is_active, sort_order)
SELECT 'EM FX', 'book', id, true, 2
FROM org_nodes WHERE name = 'FX TRADING' AND node_type = 'desk'
ON CONFLICT DO NOTHING;

INSERT INTO org_nodes (name, node_type, parent_id, is_active, sort_order)
SELECT 'FX OPTIONS', 'book', id, true, 3
FROM org_nodes WHERE name = 'FX TRADING' AND node_type = 'desk'
ON CONFLICT DO NOTHING;

-- CREDIT TRADING books
INSERT INTO org_nodes (name, node_type, parent_id, is_active, sort_order)
SELECT 'INVESTMENT GRADE', 'book', id, true, 1
FROM org_nodes WHERE name = 'CREDIT TRADING' AND node_type = 'desk'
ON CONFLICT DO NOTHING;

INSERT INTO org_nodes (name, node_type, parent_id, is_active, sort_order)
SELECT 'HIGH YIELD', 'book', id, true, 2
FROM org_nodes WHERE name = 'CREDIT TRADING' AND node_type = 'desk'
ON CONFLICT DO NOTHING;

INSERT INTO org_nodes (name, node_type, parent_id, is_active, sort_order)
SELECT 'CDS & INDICES', 'book', id, true, 3
FROM org_nodes WHERE name = 'CREDIT TRADING' AND node_type = 'desk'
ON CONFLICT DO NOTHING;

-- COMMODITIES TRADING books
INSERT INTO org_nodes (name, node_type, parent_id, is_active, sort_order)
SELECT 'ENERGY', 'book', id, true, 1
FROM org_nodes WHERE name = 'COMMODITIES TRADING' AND node_type = 'desk'
ON CONFLICT DO NOTHING;

INSERT INTO org_nodes (name, node_type, parent_id, is_active, sort_order)
SELECT 'METALS', 'book', id, true, 2
FROM org_nodes WHERE name = 'COMMODITIES TRADING' AND node_type = 'desk'
ON CONFLICT DO NOTHING;

INSERT INTO org_nodes (name, node_type, parent_id, is_active, sort_order)
SELECT 'EMISSIONS', 'book', id, true, 3
FROM org_nodes WHERE name = 'COMMODITIES TRADING' AND node_type = 'desk'
ON CONFLICT DO NOTHING;

-- EQUITY DERIVATIVES books
INSERT INTO org_nodes (name, node_type, parent_id, is_active, sort_order)
SELECT 'SINGLE STOCK', 'book', id, true, 1
FROM org_nodes WHERE name = 'EQUITY DERIVATIVES' AND node_type = 'desk'
ON CONFLICT DO NOTHING;

INSERT INTO org_nodes (name, node_type, parent_id, is_active, sort_order)
SELECT 'INDEX & VOLATILITY', 'book', id, true, 2
FROM org_nodes WHERE name = 'EQUITY DERIVATIVES' AND node_type = 'desk'
ON CONFLICT DO NOTHING;

INSERT INTO org_nodes (name, node_type, parent_id, is_active, sort_order)
SELECT 'DIVIDEND SWAPS', 'book', id, true, 3
FROM org_nodes WHERE name = 'EQUITY DERIVATIVES' AND node_type = 'desk'
ON CONFLICT DO NOTHING;

-- XVA DESK books
INSERT INTO org_nodes (name, node_type, parent_id, is_active, sort_order)
SELECT 'CVA/DVA', 'book', id, true, 1
FROM org_nodes WHERE name = 'XVA DESK' AND node_type = 'desk'
ON CONFLICT DO NOTHING;

INSERT INTO org_nodes (name, node_type, parent_id, is_active, sort_order)
SELECT 'FVA & COLVA', 'book', id, true, 2
FROM org_nodes WHERE name = 'XVA DESK' AND node_type = 'desk'
ON CONFLICT DO NOTHING;

INSERT INTO org_nodes (name, node_type, parent_id, is_active, sort_order)
SELECT 'MVA', 'book', id, true, 3
FROM org_nodes WHERE name = 'XVA DESK' AND node_type = 'desk'
ON CONFLICT DO NOTHING;

-- Verify
SELECT
  d.name as desk,
  b.name as book,
  b.sort_order
FROM org_nodes b
JOIN org_nodes d ON b.parent_id = d.id
WHERE b.node_type = 'book'
ORDER BY d.name, b.sort_order;
`;

const sqlPath = 'C:\\Users\\mikod\\OneDrive\\Desktop\\Rijeka\\docs\\books_migration.sql';
fs.mkdirSync(path.dirname(sqlPath), { recursive: true });
fs.writeFileSync(sqlPath, sql, 'utf8');
console.log('✅  docs/books_migration.sql written');
console.log('\nTo apply:');
console.log('  1. Supabase Dashboard → Database → SQL Editor → New query');
console.log('  2. Paste contents of docs/books_migration.sql');
console.log('  3. Run — inserts books under each desk');
console.log('\nDesk → Book structure:');
console.log('  RATES TRADING    → G10 RATES, EM RATES, INFLATION, XVA RATES');
console.log('  FX TRADING       → G10 FX, EM FX, FX OPTIONS');
console.log('  CREDIT TRADING   → INVESTMENT GRADE, HIGH YIELD, CDS & INDICES');
console.log('  COMMODITIES      → ENERGY, METALS, EMISSIONS');
console.log('  EQUITY DERIVS    → SINGLE STOCK, INDEX & VOLATILITY, DIVIDEND SWAPS');
console.log('  XVA DESK         → CVA/DVA, FVA & COLVA, MVA');
