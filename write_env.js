const fs = require('fs');
const path = require('path');

const envPath = 'C:\\Users\\mikod\\OneDrive\\Desktop\\Rijeka\\backend\\.env';

const content = `DATABASE_URL=postgresql://postgres:Kuracmoj1!@db.upuewetohnocfshkhafg.supabase.co:5432/postgres
SUPABASE_JWT_SECRET=xMLkZgCOiISZcnwJ1QW6lhS1YIYSbnJOGS761L7QPCE+udDh2HX3OYsw/RvAbyrYszd7/q9ee/8ECyzWXyjl3w==
FRONTEND_URL=https://app.rijeka.app
`;

fs.writeFileSync(envPath, content, 'utf8');
console.log('✅  .env written to:', envPath);
