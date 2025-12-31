const fs = require('fs');
const path = require('path');
const selfsigned = require('selfsigned');

const attrs = [{ name: 'commonName', value: 'localhost' }];
const opts = {
  days: 365,
  keySize: 2048,
  algorithm: 'sha256',
  extensions: [
    { name: 'basicConstraints', cA: true },
    { name: 'keyUsage', keyCertSign: true, digitalSignature: true, nonRepudiation: true, keyEncipherment: true, dataEncipherment: true },
    { name: 'extKeyUsage', serverAuth: true, clientAuth: true },
    { name: 'subjectAltName', altNames: [{ type: 2, value: 'localhost' }, { type: 7, ip: '127.0.0.1' }] }
  ]
};

const pems = selfsigned.generate(attrs, opts);

const outDir = path.resolve(__dirname, '..', 'certs');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

fs.writeFileSync(path.join(outDir, 'localhost.pem'), pems.cert);
fs.writeFileSync(path.join(outDir, 'localhost.key'), pems.private);

console.log('Generated self-signed certificate:');
console.log('  cert ->', path.join(outDir, 'localhost.pem'));
console.log('  key  ->', path.join(outDir, 'localhost.key'));
