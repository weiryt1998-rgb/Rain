'use strict';

const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

function createServer() {
  return http.createServer(async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

    const sendError = (status, message) => {
      response.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end(request.method === 'HEAD' ? undefined : message);
    };

    if (!['GET', 'HEAD'].includes(request.method)) {
      response.setHeader('Allow', 'GET, HEAD');
      sendError(405, 'Method not allowed');
      return;
    }

    let pathname;
    try {
      pathname = decodeURIComponent((request.url || '/').split(/[?#]/, 1)[0]);
    } catch {
      sendError(400, 'Invalid URL');
      return;
    }

    const segments = pathname.split('/');
    if (!pathname.startsWith('/') || /[\\\0:]/.test(pathname) ||
        segments.some((segment) => segment.startsWith('.') || segment === 'node_modules')) {
      sendError(403, 'Forbidden');
      return;
    }

    const filePath = path.resolve(ROOT, `.${pathname === '/' ? '/index.html' : pathname}`);
    const relative = path.relative(ROOT, filePath);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      sendError(403, 'Forbidden');
      return;
    }

    try {
      // Resolve symlinks as well so a link cannot expose files outside this app.
      const realPath = await fs.realpath(filePath);
      const realRelative = path.relative(ROOT, realPath);
      if (realRelative.startsWith('..') || path.isAbsolute(realRelative)) {
        sendError(403, 'Forbidden');
        return;
      }
      const stat = await fs.stat(realPath);
      if (!stat.isFile()) {
        sendError(404, 'Not found');
        return;
      }
      const content = await fs.readFile(realPath);
      response.writeHead(200, {
        'Content-Type': CONTENT_TYPES[path.extname(realPath).toLowerCase()] || 'application/octet-stream',
        'Content-Length': content.length,
      });
      response.end(request.method === 'HEAD' ? undefined : content);
    } catch (error) {
      sendError(['ENOENT', 'ENOTDIR'].includes(error.code) ? 404 : 500,
        ['ENOENT', 'ENOTDIR'].includes(error.code) ? 'Not found' : 'Unable to read file');
    }
  });
}

if (require.main === module) {
  const port = Number(process.env.PORT || 4173);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    console.error('PORT must be an integer between 0 and 65535.');
    process.exitCode = 1;
  } else {
    const server = createServer();
    server.on('error', (error) => {
      console.error(`Unable to start Rain: ${error.message}`);
      process.exitCode = 1;
    });
    server.listen(port, '127.0.0.1', () => {
      console.log(`Rain Sukhothai is available at http://127.0.0.1:${server.address().port}`);
    });
  }
}

module.exports = { createServer };
