// Authentication/authorization: current-user resolution, role helpers, and the route
// guards (protectAdmin, protectSuperAdmin, etc.). Pure with respect to the DB — operates
// on req.session / req.authUser only.
// Extracted from server.js (step 3 of the backend modularization — see src/ARCHITECTURE.md).

function getAuthenticatedUser(req) {
  return req.session?.user || req.authUser || null;
}

function hasBearerAuth(req) {
  return Boolean(req.authType === 'bearer' && req.authUser);
}

function normalizeAccessRole(role) {
  const safeRole = String(role || 'user').trim().toLowerCase();
  return ['super_admin', 'admin', 'staff', 'user'].includes(safeRole) ? safeRole : 'user';
}

function formatAccessRoleLabel(role) {
  return normalizeAccessRole(role)
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function isSuperAdminRole(role) {
  return normalizeAccessRole(role) === 'super_admin';
}

function isAdminRole(role) {
  return ['super_admin', 'admin'].includes(normalizeAccessRole(role));
}

function isPrivilegedRole(role) {
  return ['super_admin', 'admin', 'staff'].includes(normalizeAccessRole(role));
}

function isStaffRole(role) {
  return normalizeAccessRole(role) === 'staff';
}

function isApiRequest(req) {
  return req.path.startsWith('/api/');
}

function rejectUnauthorized(req, res) {
  if (isApiRequest(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  return res.redirect('/');
}

function protectAuthenticated(req, res, next) {
  if (getAuthenticatedUser(req)) {
    return next();
  }
  return rejectUnauthorized(req, res);
}

function protectAdmin(req, res, next) {
  const user = getAuthenticatedUser(req);
  if (user && isPrivilegedRole(user.role)) {
    return next();
  }
  return rejectUnauthorized(req, res);
}

function protectAdminOnly(req, res, next) {
  const user = getAuthenticatedUser(req);
  if (user && isAdminRole(user.role)) {
    return next();
  }

  if (isApiRequest(req)) {
    return res.status(403).json({ error: 'Access denied' });
  }
  return rejectUnauthorized(req, res);
}

function protectStaffOnly(req, res, next) {
  const user = getAuthenticatedUser(req);
  if (user && isStaffRole(user.role)) {
    return next();
  }

  if (isApiRequest(req)) {
    return res.status(403).json({ error: 'Staff access required' });
  }
  return rejectUnauthorized(req, res);
}

function protectSuperAdmin(req, res, next) {
  const user = getAuthenticatedUser(req);
  if (user && isSuperAdminRole(user.role)) {
    return next();
  }

  if (isApiRequest(req)) {
    return res.status(403).json({ error: 'Super admin access required' });
  }
  return rejectUnauthorized(req, res);
}

module.exports = {
  getAuthenticatedUser,
  hasBearerAuth,
  normalizeAccessRole,
  formatAccessRoleLabel,
  isSuperAdminRole,
  isAdminRole,
  isPrivilegedRole,
  isStaffRole,
  isApiRequest,
  rejectUnauthorized,
  protectAuthenticated,
  protectAdmin,
  protectAdminOnly,
  protectStaffOnly,
  protectSuperAdmin,
};
