'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { getSessionExpiresAt } = require('../lib/db/postgres-session-store');

test('postgres session store uses cookie expiration when present', () => {
  const expires = new Date(Date.now() + 60 * 1000).toISOString();
  const result = getSessionExpiresAt({ cookie: { expires } }, 24 * 60 * 60 * 1000);

  assert.equal(result.toISOString(), expires);
});

test('postgres session store falls back to ttl for missing or invalid expiration', () => {
  const before = Date.now();
  const result = getSessionExpiresAt({ cookie: { expires: 'invalid-date' } }, 60 * 1000);
  const after = Date.now();

  assert.ok(result.getTime() >= before + 60 * 1000);
  assert.ok(result.getTime() <= after + 60 * 1000);
});
