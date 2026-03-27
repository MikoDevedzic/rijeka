const fs = require('fs');

const envPath = 'C:\\Users\\mikod\\OneDrive\\Desktop\\Rijeka\\backend\\.env';

const content = `DATABASE_URL=postgresql://postgres.upuewetohnocfshkhafg:Kuracmoj1%21@aws-1-us-east-1.pooler.supabase.com:5432/postgres
SUPABASE_JWT_SECRET=xMLkZgCOiISZcnwJ1QW6lhS1YIYSbnJOGS761L7QPCE+udDh2HX3OYsw/RvAbyrYszd7/q9ee/8ECyzWXyjl3w==
FRONTEND_URL=https://app.rijeka.app
`;

fs.writeFileSync(envPath, content, 'utf8');
console.log('✅  .env updated — password URL-encoded');
