const fs = require('fs');

const orgPath = 'C:\\Users\\mikod\\OneDrive\\Desktop\\Rijeka\\frontend\\src\\components\\org\\OrgHierarchy.jsx';
let src = fs.readFileSync(orgPath, 'utf8');

// Fix CHILD_TYPE map — book and strategy had CSS var strings instead of node types
src = src.replace(
  `const CHILD_TYPE = {
  firm: 'division', division: 'desk', desk: 'book', sub_desk: 'custom', book: 'var(--blue)', strategy: 'var(--purple)', custom: 'custom',
}`,
  `const CHILD_TYPE = {
  firm: 'division', division: 'desk', desk: 'book', book: 'strategy', strategy: null, custom: 'custom',
}`
);

// Fix TYPE_LABEL map — book and strategy had CSS var strings instead of labels
src = src.replace(
  `const TYPE_LABEL = {
  firm: 'FIRM', division: 'DIV', desk: 'DESK', sub_desk: 'SUB', book: 'var(--blue)', strategy: 'var(--purple)', custom: 'CUST',
}`,
  `const TYPE_LABEL = {
  firm: 'FIRM', division: 'DIV', desk: 'DESK', book: 'BOOK', strategy: 'STRAT', custom: 'CUST',
}`
);

// Fix NODE_COLOR — strategy already correct, book already correct, just ensure no CSS strings
src = src.replace(
  `const NODE_COLOR = {
  firm: 'var(--accent)', division: 'var(--blue)', desk: 'var(--amber)',
  sub_desk: 'var(--purple)', book: 'var(--blue)', strategy: 'var(--purple)', custom: '#2a3f52',
}`,
  `const NODE_COLOR = {
  firm: 'var(--accent)', division: 'var(--blue)', desk: 'var(--amber)',
  book: '#3d8bc8', strategy: 'var(--purple)', custom: '#2a3f52',
}`
);

// Fix the add button — when CHILD_TYPE is null (strategy has no children), hide the add button
src = src.replace(
  `              <Btn color={color} onClick={() => onAdd(node.id, CHILD_TYPE[node.node_type])}>
                {'+ ' + TYPE_LABEL[CHILD_TYPE[node.node_type]]}
              </Btn>`,
  `              {CHILD_TYPE[node.node_type] && (
                <Btn color={color} onClick={() => onAdd(node.id, CHILD_TYPE[node.node_type])}>
                  {'+ ' + (TYPE_LABEL[CHILD_TYPE[node.node_type]] || CHILD_TYPE[node.node_type].toUpperCase())}
                </Btn>
              )}`
);

fs.writeFileSync(orgPath, src, 'utf8');
console.log('✅  OrgHierarchy.jsx fixed.');
console.log('');
console.log('Fixed:');
console.log('  TYPE_LABEL.book     = BOOK  (was "var(--blue)")');
console.log('  TYPE_LABEL.strategy = STRAT (was "var(--purple)")');
console.log('  CHILD_TYPE.book     = strategy');
console.log('  CHILD_TYPE.strategy = null  (no add button on strategy nodes)');
console.log('  Add button hidden when no child type defined');
