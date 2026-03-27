const fs = require('fs');

const cmpPath = 'C:\\Users\\mikod\\OneDrive\\Desktop\\Rijeka\\frontend\\src\\components\\blotter\\CompareWorkspace.jsx';
let src = fs.readFileSync(cmpPath, 'utf8');

// Ensure supabase is imported
if (!src.includes("import { supabase }")) {
  src = src.replace(
    `import { useState } from 'react'`,
    `import { useState } from 'react'
import { supabase } from '../../lib/supabase'`
  );
}

// Also check it's not already there with different path
if (!src.includes('supabase')) {
  src = src.replace(
    `import { useState } from 'react'`,
    `import { useState } from 'react'
import { supabase } from '../../lib/supabase'`
  );
}

fs.writeFileSync(cmpPath, src, 'utf8');
console.log('✅  CompareWorkspace — supabase import fixed');
