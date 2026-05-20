'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildSessionOptions,
  getRolePermissions,
  shouldSeedDefaultAdmin,
  isCsrfProtectedMethod,
  isCsrfExemptPath,
  isPublicApiPath
} = require('../lib/erp-security');

test('session options harden cookies in production', () => {
  const options = buildSessionOptions({
    isProduction: true,
    sessionSecret: 'secret-value',
    cookieMaxAgeMs: 8 * 60 * 60 * 1000
  });

  assert.equal(options.name, 'kinaadman.sid');
  assert.equal(options.secret, 'secret-value');
  assert.equal(options.resave, false);
  assert.equal(options.saveUninitialized, false);
  assert.equal(options.rolling, true);
  assert.equal(options.unset, 'destroy');
  assert.equal(options.cookie.httpOnly, true);
  assert.equal(options.cookie.sameSite, 'lax');
  assert.equal(options.cookie.secure, true);
  assert.equal(options.cookie.path, '/');
  assert.equal(options.cookie.maxAge, 8 * 60 * 60 * 1000);
});

test('session options stay non-secure in development', () => {
  const options = buildSessionOptions({
    isProduction: false,
    sessionSecret: 'secret-value'
  });

  assert.equal(options.cookie.secure, false);
});

test('session options accept a persistent store', () => {
  const store = { get() {}, set() {}, destroy() {} };
  const options = buildSessionOptions({
    isProduction: false,
    sessionSecret: 'secret-value',
    store
  });

  assert.equal(options.store, store);
});

test('role permissions are limited by role', () => {
  const admin = getRolePermissions('admin');
  const staff = getRolePermissions('staff');
  const user = getRolePermissions('user');

  assert.equal(admin.admin_tools, true);
  assert.equal(Object.prototype.hasOwnProperty.call(admin, 'procurement'), false);
  assert.equal(staff.admin_tools, false);
  assert.equal(staff.exports, true);
  assert.equal(user.dashboard, true);
  assert.equal(user.finance, false);
});

test('default admin seed is disabled in production', () => {
  assert.equal(shouldSeedDefaultAdmin({ isProduction: true, enabled: true }), false);
  assert.equal(shouldSeedDefaultAdmin({ isProduction: false, enabled: true }), true);
  assert.equal(shouldSeedDefaultAdmin({ isProduction: false, enabled: false }), false);
  assert.equal(shouldSeedDefaultAdmin({ isProduction: false }), true);
});

test('csrf helpers only protect mutating methods and skip public auth routes', () => {
  assert.equal(isCsrfProtectedMethod('GET'), false);
  assert.equal(isCsrfProtectedMethod('POST'), true);
  assert.equal(isCsrfProtectedMethod('PUT'), true);
  assert.equal(isCsrfProtectedMethod('DELETE'), true);
  assert.equal(isCsrfExemptPath('/api/forgot-password'), true);
  assert.equal(isCsrfExemptPath('/login'), true);
  assert.equal(isPublicApiPath('/forgot-password'), true);
  assert.equal(isPublicApiPath('/reset-password'), true);
  assert.equal(isPublicApiPath('/projects'), false);
});
