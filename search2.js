const fs = require('fs');
const c = fs.readFileSync('./cashpoa.com/_next/static/chunks/23a0e400a4590bdc.js', 'utf8');
// Find Supabase URL context
let i = c.indexOf('xckttcub');
console.log('Context around xckttcub:');
console.log(c.substring(Math.max(0, i - 300), i + 300));
