const fs = require('fs');
const path = require('path');

const BACKEND_DIR = path.resolve('C:/Users/Admin/Documents/doc/backend');
const FRONTEND_DIR = path.resolve('C:/Users/Admin/Documents/doc/frontend');

console.log('Testing file access:');
console.log('Backend exists:', fs.existsSync(BACKEND_DIR));
console.log('Frontend exists:', fs.existsSync(FRONTEND_DIR));
