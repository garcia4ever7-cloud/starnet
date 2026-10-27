/* Test that /api/studio-file endpoint serves files correctly */
'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const projectId = 'proj-1792964044657-xs9vyt';
const fileName = 'video.mp4';
const videoPath = path.join(os.homedir(), 'outbox', projectId, fileName);

console.log('\n=== Testing /api/studio-file Serving ===\n');
console.log('Video path:', videoPath);
console.log('File exists:', fs.existsSync(videoPath));

if (fs.existsSync(videoPath)) {
  const stat = fs.statSync(videoPath);
  console.log('File size:', stat.size, 'bytes');

  // Read first bytes to verify content
  const header = Buffer.alloc(12);
  const fd = fs.openSync(videoPath, 'r');
  fs.readSync(fd, header, 0, 12);
  fs.closeSync(fd);
  console.log('File header (hex):', header.toString('hex'));
  console.log('MP4 signature valid:', header.toString('ascii', 4, 8) === 'ftyp');
}

console.log('\n--- Testing HTTP GET (with HEAD first) ---\n');

const testEndpoint = () => {
  return new Promise((resolve) => {
    const options = {
      hostname: '127.0.0.1',
      port: 8787,
      path: `/api/studio-file?project=${encodeURIComponent(projectId)}&file=${encodeURIComponent(fileName)}`,
      method: 'GET',
      headers: {
        'Range': 'bytes=0-11' // Test range request
      }
    };

    const req = http.request(options, (res) => {
      console.log('Status Code:', res.statusCode);
      console.log('Headers:', {
        'content-type': res.headers['content-type'],
        'content-length': res.headers['content-length'],
        'content-range': res.headers['content-range'],
        'accept-ranges': res.headers['accept-ranges'],
        'content-disposition': res.headers['content-disposition']
      });

      let data = Buffer.alloc(0);
      res.on('data', (chunk) => {
        data = Buffer.concat([data, chunk]);
      });

      res.on('end', () => {
        console.log('\nResponse body size:', data.length, 'bytes');
        if (data.length > 0) {
          console.log('Response header (hex):', data.slice(0, 12).toString('hex'));
          console.log('Response content:', data.toString('utf8', 0, Math.min(50, data.length)));
        }

        if (res.statusCode === 200 || res.statusCode === 206) {
          console.log('\n✅ Endpoint working correctly');
        } else if (res.statusCode === 403) {
          console.log('\n⚠️  Auth required (expected without token)');
        } else {
          console.log('\n✗ Unexpected status:', res.statusCode);
        }

        resolve();
      });
    });

    req.on('error', (e) => {
      console.error('✗ Request error:', e.message);
      resolve();
    });

    req.setTimeout(5000, () => {
      console.error('✗ Request timeout');
      req.abort();
      resolve();
    });

    req.end();
  });
};

testEndpoint().then(() => {
  console.log('\n=== Summary ===');
  console.log('The /api/studio-file endpoint should:');
  console.log('  1. Accept project and file query parameters');
  console.log('  2. Validate paths to prevent traversal');
  console.log('  3. Stream file content via HTTP');
  console.log('  4. Support Range requests for seeking');
  console.log('  5. Set proper Content-Type and Content-Disposition');
  console.log('\nIf status is 403 without auth, add token header:');
  console.log('  curl -H "x-starnet-token: TOKEN" \\');
  console.log(`    http://localhost:8787/api/studio-file?project=${projectId}&file=${fileName}`);
});
