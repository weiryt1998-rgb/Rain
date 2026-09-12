'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const net = require('node:net');
const { createServer } = require('../scripts/serve.cjs');

let server;
let base;

test.before(async () => {
  server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(() => new Promise(resolve => server.close(resolve)));

function request(path, method = 'GET') {
  return new Promise((resolve, reject) => {
    const req = http.request(base + path, { method }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    req.end();
  });
}

test('serves the app shell with the right content types and no-store caching', async () => {
  const index = await request('/');
  assert.equal(index.status, 200);
  assert.equal(index.headers['content-type'], 'text/html; charset=utf-8');
  assert.equal(index.headers['cache-control'], 'no-store');
  assert.equal(index.headers['x-content-type-options'], 'nosniff');
  assert.match(index.body.toString('utf8'), /<html lang="th"/);

  const files = [
    ['/style.css', 'text/css; charset=utf-8'],
    ['/script.js', 'text/javascript; charset=utf-8'],
    ['/weather-core.js', 'text/javascript; charset=utf-8'],
    ['/theme-init.js', 'text/javascript; charset=utf-8'],
    ['/sw.js', 'text/javascript; charset=utf-8'],
    ['/manifest.webmanifest', 'application/manifest+json; charset=utf-8'],
    ['/favicon.svg', 'image/svg+xml'],
    ['/icons/icon-192.png', 'image/png']
  ];
  for (const [path, type] of files) {
    const response = await request(path);
    assert.equal(response.status, 200, path);
    assert.equal(response.headers['content-type'], type, path);
    assert.equal(Number(response.headers['content-length']), response.body.length, path);
  }
});

test('HEAD returns headers without a body and other methods are rejected', async () => {
  const head = await request('/index.html', 'HEAD');
  assert.equal(head.status, 200);
  assert.equal(head.body.length, 0);
  assert(Number(head.headers['content-length']) > 0);
  const post = await request('/', 'POST');
  assert.equal(post.status, 405);
  assert.equal(post.headers.allow, 'GET, HEAD');
});

test('query strings and hashes are ignored when resolving files', async () => {
  const response = await request('/?district=si-nakhon');
  assert.equal(response.status, 200);
  assert.equal(response.headers['content-type'], 'text/html; charset=utf-8');
});

// Sends the request line verbatim so URL normalisation in the client cannot hide a traversal attempt.
function rawStatus(path) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(server.address().port, '127.0.0.1', () => {
      socket.write(`GET ${path} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n`);
    });
    let data = '';
    socket.setEncoding('utf8');
    socket.on('data', chunk => { data += chunk; });
    socket.on('end', () => resolve(Number(/^HTTP\/1\.1 (\d{3})/.exec(data)?.[1])));
    socket.on('error', reject);
  });
}

test('files outside the app, dotfiles and node_modules are never served', async () => {
  const blocked = ['/../package.json', '/..%2Fpackage.json', '/.gitignore', '/node_modules/playwright/package.json', '/scripts/../.gitignore', '/%2e%2e/package.json', '/C:/Windows/win.ini', '/icons/..%5C..%5Cpackage.json', '/%00'];
  for (const path of blocked) {
    const status = await rawStatus(path);
    assert.ok([400, 403, 404].includes(status), `${path} -> ${status}`);
  }
});

test('missing files and directories return 404 and malformed URLs return 400', async () => {
  assert.equal((await request('/missing.css')).status, 404);
  assert.equal((await request('/icons')).status, 404);
  assert.equal((await request('/%E0%A4%A')).status, 400);
});
