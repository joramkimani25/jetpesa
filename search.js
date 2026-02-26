const fs = require('fs');
const path = require('path');
const chunksDir = './cashpoa.com/_next/static/chunks/';
const chunks = fs.readdirSync(chunksDir).filter(f => f.endsWith('.js'));
for (const chunk of chunks) {
  const c = fs.readFileSync(chunksDir + chunk, 'utf8');
  const m = c.match(/eyJhbGciOiJIUzI[A-Za-z0-9._-]{20,}/);
  if (m) console.log('JWT in', chunk, ':', m[0].substring(0, 120));
  if (c.includes('xckttcub')) console.log('Supabase URL ref in', chunk);
}
console.log('Done');
