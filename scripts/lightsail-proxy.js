#!/usr/bin/env node
const http = require('http');
const https = require('https');
const fs = require('fs');

function proxy(clientReq, clientRes) {
  const opts = {
    hostname: '127.0.0.1',
    port: 4110,
    path: clientReq.url,
    method: clientReq.method,
    headers: {
      ...clientReq.headers,
      host: clientReq.headers.host || 'staging.unifact.ai'
    }
  };
  const upstream = http.request(opts, (up) => {
    clientRes.writeHead(up.statusCode || 502, up.headers);
    up.pipe(clientRes);
  });
  upstream.on('error', () => {
    clientRes.writeHead(502, { 'Content-Type': 'text/plain' });
    clientRes.end('UniFact upstream unavailable');
  });
  clientReq.pipe(upstream);
}

// Prefer Let's Encrypt; fall back to snakeoil only for broken local boots.
const leDir = '/etc/letsencrypt/live/staging.unifact.ai';
const tls = fs.existsSync(`${leDir}/privkey.pem`)
  ? {
      key: fs.readFileSync(`${leDir}/privkey.pem`),
      cert: fs.readFileSync(`${leDir}/fullchain.pem`)
    }
  : {
      key: fs.readFileSync('/etc/ssl/private/ssl-cert-snakeoil.key'),
      cert: fs.readFileSync('/etc/ssl/certs/ssl-cert-snakeoil.pem')
    };

http.createServer(proxy).listen(80);
https.createServer(tls, proxy).listen(443);
console.log(
  'proxy listening on 80/443 -> 127.0.0.1:4110',
  fs.existsSync(`${leDir}/privkey.pem`) ? '(Let\'s Encrypt)' : '(snakeoil fallback)'
);
