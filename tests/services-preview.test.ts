import test from 'node:test';
import assert from 'node:assert/strict';
import { previewUrl } from '../src/client/ui/services.js';

test('on localhost the preview goes through the office port as p<port>.localhost', () => {
  assert.equal(previewUrl(5173, { protocol: 'http:', hostname: 'localhost', port: '4600' }), 'http://p5173.localhost:4600/');
  assert.equal(previewUrl(3000, { protocol: 'https:', hostname: 'localhost', port: '' }), 'https://p3000.localhost/');
});

test('anywhere else the preview is the per-port tunnel address', () => {
  assert.equal(previewUrl(5173, { protocol: 'https:', hostname: 'office.example.com', port: '' }), 'https://localhost:5173');
  assert.equal(previewUrl(5173, { protocol: 'http:', hostname: '10.0.0.4', port: '4600' }), 'http://localhost:5173');
});
