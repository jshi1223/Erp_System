'use strict';

const ROLE_PERMISSIONS = Object.freeze({
  admin: Object.freeze({
    dashboard: true,
    projects: true,
    finance: true,
    procurement: true,
    inventory: true,
    company_registry: true,
    user_management: true,
    system_logs: true,
    exports: true,
    admin_tools: true
  }),
  staff: Object.freeze({
    dashboard: true,
    projects: true,
    finance: true,
    procurement: true,
    inventory: true,
    company_registry: false,
    user_management: false,
    system_logs: false,
    exports: true,
    admin_tools: false
  }),
  user: Object.freeze({
    dashboard: true,
    projects: false,
    finance: false,
    procurement: false,
    inventory: false,
    company_registry: false,
    user_management: false,
    system_logs: false,
    exports: false,
    admin_tools: false
  })
});

const CSRF_PROTECTED_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const CSRF_EXEMPT_PATHS = new Set([
  '/login',
  '/register',
  '/api/forgot-password',
  '/api/reset-password',
  '/healthz'
]);
const PUBLIC_API_PATHS = new Set([
  '/forgot-password',
  '/reset-password'
]);

function normalizeRole(role) {
  const safeRole = String(role || 'user').trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(ROLE_PERMISSIONS, safeRole) ? safeRole : 'user';
}

function getRolePermissions(role) {
  return { ...ROLE_PERMISSIONS[normalizeRole(role)] };
}

function buildSessionOptions({
  isProduction,
  sessionSecret,
  cookieMaxAgeMs = 24 * 60 * 60 * 1000,
  cookieName = 'kinaadman.sid'
} = {}) {
  if (!sessionSecret) {
    throw new Error('SESSION_SECRET is required.');
  }

  const maxAge = Number(cookieMaxAgeMs);

  return {
    name: cookieName,
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    unset: 'destroy',
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: Boolean(isProduction),
      path: '/',
      maxAge: Number.isFinite(maxAge) && maxAge > 0 ? maxAge : 24 * 60 * 60 * 1000
    }
  };
}

function shouldSeedDefaultAdmin({ isProduction, enabled } = {}) {
  if (isProduction) return false;
  if (enabled === undefined) return true;
  return Boolean(enabled);
}

function isCsrfProtectedMethod(method) {
  return CSRF_PROTECTED_METHODS.has(String(method || '').toUpperCase());
}

function isCsrfExemptPath(pathname) {
  return CSRF_EXEMPT_PATHS.has(String(pathname || '').trim());
}

function isPublicApiPath(pathname) {
  return PUBLIC_API_PATHS.has(String(pathname || '').trim());
}

module.exports = {
  getRolePermissions,
  buildSessionOptions,
  shouldSeedDefaultAdmin,
  isCsrfProtectedMethod,
  isCsrfExemptPath,
  isPublicApiPath,
  normalizeRole
};
