const fs = require('fs');
// Search all JS chunks for API endpoints
const dir = './cashpoa.com/_next/static/chunks/';
const files = fs.readdirSync(dir).filter(f => f.endsWith('.js'));
const endpoints = new Set();
for (const f of files) {
  const c = fs.readFileSync(dir + f, 'utf8');
  const re = /["'](\/api\/[a-zA-Z0-9_/\-]+)["']/g;
  let m;
  while ((m = re.exec(c)) !== null) {
    endpoints.add(m[1]);
  }
}
console.log('All /api endpoints:');
[...endpoints].sort().forEach(e => console.log(' ', e));
