'use strict';

const ROLE_PERMISSIONS = Object.freeze({
  super_admin: Object.freeze({
    dashboard: true,
    projects: true,
    finance: true,
    company_registry: true,
    user_management: true,
    system_logs: true,
    exports: true,
    admin_tools: true
  }),
  admin: Object.freeze({
    dashboard: true,
    projects: true,
    finance: true,
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
    company_registry: true,
    user_management: false,
    system_logs: false,
    exports: true,
    admin_tools: false
  }),
  user: Object.freeze({
    dashboard: true,
    projects: false,
    finance: false,
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
  '/api/register/send-verification',
  '/api/forgot-password',
  '/api/reset-password',
  '/healthz'
]);
const PUBLIC_API_PATHS = new Set([
  '/register/send-verification',
  '/forgot-password',
  '/reset-password',
  '/public-business-entities'
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
  cookieName = 'kinaadman.sid',
  store = null,
  cookieSecure
} = {}) {
  if (!sessionSecret) {
    throw new Error('SESSION_SECRET is required.');
  }

  const maxAge = Number(cookieMaxAgeMs);
  const secureCookie = cookieSecure === undefined
    ? Boolean(isProduction)
    : Boolean(cookieSecure);

  const options = {
    name: cookieName,
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    unset: 'destroy',
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: secureCookie,
      path: '/',
      maxAge: Number.isFinite(maxAge) && maxAge > 0 ? maxAge : 24 * 60 * 60 * 1000
    }
  };

  if (store) {
    options.store = store;
  }

  return options;
}

function shouldSeedDefaultAdmin({ isProduction, enabled = true } = {}) {
  return !isProduction && enabled !== false;
}

function isCsrfProtectedMethod(method) {
  return CSRF_PROTECTED_METHODS.has(String(method || '').toUpperCase());
}

function isCsrfExemptPath(pathname) {
  const p = String(pathname || '').trim();
  // /api/public/* are token-authenticated, session-less endpoints (e.g. the vendor
  // RFQ portal) — they carry no CSRF cookie/session, so exempt them by prefix.
  return CSRF_EXEMPT_PATHS.has(p) || p.startsWith('/api/public/');
}

function isPublicApiPath(pathname) {
  // Inside the app.use('/api', ...) guard the mount prefix is stripped, so the
  // public RFQ portal endpoints arrive here as '/public/...'.
  const p = String(pathname || '').trim();
  return PUBLIC_API_PATHS.has(p) || p.startsWith('/public/');
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
