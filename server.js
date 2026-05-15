// server.js - Updated with Session, CRUD, Double Login Fix, and Connection Pool
const express = require('express');
const path    = require('path');
const mysql   = require('mysql2');
const session = require('express-session');
const bcrypt  = require('bcrypt');
const multer  = require('multer');
const fs      = require('fs');
const crypto  = require('crypto');
const os      = require('os');
const { execFileSync } = require('child_process');
const nodemailer = require('nodemailer');
const {
  buildSessionOptions,
  getRolePermissions,
  isCsrfProtectedMethod,
  isCsrfExemptPath,
  isPublicApiPath,
  shouldSeedDefaultAdmin
} = require('./lib/erp-security');
const {
  normalizeTransactionStatusValue,
  mapTransactionToReceivableStatus,
  calculateReceivableStatus,
  mapReceivableToTransactionStatus,
  normalizeReceivableStatusValue,
  calculatePayableStatus
} = require('./lib/erp-flow');
const app     = express();
const PORT    = Number(process.env.PORT || 3000);

function loadEnvFile() {
  const envPath = path.join(__dirname, '.env');
  if (!fs.existsSync(envPath)) return;

  const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const separatorIndex = line.indexOf('=');
    if (separatorIndex === -1) continue;

    const key = line.slice(0, separatorIndex).trim();
    if (!key) continue;

    let value = line.slice(separatorIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

loadEnvFile();

const isProduction = process.env.NODE_ENV === 'production';
const sessionSecret = process.env.SESSION_SECRET || (
  isProduction ? '' : crypto.randomBytes(48).toString('hex')
);
const jwtSecret = process.env.JWT_SECRET || sessionSecret;
const jwtExpiresInSeconds = Number(process.env.JWT_EXPIRES_IN_SECONDS || 15 * 60);
const allowLegacyPlaintextPasswords = !isProduction && String(process.env.ALLOW_LEGACY_PLAINTEXT_PASSWORDS || 'true').toLowerCase() !== 'false';

if (isProduction && !process.env.SESSION_SECRET) {
  throw new Error('SESSION_SECRET is required in production.');
}

if (isProduction && !process.env.JWT_SECRET) {
  throw new Error('JWT_SECRET is required in production.');
}

// ==================== EMAIL CONFIG ====================
const APP_BASE_URL = process.env.APP_BASE_URL || `http://localhost:${PORT}`;
const allowedRequestOrigins = new Set();
try {
  allowedRequestOrigins.add(new URL(APP_BASE_URL).origin);
} catch (_) {}
allowedRequestOrigins.add(`http://localhost:${PORT}`);
allowedRequestOrigins.add(`http://127.0.0.1:${PORT}`);
allowedRequestOrigins.add(`http://[::1]:${PORT}`);
const MYSQL_HOST = process.env.MYSQL_HOST || 'localhost';
const MYSQL_USER = process.env.MYSQL_USER || 'root';
const MYSQL_PASSWORD = process.env.MYSQL_PASSWORD || '';
const MYSQL_DATABASE = process.env.MYSQL_DATABASE || 'kinaadman';
const SMTP_HOST = process.env.SMTP_HOST || '';
const SMTP_PORT = Number(process.env.SMTP_PORT || 587);
const SMTP_SECURE = String(process.env.SMTP_SECURE || 'false').toLowerCase() === 'true';
const SMTP_USER = process.env.SMTP_USER || '';
const SMTP_PASS = process.env.SMTP_PASS || '';
const SMTP_FROM = process.env.SMTP_FROM || SMTP_USER || 'no-reply@kinaadman.local';
const allowPublicRegistration = !isProduction || String(process.env.ALLOW_PUBLIC_REGISTRATION || 'false').toLowerCase() === 'true';

const hasEmailConfig = Boolean(SMTP_HOST && SMTP_USER && SMTP_PASS);
const transporter = hasEmailConfig
  ? nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_SECURE,
      auth: {
        user: SMTP_USER,
        pass: SMTP_PASS
      }
    })
  : null;

// ==================== PDF UPLOAD CONFIG ====================
const UPLOAD_DIR = path.join(__dirname, 'uploads_pdf');
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const uniqueName = `${Date.now()}-${Math.round(Math.random() * 1e9)}.pdf`;
    cb(null, uniqueName);
  }
});

const upload = multer({ 
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Only PDF files allowed'), false);
    }
  }
});

const ganttImportUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 }
});

// Middleware
app.disable('x-powered-by');
app.set('trust proxy', isProduction ? 1 : 0);
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  next();
});
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static('public', {
  setHeaders: (res, filePath) => {
    const normalizedPath = String(filePath || '').toLowerCase();
    if (/\.(html|css|js)$/.test(normalizedPath)) {
      noCache(res);
    }
  }
}));

function getClientIp(req) {
  const forwardedFor = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return forwardedFor || req.ip || req.socket?.remoteAddress || 'unknown';
}

function base64UrlEncode(value) {
  return Buffer.from(value)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function base64UrlDecode(value) {
  const normalized = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), '=');
  return Buffer.from(padded, 'base64').toString('utf8');
}

function safeJsonParse(value) {
  try {
    return JSON.parse(value);
  } catch (_) {
    return null;
  }
}

function timingSafeStringEqual(left, right) {
  const leftBuffer = Buffer.from(String(left || ''));
  const rightBuffer = Buffer.from(String(right || ''));
  if (leftBuffer.length !== rightBuffer.length) return false;
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function signJwtPayload(payload, expiresInSeconds = jwtExpiresInSeconds) {
  const now = Math.floor(Date.now() / 1000);
  const safeExpires = Number.isFinite(Number(expiresInSeconds)) && Number(expiresInSeconds) > 0
    ? Number(expiresInSeconds)
    : 15 * 60;
  const header = { alg: 'HS256', typ: 'JWT' };
  const body = {
    ...payload,
    iss: 'kinaadman-erp',
    iat: now,
    exp: now + safeExpires
  };
  const signingInput = `${base64UrlEncode(JSON.stringify(header))}.${base64UrlEncode(JSON.stringify(body))}`;
  const signature = crypto
    .createHmac('sha256', jwtSecret)
    .update(signingInput)
    .digest('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
  return `${signingInput}.${signature}`;
}

function verifyJwtToken(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) return null;

  const [encodedHeader, encodedPayload, signature] = parts;
  const header = safeJsonParse(base64UrlDecode(encodedHeader));
  const payload = safeJsonParse(base64UrlDecode(encodedPayload));
  if (!header || header.alg !== 'HS256' || !payload) return null;

  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const expectedSignature = crypto
    .createHmac('sha256', jwtSecret)
    .update(signingInput)
    .digest('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');

  if (!timingSafeStringEqual(signature, expectedSignature)) return null;

  const now = Math.floor(Date.now() / 1000);
  if (!payload.exp || Number(payload.exp) <= now) return null;
  if (payload.iss !== 'kinaadman-erp') return null;

  return payload;
}

function getBearerToken(req) {
  const header = String(req.headers.authorization || '').trim();
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : '';
}

function attachBearerAuth(req, res, next) {
  const token = getBearerToken(req);
  if (!token) return next();

  const payload = verifyJwtToken(token);
  if (payload) {
    req.authUser = {
      id: Number(payload.sub || payload.id || 0) || null,
      username: String(payload.username || ''),
      role: String(payload.role || 'user'),
      fullname: String(payload.fullname || '')
    };
    req.authType = 'bearer';
  }

  next();
}

function getAuthenticatedUser(req) {
  return req.session?.user || req.authUser || null;
}

function hasBearerAuth(req) {
  return Boolean(req.authType === 'bearer' && req.authUser);
}

function hashResetToken(token) {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex');
}

function formatNotificationDate(value) {
  if (!value) return 'Unknown date';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString('en-PH', {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  });
}

function capitalizeProjectStatus(value) {
  return String(value || 'pending')
    .replace(/[_-]+/g, ' ')
    .trim()
    .replace(/\b\w/g, (ch) => ch.toUpperCase());
}

function decodePdfLiteralString(value) {
  return String(value || '')
    .replace(/\\([\\()nrtbf])/g, (match, escaped) => {
      switch (escaped) {
        case '\\': return '\\';
        case '(': return '(';
        case ')': return ')';
        case 'n': return '\n';
        case 'r': return '\r';
        case 't': return '\t';
        case 'b': return '\b';
        case 'f': return '\f';
        default: return escaped;
      }
    })
    .replace(/\\([0-7]{1,3})/g, (_, octal) => String.fromCharCode(parseInt(octal, 8)))
    .replace(/\r\n?/g, '\n');
}

function decodePdfHexString(value) {
  const hex = String(value || '').replace(/\s+/g, '');
  if (!hex) return '';
  const bytes = [];
  for (let i = 0; i < hex.length; i += 2) {
    const chunk = hex.slice(i, i + 2);
    if (chunk.length === 2) {
      const byte = parseInt(chunk, 16);
      if (!Number.isNaN(byte)) bytes.push(byte);
    }
  }
  return Buffer.from(bytes).toString('utf8').replace(/\r\n?/g, '\n');
}

function extractPdfTextFromBuffer(buffer) {
  const raw = Buffer.isBuffer(buffer) ? buffer.toString('latin1') : String(buffer || '');
  const matches = [];
  const pattern = /\(((?:\\.|[^()\\])*)\)|<([0-9A-Fa-f\s]{2,})>/g;
  let match;

  while ((match = pattern.exec(raw)) !== null) {
    const literal = match[1] != null ? decodePdfLiteralString(match[1]) : decodePdfHexString(match[2]);
    const text = String(literal || '').trim();
    if (text) matches.push(text);
  }

  return matches.join('\n');
}

function isLikelyPdfGarbageLine(line) {
  const value = String(line || '').trim();
  if (!value) return true;
  if (/^(<<|>>|obj|endobj|stream|endstream|xref|trailer)\b/i.test(value)) return true;
  if (/\/(Filter|FlateDecode|Length|Type|Subtype|Root|Pages|Catalog|Page|Font)\b/i.test(value)) return true;
  if (value.includes('<<') || value.includes('>>')) return true;
  const visibleChars = value.replace(/[\s\W_]+/g, '');
  return visibleChars.length === 0;
}

function parseDelimitedRowsFromText(text) {
  const source = String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = source.split('\n').map(line => line.trim()).filter(Boolean);
  if (!lines.length) return [];

  const rows = [];
  lines.forEach((line) => {
    if (isLikelyPdfGarbageLine(line)) return;

    let cells = [];
    if (line.includes('|')) {
      cells = line.split('|').map(cell => cell.trim()).filter(Boolean);
    } else if (line.includes('\t')) {
      cells = line.split('\t').map(cell => cell.trim()).filter(Boolean);
    } else {
      cells = line.split(/\s{2,}/).map(cell => cell.trim()).filter(Boolean);
    }

    if (cells.length <= 1) {
      const dateMatches = (line.match(/\b\d{4}-\d{1,2}-\d{1,2}\b/g) || line.match(/\b\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}\b/g) || []).filter((dateText) => {
        const parsed = new Date(dateText);
        return !Number.isNaN(parsed.getTime()) && parsed.getFullYear() >= 1900 && parsed.getFullYear() <= 2100;
      });
      if (dateMatches.length >= 2) {
        const [firstDate, secondDate] = dateMatches;
        const task = line.replace(firstDate, '').replace(secondDate, '').replace(/\s{2,}/g, ' ').trim();
        cells = task ? [task, firstDate, secondDate] : [line, firstDate, secondDate];
      }
    }

    if (cells.length) {
      rows.push(cells);
    }
  });

  return rows;
}

function readXlsxSheetRows(filePath) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kinaadman-xlsx-'));
  try {
    const safeArchive = filePath.replace(/'/g, "''");
    const safeDest = tempDir.replace(/'/g, "''");
    execFileSync('powershell.exe', [
      '-NoProfile',
      '-Command',
      `Expand-Archive -LiteralPath '${safeArchive}' -DestinationPath '${safeDest}' -Force`
    ], { stdio: 'ignore' });

    const sharedStringsPath = path.join(tempDir, 'xl', 'sharedStrings.xml');
    const sheetDir = path.join(tempDir, 'xl', 'worksheets');
    const sheetFiles = fs.existsSync(sheetDir)
      ? fs.readdirSync(sheetDir).filter(name => /^sheet\d+\.xml$/i.test(name)).sort()
      : [];
    const sheetPath = sheetFiles.length ? path.join(sheetDir, sheetFiles[0]) : null;

    if (!sheetPath || !fs.existsSync(sheetPath)) return [];

    const sharedStrings = [];
    if (fs.existsSync(sharedStringsPath)) {
      const sharedXml = fs.readFileSync(sharedStringsPath, 'utf8');
      const sharedMatches = sharedXml.match(/<si[\s\S]*?<\/si>/g) || [];
      sharedMatches.forEach((entry) => {
        const texts = Array.from(entry.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)).map((m) => String(m[1] || ''));
        sharedStrings.push(texts.join(''));
      });
    }

    const sheetXml = fs.readFileSync(sheetPath, 'utf8');
    const rowMatches = sheetXml.match(/<row[\s\S]*?<\/row>/g) || [];
    const rows = [];

    rowMatches.forEach((rowXml) => {
      const cells = [];
      const cellMatches = Array.from(rowXml.matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g));

      cellMatches.forEach((cellMatch) => {
        const attrs = String(cellMatch[1] || '');
        const content = String(cellMatch[2] || '');
        const refMatch = attrs.match(/\br="([A-Z]+)\d+"/i);
        const typeMatch = attrs.match(/\bt="([^"]+)"/i);
        const ref = refMatch ? refMatch[1].toUpperCase() : '';
        const columnIndex = ref ? columnLettersToIndex(ref) : cells.length;
        let value = '';

        if (typeMatch && typeMatch[1] === 's') {
          const sharedIndexMatch = content.match(/<v>([\s\S]*?)<\/v>/);
          const sharedIndex = Number(sharedIndexMatch?.[1] || 0);
          value = sharedStrings[sharedIndex] || '';
        } else if (typeMatch && typeMatch[1] === 'inlineStr') {
          const inlineMatch = content.match(/<t[^>]*>([\s\S]*?)<\/t>/);
          value = inlineMatch ? inlineMatch[1] : '';
        } else {
          const valueMatch = content.match(/<v>([\s\S]*?)<\/v>/);
          value = valueMatch ? valueMatch[1] : '';
        }

        cells[columnIndex] = String(value || '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
      });

      const cleaned = cells.map(cell => String(cell || '').trim());
      if (cleaned.some(Boolean)) {
        rows.push(cleaned);
      }
    });

    return rows;
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

function columnLettersToIndex(ref) {
  let result = 0;
  for (const ch of String(ref || '').toUpperCase()) {
    if (ch < 'A' || ch > 'Z') continue;
    result = result * 26 + (ch.charCodeAt(0) - 64);
  }
  return Math.max(0, result - 1);
}

function createRateLimiter({ windowMs, max, keyPrefix, keyGenerator, message, skip }) {
  const hits = new Map();

  const cleanup = () => {
    const now = Date.now();
    for (const [key, entry] of hits.entries()) {
      if (!entry || entry.resetAt <= now) {
        hits.delete(key);
      }
    }
  };

  const cleanupTimer = setInterval(cleanup, Math.max(windowMs, 60 * 1000));
  if (typeof cleanupTimer.unref === 'function') cleanupTimer.unref();

  return (req, res, next) => {
    if (typeof skip === 'function' && skip(req)) {
      return next();
    }

    const now = Date.now();
    const rawKey = keyGenerator ? keyGenerator(req) : getClientIp(req);
    const finalKey = `${keyPrefix}:${String(rawKey || 'unknown').toLowerCase()}`;

    let entry = hits.get(finalKey);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs };
      hits.set(finalKey, entry);
    }

    entry.count += 1;

    const remaining = Math.max(0, max - entry.count);
    res.setHeader('X-RateLimit-Limit', String(max));
    res.setHeader('X-RateLimit-Remaining', String(remaining));
    res.setHeader('X-RateLimit-Reset', String(Math.ceil(entry.resetAt / 1000)));

    if (entry.count > max) {
      const retryAfter = Math.max(1, Math.ceil((entry.resetAt - now) / 1000));
      res.setHeader('Retry-After', String(retryAfter));
      return res.status(429).json({
        status: 'error',
        message: message || 'Too many requests. Please try again later.'
      });
    }

    next();
  };
}

const loginAttemptState = new Map();
const LOGIN_FAILURE_LIMIT = 3;
const LOGIN_COOLDOWN_STAGES = [60 * 1000, 5 * 60 * 1000, 15 * 60 * 1000, 30 * 60 * 1000];
const LOGIN_STATE_TTL = 6 * 60 * 60 * 1000;

const loginStateCleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of loginAttemptState.entries()) {
    if (!entry) {
      loginAttemptState.delete(key);
      continue;
    }

    const stale = !entry.updatedAt || (now - entry.updatedAt) > LOGIN_STATE_TTL;
    const expired = !entry.lockUntil || entry.lockUntil <= now;
    if (stale && expired) {
      loginAttemptState.delete(key);
    }
  }
}, 60 * 1000);
if (typeof loginStateCleanupTimer.unref === 'function') loginStateCleanupTimer.unref();

function getLoginThrottleKey(req, username) {
  const safeUsername = String(username || '').trim().toLowerCase() || 'unknown';
  return `login:${safeUsername}:${getClientIp(req).toLowerCase()}`;
}

function getLoginThrottleEntry(req, username) {
  const key = getLoginThrottleKey(req, username);
  const now = Date.now();
  let entry = loginAttemptState.get(key);

  if (!entry) {
    entry = {
      failures: 0,
      cooldownStage: 0,
      lockUntil: 0,
      updatedAt: now
    };
    loginAttemptState.set(key, entry);
    return { key, entry, now };
  }

  if (entry.lockUntil && entry.lockUntil <= now) {
    entry.lockUntil = 0;
    entry.failures = 0;
    entry.updatedAt = now;
  }

  return { key, entry, now };
}

function getLoginCooldownRemaining(req, username) {
  const { entry, now } = getLoginThrottleEntry(req, username);
  if (!entry.lockUntil || entry.lockUntil <= now) return 0;
  return Math.max(1, Math.ceil((entry.lockUntil - now) / 1000));
}

function registerLoginFailure(req, username) {
  const { key, entry, now } = getLoginThrottleEntry(req, username);
  entry.failures += 1;
  entry.updatedAt = now;

  if (entry.failures < LOGIN_FAILURE_LIMIT) {
    loginAttemptState.set(key, entry);
    return { locked: false, retryAfter: 0 };
  }

  const stageIndex = Math.min(entry.cooldownStage || 0, LOGIN_COOLDOWN_STAGES.length - 1);
  const cooldownMs = LOGIN_COOLDOWN_STAGES[stageIndex];
  entry.lockUntil = now + cooldownMs;
  entry.cooldownStage = Math.min(stageIndex + 1, LOGIN_COOLDOWN_STAGES.length - 1);
  entry.failures = 0;
  entry.updatedAt = now;
  loginAttemptState.set(key, entry);

  return {
    locked: true,
    retryAfter: Math.max(1, Math.ceil(cooldownMs / 1000))
  };
}

function clearLoginThrottle(req, username) {
  loginAttemptState.delete(getLoginThrottleKey(req, username));
}

const loginRateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 10,
  keyPrefix: 'login',
  keyGenerator: (req) => {
    const username = String(req.body?.username || '').trim().toLowerCase();
    return username || `ip:${getClientIp(req)}`;
  },
  message: 'Masyadong maraming login attempts. Subukan ulit pagkatapos ng ilang minuto.'
});

const forgotPasswordRateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 5,
  keyPrefix: 'forgot-password',
  keyGenerator: (req) => `${getClientIp(req)}:${String(req.body?.email || '').trim().toLowerCase() || 'unknown'}`,
  message: 'Masyadong maraming forgot password requests. Subukan ulit mamaya.'
});

const resetPasswordRateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 6,
  keyPrefix: 'reset-password',
  keyGenerator: (req) => `${getClientIp(req)}:${String(req.body?.token || '').trim().toLowerCase() || 'unknown'}`,
  message: 'Masyadong maraming reset attempts. Subukan ulit mamaya.'
});

const registerRateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 5,
  keyPrefix: 'register',
  keyGenerator: (req) => `${getClientIp(req)}:${String(req.body?.email || '').trim().toLowerCase() || 'unknown'}`,
  message: 'Masyadong maraming registration attempts. Subukan ulit mamaya.'
});

const apiBurstRateLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 900,
  keyPrefix: 'api-burst',
  keyGenerator: (req) => getClientIp(req),
  message: 'Masyadong maraming API requests. Dahan-dahan lang muna.',
  skip: (req) => ['GET', 'HEAD', 'OPTIONS'].includes(String(req.method || '').toUpperCase()) || req.path === '/me'
});

app.disable('x-powered-by');
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-DNS-Prefetch-Control', 'off');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), interest-cohort=()');
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'self'",
      "img-src 'self' data: https:",
      "font-src 'self' https://fonts.gstatic.com",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "script-src 'self' 'unsafe-inline'",
      "connect-src 'self'",
      "object-src 'none'"
    ].join('; ')
  );
  if (isProduction) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
});

app.use((req, res, next) => {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
    return next();
  }

  const requestOrigin = String(req.headers.origin || '').trim();
  const referer = String(req.headers.referer || '').trim();
  const refererOrigin = (() => {
    if (!referer) return '';
    try {
      return new URL(referer).origin;
    } catch (_) {
      return '';
    }
  })();

  const effectiveOrigin = requestOrigin || refererOrigin;
  const hostHeader = String(req.headers.host || '').trim();
  const hostOrigin = hostHeader ? `${req.protocol}://${hostHeader}` : '';
  const originAllowed =
    !effectiveOrigin ||
    effectiveOrigin === hostOrigin ||
    allowedRequestOrigins.has(effectiveOrigin);

  if (!originAllowed) {
    return res.status(403).json({ status: 'error', message: 'Blocked by same-origin protection.' });
  }

  next();
});

app.use('/api', apiBurstRateLimiter);


// SESSION SETUP
const sessionMaxAgeMs = Number(process.env.SESSION_MAX_AGE_MS || 24 * 60 * 60 * 1000);
app.use(session(buildSessionOptions({
  isProduction,
  sessionSecret,
  cookieMaxAgeMs: sessionMaxAgeMs
})));

app.use(attachBearerAuth);

app.use('/api', (req, res, next) => {
  if (req.method === 'OPTIONS' || isPublicApiPath(req.path)) {
    return next();
  }
  if (getAuthenticatedUser(req)) {
    return next();
  }
  return res.status(401).json({ status: 'error', message: 'Authentication required.' });
});

function ensureSessionCsrfToken(req) {
  if (!req.session) return '';
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(32).toString('hex');
  }
  return req.session.csrfToken;
}

app.use((req, res, next) => {
  if (!isCsrfProtectedMethod(req.method)) {
    return next();
  }

  if (isCsrfExemptPath(req.path)) {
    return next();
  }

  if (req.path === '/logout') {
    if (hasBearerAuth(req)) return next();
    const sessionToken = String(req.session?.csrfToken || '').trim();
    const headerToken = String(req.headers['x-csrf-token'] || '').trim();
    if (!req.session?.user || !sessionToken || !headerToken || sessionToken !== headerToken) {
      return res.status(403).json({ status: 'error', message: 'Invalid security token.' });
    }
    return next();
  }

  if (!req.path.startsWith('/api/')) {
    return next();
  }

  if (hasBearerAuth(req)) {
    return next();
  }

  const sessionToken = String(req.session?.csrfToken || '').trim();
  const headerToken = String(req.headers['x-csrf-token'] || '').trim();
  if (!req.session?.user || !sessionToken || !headerToken || sessionToken !== headerToken) {
    return res.status(403).json({ status: 'error', message: 'Invalid security token.' });
  }

  next();
});

// ==================== MySQL Bootstrap ====================
const bootstrap = mysql.createConnection({
  host: MYSQL_HOST,
  user: MYSQL_USER,
  password: MYSQL_PASSWORD
});

bootstrap.connect((err) => {
  if (err) { console.error('âŒ MySQL Connection Failed:', err.message); process.exit(1); }
  console.log('âœ… Connected to MySQL (XAMPP)');

  bootstrap.query(`CREATE DATABASE IF NOT EXISTS \`${MYSQL_DATABASE}\``, (err) => {
    if (err) { console.error('âŒ Could not create database:', err.message); process.exit(1); }
    console.log('âœ… Database "kinaadman" is ready');
    bootstrap.end();
    initApp();
  });
});

// ==================== CONNECTION POOL ====================
let db;

function initApp() {
  db = mysql.createPool({
    host: MYSQL_HOST,
    user: MYSQL_USER,
    password: MYSQL_PASSWORD,
    database: MYSQL_DATABASE,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
  });

  console.log('âœ… MySQL Connection Pool created');

  function addIndexIfMissing(sql, label) {
    db.query(sql, (err) => {
      if (!err) {
        console.log(`âœ… ${label} ready`);
        return;
      }
      if (/Duplicate key name/i.test(String(err.message || ''))) {
        return;
      }
      console.error(`${label} index error:`, err);
    });
  }

  function backfillTransactionProjectDates() {
    db.query(`
      UPDATE transactions t
      JOIN projects p ON p.transaction_id = t.id
      SET
        t.project_start_date = COALESCE(t.project_start_date, p.planned_start_date, p.start_date),
        t.project_end_date = COALESCE(t.project_end_date, p.planned_end_date, p.end_date)
      WHERE t.project_start_date IS NULL OR t.project_end_date IS NULL
    `, (err) => {
      if (err) console.error('Project date backfill error:', err);
    });
  }

  function backfillProjectTimelineFields() {
  db.query(`
      UPDATE projects
      SET
        planned_start_date = COALESCE(planned_start_date, start_date),
        planned_end_date = COALESCE(planned_end_date, end_date)
    `, (err) => {
      if (err) console.error('Project timeline backfill error:', err);
      else backfillTransactionProjectDates();
    });
  }

  // Create tables
  db.query(`
    CREATE TABLE IF NOT EXISTS business_entities (
      id          INT           AUTO_INCREMENT PRIMARY KEY,
      entity_code VARCHAR(20)   NOT NULL UNIQUE,
      company_name VARCHAR(255) NOT NULL UNIQUE,
      address     TEXT,
      contact_person VARCHAR(255),
      phone       VARCHAR(50),
      email       VARCHAR(255),
      tin         VARCHAR(50),
      status      ENUM('active','inactive') NOT NULL DEFAULT 'active',
      is_default  BOOLEAN       NOT NULL DEFAULT 0,
      created_at  TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `, (err) => {
    if (err) console.error('Business entities table error:', err);
    else {
      console.log('✅ Table "business_entities" ready');
      db.query(`
        INSERT IGNORE INTO business_entities (entity_code, company_name, status, is_default)
        VALUES
          ('ENT-001', 'KVSK CCTV & IT Solution', 'active', 1),
          ('ENT-002', 'KITSI', 'active', 0)
      `, (seedErr) => {
        if (seedErr) console.error('Default business entity seed error:', seedErr);
        db.query(`
          UPDATE business_entities
          SET is_default = CASE WHEN entity_code = 'ENT-001' THEN 1 ELSE is_default END
          WHERE entity_code = 'ENT-001' OR is_default = 1
        `, (defaultErr) => {
          if (defaultErr) console.error('Default business entity flag error:', defaultErr);
        });
      });
    }
  });

  db.query(`
    CREATE TABLE IF NOT EXISTS transactions (
  id          INT           AUTO_INCREMENT PRIMARY KEY,
  docno       VARCHAR(20)   NOT NULL UNIQUE,
  type        ENUM('receipt','invoice') NOT NULL,
  client      VARCHAR(255)  NOT NULL,
  address     TEXT,
  tin         VARCHAR(20),
  bizstyle    VARCHAR(100),
  phone       VARCHAR(20),
  description TEXT,
  archived    BOOLEAN       DEFAULT 0,
  archived_auto BOOLEAN     DEFAULT 0,
  qty         INT           NOT NULL DEFAULT 1,
  unitprice   DECIMAL(12,2),
  amount      DECIMAL(12,2) NOT NULL,
  downpayment DECIMAL(12,2) NOT NULL DEFAULT 0,
  business_entity_id INT NULL,
  project_id  INT NULL,
  company_id  INT NULL,
  project_tx_no INT NULL,
  checkno     VARCHAR(100),
  pono        VARCHAR(100),
  date        DATE          NOT NULL,
  status      ENUM('paid','unpaid','partial') NOT NULL DEFAULT 'unpaid',
  pdfFilename VARCHAR(255),                    -- Changed: filename only
  project_members VARCHAR(255),
  member_role     VARCHAR(50),
  member_phone    VARCHAR(20),
  project_members_2 VARCHAR(255),
  member_role_2     VARCHAR(50),
  member_phone_2    VARCHAR(20),
  project_members_3 VARCHAR(255),
  member_role_3     VARCHAR(50),
  member_phone_3    VARCHAR(20),
  created_at  TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP
)
    `, (err) => {
    if (err) console.error('Transactions table error:', err);
    else     console.log('âœ… Table "transactions" ready');
  });

  // Migration for pdfFilename (para sa existing old records)
  db.query(`
  ALTER TABLE transactions 
  ADD COLUMN IF NOT EXISTS pdfFilename VARCHAR(255)
  `, (err) => {
    if (err) console.error('pdfFilename migration error:', err);
    else     console.log('âœ… pdfFilename column is ready');
  });

  // Migration for project member details
  db.query(`ALTER TABLE transactions
    ADD COLUMN IF NOT EXISTS project_members VARCHAR(255),
    ADD COLUMN IF NOT EXISTS member_role VARCHAR(50),
    ADD COLUMN IF NOT EXISTS member_phone VARCHAR(20),
    ADD COLUMN IF NOT EXISTS project_members_2 VARCHAR(255),
    ADD COLUMN IF NOT EXISTS member_role_2 VARCHAR(50),
    ADD COLUMN IF NOT EXISTS member_phone_2 VARCHAR(20),
    ADD COLUMN IF NOT EXISTS project_members_3 VARCHAR(255),
    ADD COLUMN IF NOT EXISTS member_role_3 VARCHAR(50),
    ADD COLUMN IF NOT EXISTS member_phone_3 VARCHAR(20)
  `, (err) => {
    if (err) console.error('Member details migration error:', err);
  });

  db.query(`ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS transaction_id INT NULL`, (err) => {
    if (err) console.error('Stock movements transaction_id migration error:', err);
  });

  db.query(`ALTER TABLE transactions ADD COLUMN IF NOT EXISTS project_start_date DATE, ADD COLUMN IF NOT EXISTS project_end_date DATE`, (err) => {
    if (err) console.error('Project date migration error:', err);
  });

  db.query(`ALTER TABLE transactions ADD COLUMN IF NOT EXISTS project_id INT NULL`, (err) => {
    if (err) console.error('Transactions project_id migration error:', err);
  });
  db.query(`ALTER TABLE transactions ADD COLUMN IF NOT EXISTS business_entity_id INT NULL AFTER downpayment`, (err) => {
    if (err) console.error('Transactions business_entity_id migration error:', err);
  });
  db.query(`ALTER TABLE transactions ADD COLUMN IF NOT EXISTS company_id INT NULL AFTER project_id`, (err) => {
    if (err) console.error('Transactions company_id migration error:', err);
  });
  db.query(`ALTER TABLE transactions ADD COLUMN IF NOT EXISTS service_order_id INT NULL AFTER project_id`, (err) => {
    if (err) console.error('Transactions service_order_id migration error:', err);
  });
  db.query(`ALTER TABLE transactions ADD COLUMN IF NOT EXISTS project_tx_no INT NULL`, (err) => {
    if (err) console.error('Transactions project_tx_no migration error:', err);
  });
  db.query(`
    UPDATE transactions t
    JOIN projects p ON p.id = t.project_id
    SET t.company_id = COALESCE(t.company_id, p.company_id)
    WHERE COALESCE(t.company_id, 0) = 0 AND COALESCE(t.project_id, 0) > 0
  `, (err) => {
    if (err) console.error('Transactions company_id backfill from projects error:', err);
  });
  db.query(`
    UPDATE transactions t
    JOIN service_orders so ON so.id = t.service_order_id
    SET t.company_id = COALESCE(t.company_id, so.company_id)
    WHERE COALESCE(t.company_id, 0) = 0 AND COALESCE(t.service_order_id, 0) > 0
  `, (err) => {
    if (err) console.error('Transactions company_id backfill from service orders error:', err);
  });

  db.query(`ALTER TABLE transactions ADD COLUMN IF NOT EXISTS archived_auto BOOLEAN NOT NULL DEFAULT 0`, (err) => {
    if (err) console.error('Transactions archived_auto migration error:', err);
  });

  db.query(`
    CREATE TABLE IF NOT EXISTS users (
      id          INT           AUTO_INCREMENT PRIMARY KEY,
      username    VARCHAR(50)   NOT NULL UNIQUE,
      password    VARCHAR(255)  NOT NULL,
      email       VARCHAR(100)  NOT NULL UNIQUE,
      fullname    VARCHAR(100)  NOT NULL,
      role        ENUM('admin','staff','user') NOT NULL DEFAULT 'user',
      last_login  DATETIME      NULL,
      reset_token VARCHAR(255)  NULL,
      reset_token_expiry BIGINT NULL,
      created_at  TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
      active      BOOLEAN       NOT NULL DEFAULT 1
    )
  `, (err) => {
    if (err) console.error('Users table error:', err);
    else {
      console.log('âœ… Table "users" ready');

      const seedDefaultAdmin = process.env.SEED_DEFAULT_ADMIN === undefined
        ? !isProduction
        : String(process.env.SEED_DEFAULT_ADMIN || '').toLowerCase() === 'true';

      if (shouldSeedDefaultAdmin({ isProduction, enabled: seedDefaultAdmin })) {
        // Dev-only bootstrap account for local setup.
        bcrypt.hash('admin123', 10, (err, hash) => {
          if (err) { console.error('Bcrypt error:', err); return; }

          db.query(`
            INSERT IGNORE INTO users (username, password, email, fullname, role, active)
            VALUES ('admin', ?, 'admin@kinaadman.com', 'Administrator', 'admin', 1)
          `, [hash], (err) => {
            if (err) console.error('Default admin user error:', err);
            else     console.log('âœ… Default admin user ready â€” username: admin | password: admin123');
          });
        });
      } else {
        console.log('âœ… Default admin seed skipped for production hardening');
      }
    }
  });

  db.query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS last_login DATETIME NULL,
    ADD COLUMN IF NOT EXISTS reset_token VARCHAR(255) NULL,
    ADD COLUMN IF NOT EXISTS reset_token_expiry BIGINT NULL
  `, (err) => {
    if (err) console.error('Users reset token migration error:', err);
    else console.log('âœ… Users reset token columns are ready');
  });

  db.query(`
    CREATE TABLE IF NOT EXISTS products (
      id          INT           AUTO_INCREMENT PRIMARY KEY,
      sku         VARCHAR(50)   NOT NULL UNIQUE,
      name        VARCHAR(255)  NOT NULL,
      category    VARCHAR(100),
      description TEXT,
      unit_price  DECIMAL(12,2) NOT NULL,
      reorder_level INT         DEFAULT 10,
      is_active   BOOLEAN       DEFAULT TRUE,
      created_at  TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `, (err) => {
    if (err) console.error('Products table error:', err);
    else     console.log('âœ… Table "products" ready');
  });

  db.query(`
    CREATE TABLE IF NOT EXISTS warehouses (
      id          INT           AUTO_INCREMENT PRIMARY KEY,
      name        VARCHAR(100)  NOT NULL UNIQUE,
      location    VARCHAR(255),
      is_active   BOOLEAN       DEFAULT TRUE,
      created_at  TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `, (err) => {
    if (err) console.error('Warehouses table error:', err);
    else     console.log('âœ… Table "warehouses" ready');
  });

  db.query(`
    CREATE TABLE IF NOT EXISTS stock (
      id          INT           AUTO_INCREMENT PRIMARY KEY,
      product_id  INT           NOT NULL,
      warehouse_id INT          NOT NULL,
      quantity    INT           NOT NULL DEFAULT 0,
      last_updated TIMESTAMP    DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (product_id) REFERENCES products(id),
      FOREIGN KEY (warehouse_id) REFERENCES warehouses(id),
      UNIQUE KEY unique_stock (product_id, warehouse_id)
    )
  `, (err) => {
    if (err) console.error('Stock table error:', err);
    else     console.log('âœ… Table "stock" ready');
  });

  db.query(`
    CREATE TABLE IF NOT EXISTS stock_movements (
      id          INT           AUTO_INCREMENT PRIMARY KEY,
      product_id  INT           NOT NULL,
      warehouse_id INT          NOT NULL,
      movement_type ENUM('inbound','outbound','adjustment') NOT NULL,
      quantity    INT           NOT NULL,
      source_type ENUM('manual','purchase_requisition','purchase_order','goods_receipt','transaction') NOT NULL DEFAULT 'manual',
      reference_doc VARCHAR(100),
      transaction_id INT NULL,
      notes       TEXT,
      created_at  TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (product_id) REFERENCES products(id),
      FOREIGN KEY (warehouse_id) REFERENCES warehouses(id)
    )
  `, (err) => {
    if (err) console.error('Stock movements table error:', err);
    else     console.log('âœ… Table "stock_movements" ready');
  });
  db.query(`ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS source_type ENUM('manual','purchase_requisition','purchase_order','goods_receipt','transaction') NOT NULL DEFAULT 'manual' AFTER quantity`, (err) => {
    if (err) console.error('Stock movements source_type migration error:', err);
  });
  db.query(`ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS transaction_id INT NULL`, (err) => {
    if (err) console.error('Stock movements transaction_id migration error:', err);
  });
  db.query(`
    UPDATE stock_movements
    SET source_type = 'transaction'
    WHERE COALESCE(transaction_id, 0) > 0
      AND COALESCE(source_type, 'manual') = 'manual'
  `, (err) => {
    if (err) console.error('Stock movements source_type backfill error:', err);
  });

  db.query(`
    CREATE TABLE IF NOT EXISTS vendors (
      id          INT           AUTO_INCREMENT PRIMARY KEY,
      company_id  INT           NULL,
      business_entity_id INT    NULL,
      vendor_no   VARCHAR(20)   NULL UNIQUE,
      vendor_name VARCHAR(255)  NOT NULL,
      contact_person VARCHAR(100),
      email       VARCHAR(100),
      phone       VARCHAR(20),
      address     TEXT,
      tin         VARCHAR(20),
      is_active   BOOLEAN       DEFAULT TRUE,
      created_at  TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `, (err) => {
    if (err) console.error('Vendors table error:', err);
    else     console.log('âœ… Table "vendors" ready');
  });
  db.query(`ALTER TABLE vendors ADD COLUMN IF NOT EXISTS vendor_no VARCHAR(20) NULL AFTER id`, (err) => {
    if (err) console.error('Vendors vendor_no migration error:', err);
  });
  db.query(`ALTER TABLE vendors ADD COLUMN IF NOT EXISTS company_id INT NULL AFTER id`, (err) => {
    if (err) console.error('Vendors company_id migration error:', err);
  });
  db.query(`ALTER TABLE vendors ADD COLUMN IF NOT EXISTS business_entity_id INT NULL AFTER company_id`, (err) => {
    if (err) console.error('Vendors business_entity_id migration error:', err);
  });

  db.query(`
    CREATE TABLE IF NOT EXISTS company_registry (
      id          INT           AUTO_INCREMENT PRIMARY KEY,
      company_no  VARCHAR(20)   NOT NULL UNIQUE,
      business_entity_id INT    NULL,
      company_name VARCHAR(255) NOT NULL UNIQUE,
      address     TEXT,
      contact_person VARCHAR(255),
      phone       VARCHAR(50),
      email       VARCHAR(255),
      tin         VARCHAR(50),
      industry    VARCHAR(100),
      status      ENUM('active','inactive') NOT NULL DEFAULT 'active',
      archived    BOOLEAN       NOT NULL DEFAULT 0,
      archived_at TIMESTAMP NULL DEFAULT NULL,
      notes       TEXT,
      created_at  TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `, (err) => {
    if (err) console.error('Company registry table error:', err);
    else     console.log('âœ… Table "company_registry" ready');
  });

  db.query(`ALTER TABLE company_registry ADD COLUMN IF NOT EXISTS archived BOOLEAN NOT NULL DEFAULT 0`, (err) => {
    if (err) console.error('Company registry archived migration error:', err);
  });
  db.query(`ALTER TABLE company_registry ADD COLUMN IF NOT EXISTS archived_at TIMESTAMP NULL DEFAULT NULL`, (err) => {
    if (err) console.error('Company registry archived_at migration error:', err);
  });
  db.query(`ALTER TABLE company_registry ADD COLUMN IF NOT EXISTS business_entity_id INT NULL AFTER company_no`, (err) => {
    if (err) console.error('Company registry business_entity_id migration error:', err);
  });

  db.query(`
    CREATE TABLE IF NOT EXISTS purchase_orders (
      id          INT           AUTO_INCREMENT PRIMARY KEY,
      po_number   VARCHAR(50)   NOT NULL UNIQUE,
      requisition_id INT        NULL,
      business_entity_id INT    NULL,
      vendor_id   INT           NOT NULL,
      company_id  INT           NULL,
      project_id  INT           NULL,
      po_date     DATE          NOT NULL,
      delivery_date DATE,
      payment_terms VARCHAR(100),
      prepared_by VARCHAR(255),
      approved_by VARCHAR(255),
      total_amount DECIMAL(12,2) NOT NULL,
      status      ENUM('draft','pending','approved','received','cancelled') DEFAULT 'draft',
      notes       TEXT,
      created_at  TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (vendor_id) REFERENCES vendors(id),
      FOREIGN KEY (company_id) REFERENCES company_registry(id)
    )
  `, (err) => {
    if (err) console.error('Purchase orders table error:', err);
    else     console.log('âœ… Table "purchase_orders" ready');
  });
  db.query(`ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS company_id INT NULL AFTER vendor_id`, (err) => {
    if (err) console.error('Purchase orders company_id migration error:', err);
  });
  db.query(`ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS business_entity_id INT NULL AFTER requisition_id`, (err) => {
    if (err) console.error('Purchase orders business_entity_id migration error:', err);
  });
  db.query(`ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS project_id INT NULL AFTER company_id`, (err) => {
    if (err) console.error('Purchase orders project_id migration error:', err);
  });
  db.query(`ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS payment_terms VARCHAR(100) NULL AFTER delivery_date`, (err) => {
    if (err) console.error('Purchase orders payment_terms migration error:', err);
  });
  db.query(`ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS prepared_by VARCHAR(255) NULL AFTER payment_terms`, (err) => {
    if (err) console.error('Purchase orders prepared_by migration error:', err);
  });
  db.query(`ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS approved_by VARCHAR(255) NULL AFTER prepared_by`, (err) => {
    if (err) console.error('Purchase orders approved_by migration error:', err);
  });
  db.query(`
    SELECT CONSTRAINT_NAME
    FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'purchase_orders'
      AND COLUMN_NAME = 'company_id'
      AND REFERENCED_TABLE_NAME = 'company_registry'
    LIMIT 1
  `, (err, rows) => {
    if (err) {
      console.error('Purchase orders company FK lookup error:', err);
      return;
    }
    if (rows && rows.length) return;

    db.query(`
      ALTER TABLE purchase_orders
      ADD CONSTRAINT fk_purchase_orders_company_id
      FOREIGN KEY (company_id) REFERENCES company_registry(id)
      ON UPDATE CASCADE
      ON DELETE SET NULL
    `, (fkErr) => {
      if (fkErr && fkErr.code !== 'ER_DUP_KEYNAME') {
        console.error('Purchase orders company FK migration error:', fkErr);
      }
    });
  });

  db.query(`
    CREATE TABLE IF NOT EXISTS po_line_items (
      id          INT           AUTO_INCREMENT PRIMARY KEY,
      po_id       INT           NOT NULL,
      product_id  INT           NULL,
      description TEXT,
      quantity    INT           NOT NULL,
      unit_price  DECIMAL(12,2) NOT NULL,
      line_total  DECIMAL(12,2) NOT NULL,
      received_qty INT          DEFAULT 0,
      created_at  TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (po_id) REFERENCES purchase_orders(id),
      FOREIGN KEY (product_id) REFERENCES products(id)
    )
  `, (err) => {
    if (err) console.error('PO line items table error:', err);
    else     console.log('âœ… Table "po_line_items" ready');
  });

  db.query(`ALTER TABLE po_line_items MODIFY product_id INT NULL`, (err) => {
    if (err) console.error('PO line items product_id migration error:', err);
  });

  db.query(`ALTER TABLE po_line_items ADD COLUMN IF NOT EXISTS description TEXT AFTER product_id`, (err) => {
    if (err) console.error('PO line items description migration error:', err);
  });

  db.query(`
    CREATE TABLE IF NOT EXISTS accounts_payable (
      id          INT           AUTO_INCREMENT PRIMARY KEY,
      business_entity_id INT    NULL,
      vendor_id   INT           NOT NULL,
      bill_number VARCHAR(50)   NOT NULL UNIQUE,
      invoice_number VARCHAR(50),
      bill_date   DATE          NOT NULL,
      due_date    DATE,
      project_id  INT,
      po_id       INT,
      total_amount DECIMAL(12,2) NOT NULL,
      paid_amount DECIMAL(12,2) DEFAULT 0,
      status      ENUM('draft','pending','approved','partially_paid','paid','cancelled') DEFAULT 'pending',
      notes       TEXT,
      pdfFilename VARCHAR(255),
      created_at  TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (vendor_id) REFERENCES vendors(id),
      FOREIGN KEY (po_id) REFERENCES purchase_orders(id)
    )
  `, (err) => {
    if (err) console.error('Accounts payable table error:', err);
    else     console.log('âœ… Table "accounts_payable" ready');
  });

  db.query(`
    ALTER TABLE accounts_payable
    ADD COLUMN IF NOT EXISTS business_entity_id INT NULL
  `, (err) => {
    if (err) console.error('Accounts payable business_entity_id migration error:', err);
  });

  db.query(`
    ALTER TABLE accounts_payable
    ADD COLUMN IF NOT EXISTS bill_date DATE NULL
  `, (err) => {
    if (err) console.error('Accounts payable bill_date migration error:', err);
  });

  db.query(`
    ALTER TABLE accounts_payable
    ADD COLUMN IF NOT EXISTS due_date DATE NULL
  `, (err) => {
    if (err) console.error('Accounts payable due_date migration error:', err);
  });

  db.query(`
    ALTER TABLE accounts_payable
    ADD COLUMN IF NOT EXISTS invoice_number VARCHAR(50) NULL
  `, (err) => {
    if (err) console.error('Accounts payable invoice_number migration error:', err);
  });

  db.query(`
    ALTER TABLE accounts_payable
    ADD COLUMN IF NOT EXISTS pdfFilename VARCHAR(255) NULL
  `, (err) => {
    if (err) console.error('Accounts payable pdfFilename migration error:', err);
  });

  db.query(`
    ALTER TABLE accounts_payable
    ADD COLUMN IF NOT EXISTS project_id INT NULL
  `, (err) => {
    if (err) console.error('Accounts payable project_id migration error:', err);
  });

  db.query(`
    CREATE TABLE IF NOT EXISTS accounts_receivable (
      id          INT           AUTO_INCREMENT PRIMARY KEY,
      business_entity_id INT    NULL,
      customer_name VARCHAR(255) NOT NULL,
      invoice_number VARCHAR(50)  NOT NULL UNIQUE,
      invoice_date DATE          NOT NULL,
      due_date    DATE,
      payment_terms VARCHAR(50),
      total_amount DECIMAL(12,2) NOT NULL,
      paid_amount DECIMAL(12,2) DEFAULT 0,
      status      ENUM('draft','sent','partial','paid','overdue','cancelled') DEFAULT 'draft',
      transaction_id INT,
      created_at  TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (transaction_id) REFERENCES transactions(id)
    )
  `, (err) => {
    if (err) console.error('Accounts receivable table error:', err);
    else     console.log('âœ… Table "accounts_receivable" ready');
  });

  db.query(`
    ALTER TABLE accounts_receivable
    ADD COLUMN IF NOT EXISTS business_entity_id INT NULL
  `, (err) => {
    if (err) console.error('Accounts receivable business_entity_id migration error:', err);
  });

  db.query(`
    ALTER TABLE accounts_receivable
    ADD COLUMN IF NOT EXISTS archived BOOLEAN NOT NULL DEFAULT 0
  `, (err) => {
    if (err) console.error('Accounts receivable archived migration error:', err);
  });

  db.query(`
    ALTER TABLE accounts_receivable
    ADD COLUMN IF NOT EXISTS archived_at TIMESTAMP NULL DEFAULT NULL
  `, (err) => {
    if (err) console.error('Accounts receivable archived_at migration error:', err);
  });

  db.query(`
    ALTER TABLE accounts_receivable
    ADD COLUMN IF NOT EXISTS notes TEXT NULL
  `, (err) => {
    if (err) console.error('Accounts receivable notes column error:', err);
  });

  db.query(`
    ALTER TABLE accounts_receivable
    ADD COLUMN IF NOT EXISTS payment_terms VARCHAR(50) NULL
  `, (err) => {
    if (err) console.error('Accounts receivable payment_terms column error:', err);
  });

  db.query(`
    ALTER TABLE accounts_receivable
    ADD COLUMN IF NOT EXISTS project_id INT NULL
  `, (err) => {
    if (err) console.error('Accounts receivable project_id column error:', err);
  });
  db.query(`
    UPDATE accounts_receivable ar
    JOIN transactions t ON t.id = ar.transaction_id
    SET ar.project_id = COALESCE(ar.project_id, t.project_id)
    WHERE COALESCE(ar.project_id, 0) = 0
      AND COALESCE(t.project_id, 0) > 0
  `, (err) => {
    if (err) console.error('Accounts receivable project_id backfill error:', err);
  });
  db.query(`
    ALTER TABLE accounts_receivable
    ADD INDEX idx_accounts_receivable_project_id (project_id)
  `, (err) => {
    if (err && !String(err.message || '').toLowerCase().includes('duplicate key name')) {
      console.error('Accounts receivable project_id index migration error:', err);
    }
  });
  db.query(`
    SELECT CONSTRAINT_NAME
    FROM information_schema.KEY_COLUMN_USAGE
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'accounts_receivable'
      AND COLUMN_NAME = 'project_id'
      AND REFERENCED_TABLE_NAME = 'projects'
    LIMIT 1
  `, (checkErr, rows) => {
    if (checkErr) {
      console.error('Accounts receivable project FK lookup error:', checkErr);
      return;
    }

    if (rows && rows.length) return;

    db.query(`
      ALTER TABLE accounts_receivable
      ADD CONSTRAINT fk_accounts_receivable_project_id
      FOREIGN KEY (project_id) REFERENCES projects(id)
      ON DELETE SET NULL
    `, (err) => {
      if (err && !String(err.message || '').toLowerCase().includes('duplicate key name')) {
        console.error('Accounts receivable project FK migration error:', err);
      }
    });
  });

  db.query(`
    ALTER TABLE accounts_receivable
    ADD COLUMN IF NOT EXISTS project_docno VARCHAR(20) NULL
  `, (err) => {
    if (err) console.error('Accounts receivable project_docno column error:', err);
  });

  db.query(`
    ALTER TABLE accounts_receivable
    ADD COLUMN IF NOT EXISTS service_order_no VARCHAR(50) NULL
  `, (err) => {
    if (err) console.error('Accounts receivable service_order_no column error:', err);
  });

  db.query(`
    CREATE TABLE IF NOT EXISTS payments (
      id          INT           AUTO_INCREMENT PRIMARY KEY,
      payment_type ENUM('ap','ar') NOT NULL,
      ap_id       INT,
      ar_id       INT,
      payment_date DATE          NOT NULL,
      amount      DECIMAL(12,2) NOT NULL,
      payment_method ENUM('cash','check','bank_transfer','credit_card') DEFAULT 'cash',
      reference_number VARCHAR(100),
      notes       TEXT,
      created_at  TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (ap_id) REFERENCES accounts_payable(id),
      FOREIGN KEY (ar_id) REFERENCES accounts_receivable(id)
    )
  `, (err) => {
    if (err) console.error('Payments table error:', err);
    else     console.log('âœ… Table "payments" ready');
  });

  db.query(`ALTER TABLE payments ADD COLUMN IF NOT EXISTS payment_type ENUM('ap','ar') NOT NULL DEFAULT 'ap'`, (err) => {
    if (err) console.error('Payments payment_type migration error:', err);
  });
  db.query(`ALTER TABLE payments ADD COLUMN IF NOT EXISTS ap_id INT NULL`, (err) => {
    if (err) console.error('Payments ap_id migration error:', err);
  });
  db.query(`ALTER TABLE payments ADD COLUMN IF NOT EXISTS ar_id INT NULL`, (err) => {
    if (err) console.error('Payments ar_id migration error:', err);
  });
  db.query(`ALTER TABLE payments ADD COLUMN IF NOT EXISTS payment_method ENUM('cash','check','bank_transfer','credit_card') DEFAULT 'cash'`, (err) => {
    if (err) console.error('Payments payment_method migration error:', err);
  });
  db.query(`ALTER TABLE payments ADD COLUMN IF NOT EXISTS reference_number VARCHAR(100) NULL`, (err) => {
    if (err) console.error('Payments reference_number migration error:', err);
  });
  db.query(`ALTER TABLE payments ADD COLUMN IF NOT EXISTS notes TEXT NULL`, (err) => {
    if (err) console.error('Payments notes migration error:', err);
  });
  db.query(`UPDATE payments SET payment_type = 'ar' WHERE COALESCE(ar_id, 0) > 0 AND COALESCE(payment_type, '') <> 'ar'`, (err) => {
    if (err) console.error('Payments legacy AR migration error:', err);
  });
  db.query(`UPDATE payments SET payment_type = 'ap' WHERE COALESCE(ap_id, 0) > 0 AND COALESCE(payment_type, '') <> 'ap'`, (err) => {
    if (err) console.error('Payments legacy AP migration error:', err);
  });

  db.query(`
    CREATE TABLE IF NOT EXISTS projects (
      id          INT           AUTO_INCREMENT PRIMARY KEY,
      project_docno VARCHAR(20) UNIQUE,
      project_name VARCHAR(255)  NOT NULL,
      business_entity_id INT NULL,
      transaction_id INT,
      company_id  INT,
      source_docno VARCHAR(20),
      company_no  VARCHAR(20),
      company_name VARCHAR(255),
      client_name VARCHAR(255),
      project_ar_invoice_no VARCHAR(50),
      project_ap_bill_no VARCHAR(50),
      description TEXT,
      checkno     VARCHAR(100),
      pono        VARCHAR(100),
      downpayment DECIMAL(12,2) NOT NULL DEFAULT 0,
      qty         INT           NOT NULL DEFAULT 0,
      unit_cost   DECIMAL(15,2) NOT NULL DEFAULT 0,
      project_members VARCHAR(255),
      member_role   VARCHAR(50),
      member_phone  VARCHAR(20),
      project_members_2 VARCHAR(255),
      member_role_2 VARCHAR(50),
      member_phone_2 VARCHAR(20),
      project_members_3 VARCHAR(255),
      member_role_3 VARCHAR(50),
      member_phone_3 VARCHAR(20),
      start_date  DATE          NOT NULL,
      end_date    DATE          NOT NULL,
      planned_start_date DATE,
      planned_end_date DATE,
      actual_start_date DATE,
      actual_end_date DATE,
      status_reason TEXT,
      paused_at DATE,
      cancelled_at DATE,
      project_manager VARCHAR(100),
      pdfFilename VARCHAR(255),
      status      ENUM('planning','active','on_hold','completed','cancelled') DEFAULT 'planning',
      priority    ENUM('low','medium','high','critical') DEFAULT 'medium',
      is_archived BOOLEAN       NOT NULL DEFAULT 0,
      archived_auto BOOLEAN     NOT NULL DEFAULT 0,
      budget      DECIMAL(15,2) NOT NULL,
      created_at  TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `, (err) => {
    if (err) console.error('Projects table error:', err);
    else     console.log('âœ… Table "projects" ready');
    migrateExistingProjectDocnos().catch((migrationErr) => {
      console.error('Project docno migration init error:', migrationErr);
    });
  });

  db.query(`
    CREATE TABLE IF NOT EXISTS system_logs (
      id          INT           AUTO_INCREMENT PRIMARY KEY,
      user_id     INT,
      module      VARCHAR(50),
      action      VARCHAR(100)  NOT NULL,
      details     TEXT,
      ip_address  VARCHAR(50),
      created_at  TIMESTAMP     DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
    )
  `, (err) => { if (err) console.error('Logs table error:', err); });
  db.query(`ALTER TABLE system_logs ADD COLUMN IF NOT EXISTS module VARCHAR(50) NULL`, (err) => {
    if (err) console.error('System logs module migration error:', err);
  });
  db.query(`ALTER TABLE system_logs ADD COLUMN IF NOT EXISTS ip_address VARCHAR(50) NULL`, (err) => {
    if (err) console.error('System logs ip migration error:', err);
  });

  // Migration for projects members
  db.query(`ALTER TABLE projects ADD COLUMN IF NOT EXISTS members VARCHAR(255)`, (err) => {
    if (err) console.error('Projects members migration error:', err);
  });
  db.query(`ALTER TABLE projects ADD COLUMN IF NOT EXISTS project_docno VARCHAR(20)`, (err) => {
    if (err) console.error('Projects project_docno migration error:', err);
  });
  db.query(`ALTER TABLE projects ADD COLUMN IF NOT EXISTS business_entity_id INT NULL AFTER project_name`, (err) => {
    if (err) console.error('Projects business_entity_id migration error:', err);
  });
  db.query(`ALTER TABLE projects ADD COLUMN IF NOT EXISTS pdfFilename VARCHAR(255)`, (err) => {
    if (err) console.error('Projects pdfFilename migration error:', err);
  });
  db.query(`ALTER TABLE projects ADD COLUMN IF NOT EXISTS is_archived BOOLEAN NOT NULL DEFAULT 0`, (err) => {
    if (err) console.error('Projects archived migration error:', err);
  });
  db.query(`ALTER TABLE projects ADD COLUMN IF NOT EXISTS archived_auto BOOLEAN NOT NULL DEFAULT 0`, (err) => {
    if (err) console.error('Projects archived_auto migration error:', err);
  });
  db.query(`ALTER TABLE projects ADD COLUMN IF NOT EXISTS transaction_id INT`, (err) => {
    if (err) console.error('Projects transaction_id migration error:', err);
  });
  // Safe migration: Add company_id column if not exists
  db.query(`ALTER TABLE projects ADD COLUMN company_id INT NULL`, (err) => {
    if (err) {
      if (err.message.includes('Duplicate')) return;
      console.log('Projects company_id migration skipped:', err.message);
    } else {
      console.log('Projects company_id column added');
    }
  });
  db.query(`ALTER TABLE projects ADD COLUMN IF NOT EXISTS source_docno VARCHAR(20)`, (err) => {
    if (err) console.error('Projects source_docno migration error:', err);
  });
  db.query(`ALTER TABLE projects ADD COLUMN IF NOT EXISTS company_no VARCHAR(20)`, (err) => {
    if (err) console.error('Projects company_no migration error:', err);
  });
  db.query(`ALTER TABLE projects ADD COLUMN IF NOT EXISTS company_name VARCHAR(255)`, (err) => {
    if (err) console.error('Projects company_name migration error:', err);
  });
  db.query(`ALTER TABLE projects ADD COLUMN IF NOT EXISTS client_name VARCHAR(255)`, (err) => {
    if (err) console.error('Projects client_name migration error:', err);
  });
  db.query(`ALTER TABLE projects ADD COLUMN IF NOT EXISTS project_ar_invoice_no VARCHAR(50)`, (err) => {
    if (err) console.error('Projects project_ar_invoice_no migration error:', err);
  });
  db.query(`ALTER TABLE projects ADD COLUMN IF NOT EXISTS project_ap_bill_no VARCHAR(50)`, (err) => {
    if (err) console.error('Projects project_ap_bill_no migration error:', err);
  });

  db.query(`
    SELECT CONSTRAINT_NAME
    FROM information_schema.KEY_COLUMN_USAGE
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'accounts_payable'
      AND COLUMN_NAME = 'project_id'
      AND REFERENCED_TABLE_NAME = 'projects'
    LIMIT 1
  `, (checkErr, rows) => {
    if (checkErr) {
      console.error('Accounts payable project FK lookup error:', checkErr);
      return;
    }

    if (rows && rows.length) return;

    db.query(`
      ALTER TABLE accounts_payable
      ADD CONSTRAINT fk_accounts_payable_project_id
      FOREIGN KEY (project_id) REFERENCES projects(id)
      ON DELETE SET NULL
    `, (err) => {
      if (err && !String(err.message || '').toLowerCase().includes('duplicate key name')) {
        console.error('Accounts payable project FK migration error:', err);
      }
    });
  });

  db.query(`
    SELECT CONSTRAINT_NAME
    FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'transactions'
      AND CONSTRAINT_NAME = 'fk_transactions_project_id'
      AND CONSTRAINT_TYPE = 'FOREIGN KEY'
    LIMIT 1
  `, (checkErr, rows) => {
    if (checkErr) {
      console.error('Transactions project_id FK lookup error:', checkErr);
      return;
    }

    if (rows && rows.length) return;

    db.query(`ALTER TABLE transactions ADD CONSTRAINT fk_transactions_project_id FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL`, (err) => {
      if (err && !String(err.message || '').toLowerCase().includes('duplicate key name')) {
        console.error('Transactions project_id FK migration error:', err);
      }
    });
  });
  db.query(`
    SELECT CONSTRAINT_NAME
    FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'stock_movements'
      AND CONSTRAINT_NAME = 'fk_stock_movements_transaction_id'
      AND CONSTRAINT_TYPE = 'FOREIGN KEY'
    LIMIT 1
  `, (checkErr, rows) => {
    if (checkErr) {
      console.error('Stock movements transaction FK lookup error:', checkErr);
      return;
    }

    if (rows && rows.length) return;

    db.query(`ALTER TABLE stock_movements ADD CONSTRAINT fk_stock_movements_transaction_id FOREIGN KEY (transaction_id) REFERENCES transactions(id) ON DELETE SET NULL`, (err) => {
      if (err && !String(err.message || '').toLowerCase().includes('duplicate key name')) {
        console.error('Stock movements transaction FK migration error:', err);
      }
    });
  });
  db.query(`ALTER TABLE transactions ADD UNIQUE KEY uniq_transactions_project_tx_no (project_id, project_tx_no)`, (err) => {
    if (err && !String(err.message || '').toLowerCase().includes('duplicate key name')) {
      console.error('Transactions project_tx_no unique index migration error:', err);
    }
  });
  db.query(`
    SELECT CONSTRAINT_NAME
    FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'transactions'
      AND CONSTRAINT_NAME = 'fk_transactions_service_order_id'
      AND CONSTRAINT_TYPE = 'FOREIGN KEY'
    LIMIT 1
  `, (checkErr, rows) => {
    if (checkErr) {
      console.error('Transactions service_order_id FK lookup error:', checkErr);
      return;
    }

    if (rows && rows.length) return;

    db.query(`ALTER TABLE transactions ADD CONSTRAINT fk_transactions_service_order_id FOREIGN KEY (service_order_id) REFERENCES service_orders(id) ON DELETE SET NULL`, (err) => {
      if (err && !String(err.message || '').toLowerCase().includes('duplicate key name')) {
        console.error('Transactions service_order_id FK migration error:', err);
      }
    });
  });
  db.query(`
    UPDATE transactions t
    JOIN service_orders so ON so.project_id = t.project_id
    SET t.service_order_id = so.id
    WHERE COALESCE(t.service_order_id, 0) = 0
      AND COALESCE(t.project_id, 0) > 0
  `, (err) => {
    if (err) console.error('Transactions service_order_id backfill error:', err);
  });
  db.query(`
    SELECT INDEX_NAME
    FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'service_orders'
      AND COLUMN_NAME = 'project_id'
      AND NON_UNIQUE = 0
    LIMIT 1
  `, (err, rows) => {
    if (err) {
      console.error('Service orders unique index lookup error:', err);
      return;
    }
    if (!rows || !rows.length) return;

    const indexName = String(rows[0].INDEX_NAME || '').trim();
    if (!indexName) return;

  db.query(`ALTER TABLE service_orders DROP INDEX \`${indexName.replace(/`/g, '')}\``, (dropErr) => {
      if (dropErr && !String(dropErr.message || '').toLowerCase().includes('check that it exists')) {
        console.error('Service orders project_id unique index drop error:', dropErr);
      }
    });
  });
  db.query(`ALTER TABLE service_orders ADD COLUMN IF NOT EXISTS service_type VARCHAR(100) NOT NULL DEFAULT 'installation' AFTER project_id`, (err) => {
    if (err && !String(err.message || '').toLowerCase().includes('duplicate column name')) {
      console.error('Service orders service_type migration error:', err);
    }
  });
  db.query(`ALTER TABLE service_orders ADD COLUMN IF NOT EXISTS business_entity_id INT NULL AFTER so_number`, (err) => {
    if (err) console.error('Service orders business_entity_id migration error:', err);
  });
  db.query(`ALTER TABLE service_orders MODIFY service_type VARCHAR(100) NOT NULL DEFAULT 'installation'`, (err) => {
    if (err && !String(err.message || '').toLowerCase().includes('duplicate column name')) {
      console.error('Service orders service_type modify migration error:', err);
    }
  });
  db.query(`UPDATE service_orders SET service_type = 'installation' WHERE COALESCE(service_type, '') = ''`, (err) => {
    if (err) console.error('Service orders service_type backfill error:', err);
  });
  db.query(`ALTER TABLE service_orders MODIFY status ENUM('draft','issued','accepted','in_progress','completed','cancelled') NOT NULL DEFAULT 'issued'`, (err) => {
    if (err) console.error('Service orders status default migration error:', err);
  });
  db.query(`
    CREATE TABLE IF NOT EXISTS document_sequences (
      sequence_key VARCHAR(100) NOT NULL,
      period_key VARCHAR(20) NOT NULL DEFAULT '',
      last_value INT NOT NULL DEFAULT 0,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (sequence_key, period_key)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `, (err) => {
    if (err) console.error('Document sequences table error:', err);
  });

  db.query(`
    ALTER TABLE company_registry
    ADD COLUMN IF NOT EXISTS address TEXT NULL,
    ADD COLUMN IF NOT EXISTS contact_person VARCHAR(255) NULL,
    ADD COLUMN IF NOT EXISTS phone VARCHAR(50) NULL,
    ADD COLUMN IF NOT EXISTS email VARCHAR(255) NULL,
    ADD COLUMN IF NOT EXISTS tin VARCHAR(50) NULL,
    ADD COLUMN IF NOT EXISTS industry VARCHAR(100) NULL,
    ADD COLUMN IF NOT EXISTS status ENUM('active','inactive') NOT NULL DEFAULT 'active',
    ADD COLUMN IF NOT EXISTS notes TEXT NULL,
    ADD COLUMN IF NOT EXISTS business_entity_id INT NULL
  `, (err) => {
    if (err) console.error('Company registry migration error:', err);
  });
  db.query(`ALTER TABLE projects ADD COLUMN IF NOT EXISTS checkno VARCHAR(100)`, (err) => {
    if (err) console.error('Projects checkno migration error:', err);
  });
  db.query(`ALTER TABLE projects ADD COLUMN IF NOT EXISTS pono VARCHAR(100)`, (err) => {
    if (err) console.error('Projects pono migration error:', err);
  });
  db.query(`ALTER TABLE projects ADD COLUMN IF NOT EXISTS downpayment DECIMAL(12,2) NOT NULL DEFAULT 0`, (err) => {
    if (err) console.error('Projects downpayment migration error:', err);
  });
  db.query(`ALTER TABLE projects ADD COLUMN IF NOT EXISTS qty INT NOT NULL DEFAULT 0`, (err) => {
    if (err) console.error('Projects qty migration error:', err);
  });
  db.query(`ALTER TABLE projects ADD COLUMN IF NOT EXISTS unit_cost DECIMAL(15,2) NOT NULL DEFAULT 0`, (err) => {
    if (err) console.error('Projects unit_cost migration error:', err);
  });
  db.query(`ALTER TABLE projects ADD COLUMN IF NOT EXISTS project_members VARCHAR(255)`, (err) => {
    if (err) console.error('Projects member 1 migration error:', err);
  });
  db.query(`ALTER TABLE projects ADD COLUMN IF NOT EXISTS member_role VARCHAR(50)`, (err) => {
    if (err) console.error('Projects member role 1 migration error:', err);
  });
  db.query(`ALTER TABLE projects ADD COLUMN IF NOT EXISTS member_phone VARCHAR(20)`, (err) => {
    if (err) console.error('Projects member phone 1 migration error:', err);
  });
  db.query(`ALTER TABLE projects ADD COLUMN IF NOT EXISTS project_members_2 VARCHAR(255)`, (err) => {
    if (err) console.error('Projects member 2 migration error:', err);
  });
  db.query(`ALTER TABLE projects ADD COLUMN IF NOT EXISTS member_role_2 VARCHAR(50)`, (err) => {
    if (err) console.error('Projects member role 2 migration error:', err);
  });
  db.query(`ALTER TABLE projects ADD COLUMN IF NOT EXISTS member_phone_2 VARCHAR(20)`, (err) => {
    if (err) console.error('Projects member phone 2 migration error:', err);
  });
  db.query(`ALTER TABLE projects ADD COLUMN IF NOT EXISTS project_members_3 VARCHAR(255)`, (err) => {
    if (err) console.error('Projects member 3 migration error:', err);
  });
  db.query(`ALTER TABLE projects ADD COLUMN IF NOT EXISTS member_role_3 VARCHAR(50)`, (err) => {
    if (err) console.error('Projects member role 3 migration error:', err);
  });
  db.query(`ALTER TABLE projects ADD COLUMN IF NOT EXISTS member_phone_3 VARCHAR(20)`, (err) => {
    if (err) console.error('Projects member phone 3 migration error:', err);
  });

  db.query(`
    UPDATE projects p
    JOIN company_registry c ON LOWER(TRIM(p.company_no)) = LOWER(TRIM(c.company_no))
    SET p.company_id = c.id
    WHERE COALESCE(p.company_id, 0) = 0
      AND COALESCE(p.company_no, '') <> ''
  `, (err) => {
    if (err) console.error('Projects company_id backfill by company_no error:', err);
  });

  db.query(`
    UPDATE projects p
    JOIN company_registry c ON LOWER(TRIM(COALESCE(NULLIF(p.company_name, ''), NULLIF(p.client_name, '')))) = LOWER(TRIM(c.company_name))
    SET p.company_id = c.id
    WHERE COALESCE(p.company_id, 0) = 0
      AND COALESCE(p.company_name, p.client_name, '') <> ''
  `, (err) => {
    if (err) console.error('Projects company_id backfill by company_name error:', err);
  });

  db.query(`
    SELECT CONSTRAINT_NAME
    FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'projects'
      AND COLUMN_NAME = 'company_id'
      AND REFERENCED_TABLE_NAME = 'company_registry'
    LIMIT 1
  `, (err, rows) => {
    if (err) {
      console.error('Projects company FK lookup error:', err);
      return;
    }
    if (rows && rows.length) return;

    db.query(`
      ALTER TABLE projects
      ADD CONSTRAINT fk_projects_company_id
      FOREIGN KEY (company_id) REFERENCES company_registry(id)
      ON UPDATE CASCADE
      ON DELETE SET NULL
    `, (fkErr) => {
      if (fkErr && fkErr.code !== 'ER_DUP_KEYNAME') {
        console.error('Projects company FK migration error:', fkErr);
      }
    });
  });
  db.query(`ALTER TABLE projects ADD COLUMN IF NOT EXISTS planned_start_date DATE`, (err) => {
    if (err) console.error('Projects planned_start_date migration error:', err);
  });
  db.query(`ALTER TABLE projects ADD COLUMN IF NOT EXISTS planned_end_date DATE`, (err) => {
    if (err) console.error('Projects planned_end_date migration error:', err);
  });
  db.query(`ALTER TABLE projects ADD COLUMN IF NOT EXISTS actual_start_date DATE`, (err) => {
    if (err) console.error('Projects actual_start_date migration error:', err);
  });
  db.query(`ALTER TABLE projects ADD COLUMN IF NOT EXISTS actual_end_date DATE`, (err) => {
    if (err) console.error('Projects actual_end_date migration error:', err);
  });
  db.query(`ALTER TABLE projects ADD COLUMN IF NOT EXISTS status_reason TEXT`, (err) => {
    if (err) console.error('Projects status_reason migration error:', err);
  });
  db.query(`ALTER TABLE projects ADD COLUMN IF NOT EXISTS paused_at DATE`, (err) => {
    if (err) console.error('Projects paused_at migration error:', err);
  });
  db.query(`ALTER TABLE projects ADD COLUMN IF NOT EXISTS cancelled_at DATE`, (err) => {
    if (err) console.error('Projects cancelled_at migration error:', err);
    else backfillProjectTimelineFields();
  });

  db.query(`
    CREATE TABLE IF NOT EXISTS tasks (
      id          INT           AUTO_INCREMENT PRIMARY KEY,
      project_id  INT           NOT NULL,
      task_name   VARCHAR(255)  NOT NULL,
      description TEXT,
      start_date  DATE          NOT NULL,
      end_date    DATE          NOT NULL,
      duration    INT,
      progress    INT           DEFAULT 0,
      assigned_to VARCHAR(100),
      status      ENUM('not_started','in_progress','on_hold','completed','cancelled') DEFAULT 'not_started',
      plan_cost   DECIMAL(12,2) DEFAULT 0,
      actual_cost DECIMAL(12,2) DEFAULT 0,
      dependencies INT,
      created_at  TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (project_id) REFERENCES projects(id)
    )
  `, (err) => {
    if (err) console.error('Tasks table error:', err);
    else     console.log('âœ… Table "tasks" ready');
  });

  db.query(`
    CREATE TABLE IF NOT EXISTS project_costs (
      id          INT           AUTO_INCREMENT PRIMARY KEY,
      project_id  INT           NOT NULL,
      task_id     INT,
      cost_category VARCHAR(100),
      plan_amount DECIMAL(12,2) NOT NULL,
      actual_amount DECIMAL(12,2) DEFAULT 0,
      variance    DECIMAL(12,2),
      cost_date   DATE,
      notes       TEXT,
      created_at  TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (project_id) REFERENCES projects(id),
      FOREIGN KEY (task_id) REFERENCES tasks(id)
    )
  `, (err) => {
    if (err) console.error('Project costs table error:', err);
    else     console.log('âœ… Table "project_costs" ready');
  });

  db.query(`
    CREATE TABLE IF NOT EXISTS project_resources (
      id          INT           AUTO_INCREMENT PRIMARY KEY,
      project_id  INT           NOT NULL,
      task_id     INT,
      resource_name VARCHAR(100) NOT NULL,
      resource_type ENUM('labor','material','equipment','other') DEFAULT 'labor',
      quantity    DECIMAL(10,2),
      unit_cost   DECIMAL(12,2),
      allocation  INT           DEFAULT 100,
      created_at  TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (project_id) REFERENCES projects(id),
      FOREIGN KEY (task_id) REFERENCES tasks(id)
    )
  `, (err) => {
    if (err) console.error('Project resources table error:', err);
    else     console.log('âœ… Table "project_resources" ready');
  });

  db.query(`
    CREATE TABLE IF NOT EXISTS chart_of_accounts (
      id              INT AUTO_INCREMENT PRIMARY KEY,
      account_code    VARCHAR(30)  NOT NULL UNIQUE,
      account_name    VARCHAR(255) NOT NULL,
      account_type    ENUM('asset','liability','equity','revenue','expense') NOT NULL,
      parent_account_id INT NULL,
      is_active       BOOLEAN      NOT NULL DEFAULT 1,
      created_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (parent_account_id) REFERENCES chart_of_accounts(id) ON DELETE SET NULL
    )
  `, (err) => {
    if (err) console.error('Chart of accounts table error:', err);
    else     console.log('âœ… Table "chart_of_accounts" ready');
  });

  db.query(`
    CREATE TABLE IF NOT EXISTS accounting_periods (
      id            INT AUTO_INCREMENT PRIMARY KEY,
      period_name   VARCHAR(100) NOT NULL UNIQUE,
      start_date    DATE NOT NULL,
      end_date      DATE NOT NULL,
      is_closed     BOOLEAN NOT NULL DEFAULT 0,
      created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `, (err) => {
    if (err) console.error('Accounting periods table error:', err);
    else     console.log('âœ… Table "accounting_periods" ready');
  });

  db.query(`
    CREATE TABLE IF NOT EXISTS journal_entries (
      id            INT AUTO_INCREMENT PRIMARY KEY,
      entry_number  VARCHAR(50) NOT NULL UNIQUE,
      entry_date    DATE NOT NULL,
      reference_type VARCHAR(50),
      reference_id   VARCHAR(50),
      memo          TEXT,
      status        ENUM('draft','posted','reversed') NOT NULL DEFAULT 'draft',
      created_by    INT NULL,
      created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
    )
  `, (err) => {
    if (err) console.error('Journal entries table error:', err);
    else     console.log('âœ… Table "journal_entries" ready');
  });

  db.query(`
    CREATE TABLE IF NOT EXISTS journal_lines (
      id              INT AUTO_INCREMENT PRIMARY KEY,
      journal_entry_id INT NOT NULL,
      account_id      INT NOT NULL,
      line_memo       TEXT,
      debit           DECIMAL(12,2) NOT NULL DEFAULT 0,
      credit          DECIMAL(12,2) NOT NULL DEFAULT 0,
      created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (journal_entry_id) REFERENCES journal_entries(id) ON DELETE CASCADE,
      FOREIGN KEY (account_id) REFERENCES chart_of_accounts(id)
    )
  `, (err) => {
    if (err) console.error('Journal lines table error:', err);
    else     console.log('âœ… Table "journal_lines" ready');
  });

  db.query(`
    CREATE TABLE IF NOT EXISTS purchase_requisitions (
      id            INT AUTO_INCREMENT PRIMARY KEY,
      pr_number     VARCHAR(50) NOT NULL UNIQUE,
      business_entity_id INT NULL,
      company_id    INT NULL,
      request_date   DATE NOT NULL,
      department    VARCHAR(100),
      requested_by   VARCHAR(100),
      needed_by     DATE,
      status        ENUM('draft','submitted','approved','ordered','received','cancelled') NOT NULL DEFAULT 'draft',
      notes        TEXT,
      created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (company_id) REFERENCES company_registry(id) ON DELETE SET NULL
    )
  `, (err) => {
    if (err) console.error('Purchase requisitions table error:', err);
    else     console.log('âœ… Table "purchase_requisitions" ready');
  });
  db.query(`ALTER TABLE purchase_requisitions ADD COLUMN IF NOT EXISTS company_id INT NULL AFTER pr_number`, (err) => {
    if (err) console.error('Purchase requisitions company_id migration error:', err);
  });
  db.query(`ALTER TABLE purchase_requisitions ADD COLUMN IF NOT EXISTS business_entity_id INT NULL AFTER pr_number`, (err) => {
    if (err) console.error('Purchase requisitions business_entity_id migration error:', err);
  });
  db.query(`
    SELECT CONSTRAINT_NAME
    FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'purchase_requisitions'
      AND COLUMN_NAME = 'company_id'
      AND REFERENCED_TABLE_NAME = 'company_registry'
    LIMIT 1
  `, (err, rows) => {
    if (err) {
      console.error('Purchase requisitions company FK lookup error:', err);
      return;
    }
    if (rows && rows.length) return;

    db.query(`
      ALTER TABLE purchase_requisitions
      ADD CONSTRAINT fk_purchase_requisitions_company_id
      FOREIGN KEY (company_id) REFERENCES company_registry(id)
      ON UPDATE CASCADE
      ON DELETE SET NULL
    `, (fkErr) => {
      if (fkErr && fkErr.code !== 'ER_DUP_KEYNAME') {
        console.error('Purchase requisitions company FK migration error:', fkErr);
      }
    });
  });
  db.query(`ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS requisition_id INT NULL AFTER po_number`, (err) => {
    if (err) console.error('Purchase orders requisition_id migration error:', err);
  });
  db.query(`
    SELECT CONSTRAINT_NAME
    FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'purchase_orders'
      AND COLUMN_NAME = 'requisition_id'
      AND REFERENCED_TABLE_NAME = 'purchase_requisitions'
    LIMIT 1
  `, (err, rows) => {
    if (err) {
      console.error('Purchase orders requisition FK lookup error:', err);
      return;
    }
    if (rows && rows.length) return;

    db.query(`
      ALTER TABLE purchase_orders
      ADD CONSTRAINT fk_purchase_orders_requisition_id
      FOREIGN KEY (requisition_id) REFERENCES purchase_requisitions(id)
      ON UPDATE CASCADE
      ON DELETE SET NULL
    `, (fkErr) => {
      if (fkErr && fkErr.code !== 'ER_DUP_KEYNAME') {
        console.error('Purchase orders requisition FK migration error:', fkErr);
      }
    });
  });

  db.query(`
    CREATE TABLE IF NOT EXISTS purchase_requisition_items (
      id            INT AUTO_INCREMENT PRIMARY KEY,
      pr_id         INT NOT NULL,
      item_name     VARCHAR(255) NOT NULL,
      description   TEXT,
      quantity      DECIMAL(12,2) NOT NULL DEFAULT 1,
      unit          VARCHAR(30),
      estimated_unit_price DECIMAL(12,2) NOT NULL DEFAULT 0,
      line_total    DECIMAL(12,2) NOT NULL DEFAULT 0,
      created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (pr_id) REFERENCES purchase_requisitions(id) ON DELETE CASCADE
    )
  `, (err) => {
    if (err) console.error('Purchase requisition items table error:', err);
    else     console.log('âœ… Table "purchase_requisition_items" ready');
  });

  db.query(`
    CREATE TABLE IF NOT EXISTS goods_receipts (
      id            INT AUTO_INCREMENT PRIMARY KEY,
      grn_number    VARCHAR(50) NOT NULL UNIQUE,
      po_id         INT NOT NULL,
      received_date DATE NOT NULL,
      received_by   VARCHAR(100),
      status        ENUM('draft','received','rejected') NOT NULL DEFAULT 'draft',
      notes        TEXT,
      created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (po_id) REFERENCES purchase_orders(id)
    )
  `, (err) => {
    if (err) console.error('Goods receipts table error:', err);
    else     console.log('âœ… Table "goods_receipts" ready');
  });

  db.query(`
    CREATE TABLE IF NOT EXISTS goods_receipt_items (
      id            INT AUTO_INCREMENT PRIMARY KEY,
      receipt_id    INT NOT NULL,
      po_line_item_id INT,
      received_qty  DECIMAL(12,2) NOT NULL DEFAULT 0,
      notes        TEXT,
      created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (receipt_id) REFERENCES goods_receipts(id) ON DELETE CASCADE,
      FOREIGN KEY (po_line_item_id) REFERENCES po_line_items(id) ON DELETE SET NULL
    )
  `, (err) => {
    if (err) console.error('Goods receipt items table error:', err);
    else     console.log('âœ… Table "goods_receipt_items" ready');
  });

  db.query(`
    CREATE TABLE IF NOT EXISTS departments (
      id            INT AUTO_INCREMENT PRIMARY KEY,
      department_name VARCHAR(100) NOT NULL UNIQUE,
      description   TEXT,
      is_active     BOOLEAN NOT NULL DEFAULT 1,
      created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `, (err) => {
    if (err) console.error('Departments table error:', err);
    else     console.log('âœ… Table "departments" ready');
  });

  db.query(`
    CREATE TABLE IF NOT EXISTS employees (
      id            INT AUTO_INCREMENT PRIMARY KEY,
      employee_code VARCHAR(50) NOT NULL UNIQUE,
      full_name     VARCHAR(255) NOT NULL,
      department_id INT NULL,
      job_title     VARCHAR(150),
      employment_type ENUM('regular','contract','probationary','part_time') NOT NULL DEFAULT 'regular',
      pay_frequency  ENUM('monthly','semi_monthly','biweekly','weekly') NOT NULL DEFAULT 'monthly',
      salary_rate   DECIMAL(12,2) NOT NULL DEFAULT 0,
      email         VARCHAR(100),
      phone         VARCHAR(30),
      hire_date     DATE,
      status        ENUM('active','on_leave','inactive') NOT NULL DEFAULT 'active',
      created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE SET NULL
    )
  `, (err) => {
    if (err) console.error('Employees table error:', err);
    else     console.log('âœ… Table "employees" ready');
    employeesTableReady = !err;
    initializePayrollTables();
  });

  db.query(`
    CREATE TABLE IF NOT EXISTS payroll_periods (
      id            INT AUTO_INCREMENT PRIMARY KEY,
      period_name   VARCHAR(100) NOT NULL UNIQUE,
      start_date    DATE NOT NULL,
      end_date      DATE NOT NULL,
      pay_date      DATE,
      status        ENUM('open','processing','closed','paid') NOT NULL DEFAULT 'open',
      created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `, (err) => {
    if (err) console.error('Payroll periods table error:', err);
    else     console.log('âœ… Table "payroll_periods" ready');
    payrollPeriodsTableReady = !err;
    initializePayrollTables();
  });

  db.query(`
    INSERT IGNORE INTO chart_of_accounts (account_code, account_name, account_type)
    VALUES
      ('1000', 'Cash and Cash Equivalents', 'asset'),
      ('2000', 'Accounts Payable', 'liability'),
      ('3000', 'Owner\\'s Equity', 'equity'),
      ('4000', 'Service Revenue', 'revenue'),
      ('5000', 'Operating Expenses', 'expense')
  `, (err) => {
    if (err) console.error('Seed chart of accounts error:', err);
  });

  db.query(`
    INSERT IGNORE INTO departments (department_name, description)
    VALUES
      ('Operations', 'Operational delivery team'),
      ('Administration', 'Administrative and support team'),
      ('Human Resources', 'People operations'),
      ('Finance', 'Finance and accounting')
  `, (err) => {
    if (err) console.error('Seed departments error:', err);
  });

  addIndexIfMissing('ALTER TABLE vendors ADD INDEX idx_vendors_vendor_name (vendor_name)', 'vendors.vendor_name');
  addIndexIfMissing('ALTER TABLE vendors ADD UNIQUE INDEX idx_vendors_vendor_no (vendor_no)', 'vendors.vendor_no');
  addIndexIfMissing('ALTER TABLE products ADD INDEX idx_products_name (name)', 'products.name');
  addIndexIfMissing('ALTER TABLE projects ADD INDEX idx_projects_project_name (project_name)', 'projects.project_name');
  addIndexIfMissing('ALTER TABLE purchase_orders ADD INDEX idx_purchase_orders_po_date (po_date)', 'purchase_orders.po_date');
  addIndexIfMissing('ALTER TABLE purchase_orders ADD INDEX idx_purchase_orders_project_id (project_id)', 'purchase_orders.project_id');
  addIndexIfMissing('ALTER TABLE accounts_payable ADD INDEX idx_accounts_payable_bill_date_created_at (bill_date, created_at)', 'accounts_payable bill date');
  addIndexIfMissing('ALTER TABLE accounts_payable ADD INDEX idx_accounts_payable_project_id (project_id)', 'accounts_payable.project_id');
  addIndexIfMissing('ALTER TABLE accounts_receivable ADD INDEX idx_accounts_receivable_invoice_date_created_at (invoice_date, created_at)', 'accounts_receivable invoice date');
  addIndexIfMissing('ALTER TABLE purchase_requisitions ADD INDEX idx_purchase_requisitions_created_at (created_at)', 'purchase_requisitions.created_at');
  addIndexIfMissing('ALTER TABLE goods_receipts ADD INDEX idx_goods_receipts_received_date (received_date)', 'goods_receipts.received_date');
  addIndexIfMissing('ALTER TABLE journal_entries ADD INDEX idx_journal_entries_created_at (created_at)', 'journal_entries.created_at');
  addIndexIfMissing('ALTER TABLE stock_movements ADD INDEX idx_stock_movements_created_at (created_at)', 'stock_movements.created_at');
  addIndexIfMissing('ALTER TABLE employees ADD INDEX idx_employees_full_name (full_name)', 'employees.full_name');
  setTimeout(() => backfillVendorNumbers(), 2000);
}

let payrollPeriodsTableReady = false;
let employeesTableReady = false;
let payrollTablesReady = false;

function initializePayrollTables() {
  if (payrollTablesReady || !payrollPeriodsTableReady || !employeesTableReady) return;
  payrollTablesReady = true;

  db.query(`
    CREATE TABLE IF NOT EXISTS payroll_runs (
      id            INT AUTO_INCREMENT PRIMARY KEY,
      period_id     INT NOT NULL,
      employee_id   INT NOT NULL,
      gross_pay     DECIMAL(12,2) NOT NULL DEFAULT 0,
      deductions    DECIMAL(12,2) NOT NULL DEFAULT 0,
      net_pay       DECIMAL(12,2) NOT NULL DEFAULT 0,
      status        ENUM('draft','approved','paid') NOT NULL DEFAULT 'draft',
      notes        TEXT,
      created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (period_id) REFERENCES payroll_periods(id) ON DELETE CASCADE,
      FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
    )
  `, (err) => {
    if (err) console.error('Payroll runs table error:', err);
    else     console.log('âœ… Table "payroll_runs" ready');
    if (err) return;

    db.query(`
      CREATE TABLE IF NOT EXISTS payroll_run_lines (
        id            INT AUTO_INCREMENT PRIMARY KEY,
        payroll_run_id INT NOT NULL,
        line_type     VARCHAR(100) NOT NULL,
        amount        DECIMAL(12,2) NOT NULL DEFAULT 0,
        created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (payroll_run_id) REFERENCES payroll_runs(id) ON DELETE CASCADE
      )
    `, (lineErr) => {
      if (lineErr) console.error('Payroll run lines table error:', lineErr);
      else     console.log('âœ… Table "payroll_run_lines" ready');
    });
  });
}

// âœ… Logging Helper
function inferAuditModule(action = '') {
  const safeAction = String(action || '').toUpperCase();
  if (safeAction.includes('USER')) return 'users';
  if (safeAction.includes('COMPANY')) return 'company';
  if (safeAction.includes('PURCHASE') || safeAction.includes('REQUISITION') || safeAction.includes('GOODS_RECEIPT')) return 'finance';
  if (safeAction.includes('PROJECT') || safeAction.includes('TRANSACTION')) return 'projects';
  if (safeAction.includes('PAYMENT') || safeAction.includes('RECEIVABLE') || safeAction.includes('BILL') || safeAction.includes('VENDOR')) return 'finance';
  if (safeAction.includes('LOGIN') || safeAction.includes('LOGOUT') || safeAction.includes('PASSWORD')) return 'auth';
  return 'system';
}

function logAction(req, action, details, moduleName = '') {
  const actor = getAuthenticatedUser(req);
  const userId = actor ? actor.id : null;
  const auditModule = String(moduleName || inferAuditModule(action) || '').trim().toLowerCase() || null;
  const clientIp = getClientIp(req);
  db.query('INSERT INTO system_logs (user_id, module, action, details, ip_address) VALUES (?, ?, ?, ?, ?)', 
    [userId, auditModule, action, details, clientIp], (err) => {
      if (err) console.error('Logging error:', err);
    });
}

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function generateCode(prefix) {
  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
  const rand = Math.floor(Math.random() * 9000) + 1000;
  return `${String(prefix || 'DOC').toUpperCase()}-${stamp}-${rand}`;
}

function queryAsync(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.query(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows);
    });
  });
}

function normalizeBusinessEntityId(value) {
  const id = Number(value || 0);
  return Number.isInteger(id) && id > 0 ? id : null;
}

async function getDefaultBusinessEntityId() {
  const defaultRows = await queryAsync(
    "SELECT id FROM business_entities WHERE is_default = 1 AND status = 'active' ORDER BY id ASC LIMIT 1"
  );
  if (defaultRows?.length) return Number(defaultRows[0].id || 0) || null;

  const activeRows = await queryAsync(
    "SELECT id FROM business_entities WHERE status = 'active' ORDER BY id ASC LIMIT 1"
  );
  return activeRows?.length ? Number(activeRows[0].id || 0) || null : null;
}

async function resolveBusinessEntityId(value) {
  const explicitId = normalizeBusinessEntityId(value);
  if (explicitId) {
    const rows = await queryAsync(
      "SELECT id FROM business_entities WHERE id = ? AND status = 'active' LIMIT 1",
      [explicitId]
    );
    if (!rows.length) throw new Error('Selected operating company was not found.');
    return explicitId;
  }
  return getDefaultBusinessEntityId();
}

function normalizeBusinessEntitySequenceCode(value, fallback = 'ENT') {
  const source = String(value || fallback || 'ENT').trim();
  let code = source.replace(/^ENT-\d+\s*/i, '').replace(/[^a-z0-9]/gi, '').toUpperCase();
  if (/KVSK/i.test(source)) code = 'KVSK';
  if (/KITSI|KINAADMAN/i.test(source)) code = 'KITSI';
  return (code || 'ENT').slice(0, 6);
}

async function getBusinessEntitySequenceCode(businessEntityId, dbClient = null) {
  const id = normalizeBusinessEntityId(businessEntityId) || await getDefaultBusinessEntityId();
  if (!id) return { id: null, code: 'ENT' };
  const rows = await queryDbAsync(
    dbClient,
    'SELECT id, entity_code, company_name FROM business_entities WHERE id = ? LIMIT 1',
    [id]
  );
  const row = rows?.[0] || {};
  const entityCode = String(row.entity_code || '').trim();
  const companyName = String(row.company_name || '').trim();
  const sequenceSource = /^ENT-\d+$/i.test(entityCode) && companyName
    ? companyName
    : (entityCode || companyName || `ENT${id}`);
  return {
    id,
    code: normalizeBusinessEntitySequenceCode(sequenceSource)
  };
}

async function generateNextEntityDocumentNo({
  businessEntityId,
  documentType,
  prefix,
  tableName,
  columnName,
  dbClient = null,
  pad = 3,
  periodKey = getManilaYmd().slice(0, 4)
}) {
  const safeTables = new Set([
    'projects',
    'transactions',
    'service_orders',
    'purchase_requisitions',
    'purchase_orders',
    'accounts_payable'
  ]);
  const safeColumns = new Set([
    'project_docno',
    'docno',
    'so_number',
    'pr_number',
    'po_number',
    'bill_number'
  ]);
  if (!safeTables.has(tableName) || !safeColumns.has(columnName)) {
    throw new Error('Invalid document sequence target.');
  }

  const entity = await getBusinessEntitySequenceCode(businessEntityId, dbClient);
  const resolvedEntityId = entity.id || await getDefaultBusinessEntityId();
  const docPrefix = String(prefix || documentType || 'DOC').replace(/[^a-z0-9]/gi, '').toUpperCase();
  const period = String(periodKey || getManilaYmd().slice(0, 4)).replace(/[^0-9]/g, '').slice(0, 8) || getManilaYmd().slice(0, 4);
  const codePrefix = `${docPrefix}-${entity.code}-${period}`;
  const sequenceKey = `${String(documentType || docPrefix).toLowerCase()}:${resolvedEntityId || 'default'}`;

  const existingRows = await queryDbAsync(
    dbClient,
    `SELECT COALESCE(MAX(CAST(SUBSTRING_INDEX(${columnName}, '-', -1) AS UNSIGNED)), 0) AS max_no
     FROM ${tableName}
     WHERE business_entity_id ${resolvedEntityId ? '= ?' : 'IS NULL'}
       AND ${columnName} LIKE ?`,
    resolvedEntityId ? [resolvedEntityId, `${codePrefix}-%`] : [`${codePrefix}-%`]
  );
  const initialValue = Number(existingRows?.[0]?.max_no || 0) + 1;

  try {
    await queryDbAsync(
      dbClient,
      `INSERT INTO document_sequences (sequence_key, period_key, last_value)
       VALUES (?, ?, LAST_INSERT_ID(?))
       ON DUPLICATE KEY UPDATE last_value = LAST_INSERT_ID(GREATEST(last_value + 1, VALUES(last_value)))`,
      [sequenceKey, period, initialValue]
    );
    const sequenceRows = await queryDbAsync(dbClient, 'SELECT LAST_INSERT_ID() AS next_value');
    const nextNum = Number(sequenceRows?.[0]?.next_value || 0) || initialValue;
    return `${codePrefix}-${String(nextNum).padStart(pad, '0')}`;
  } catch (err) {
    if (String(err?.code || '').toUpperCase() !== 'ER_NO_SUCH_TABLE') throw err;
    return `${codePrefix}-${String(initialValue).padStart(pad, '0')}`;
  }
}

async function peekNextEntityDocumentNo({
  businessEntityId,
  documentType,
  prefix,
  tableName,
  columnName,
  dbClient = null,
  pad = 3,
  periodKey = getManilaYmd().slice(0, 4)
}) {
  const safeTables = new Set([
    'projects',
    'transactions',
    'service_orders',
    'purchase_requisitions',
    'purchase_orders',
    'accounts_payable'
  ]);
  const safeColumns = new Set([
    'project_docno',
    'docno',
    'so_number',
    'pr_number',
    'po_number',
    'bill_number'
  ]);
  if (!safeTables.has(tableName) || !safeColumns.has(columnName)) {
    throw new Error('Invalid document sequence target.');
  }

  const entity = await getBusinessEntitySequenceCode(businessEntityId, dbClient);
  const resolvedEntityId = entity.id || await getDefaultBusinessEntityId();
  const docPrefix = String(prefix || documentType || 'DOC').replace(/[^a-z0-9]/gi, '').toUpperCase();
  const period = String(periodKey || getManilaYmd().slice(0, 4)).replace(/[^0-9]/g, '').slice(0, 8) || getManilaYmd().slice(0, 4);
  const codePrefix = `${docPrefix}-${entity.code}-${period}`;

  const existingRows = await queryDbAsync(
    dbClient,
    `SELECT COALESCE(MAX(CAST(SUBSTRING_INDEX(${columnName}, '-', -1) AS UNSIGNED)), 0) AS max_no
     FROM ${tableName}
     WHERE business_entity_id ${resolvedEntityId ? '= ?' : 'IS NULL'}
       AND ${columnName} LIKE ?`,
    resolvedEntityId ? [resolvedEntityId, `${codePrefix}-%`] : [`${codePrefix}-%`]
  );
  const nextNum = Number(existingRows?.[0]?.max_no || 0) + 1;
  return `${codePrefix}-${String(nextNum).padStart(pad, '0')}`;
}

function peekNextProjectDocno(callback, businessEntityId = null) {
  peekNextEntityDocumentNo({
    businessEntityId,
    documentType: 'project-docno',
    prefix: 'PRJ',
    tableName: 'projects',
    columnName: 'project_docno'
  })
    .then((projectDocno) => callback(null, projectDocno))
    .catch((err) => callback(err));
}

async function backfillDefaultBusinessEntityLinks() {
  try {
    const defaultId = await getDefaultBusinessEntityId();
    if (!defaultId) return;
    const targets = [
      'company_registry',
      'projects',
      'service_orders',
      'transactions',
      'purchase_requisitions',
      'purchase_orders',
      'accounts_payable',
      'accounts_receivable'
    ];
    for (const tableName of targets) {
      await queryAsync(`UPDATE ${tableName} SET business_entity_id = ? WHERE business_entity_id IS NULL`, [defaultId]);
    }
  } catch (err) {
    if (!['ER_NO_SUCH_TABLE', 'ER_BAD_FIELD_ERROR'].includes(err?.code)) {
      console.error('Business entity backfill error:', err);
    }
  }
}

setTimeout(() => {
  backfillDefaultBusinessEntityLinks().catch((err) => {
    console.error('Business entity backfill init error:', err);
  });
}, 2500);

async function getNextProjectTransactionNo(projectId, excludeTransactionId = null, dbClient = null) {
  const pid = Number(projectId || 0);
  if (!pid) return null;

  const excludeId = Number(excludeTransactionId || 0);
  const sql = excludeId
    ? 'SELECT COALESCE(MAX(project_tx_no), 0) + 1 AS next_no FROM transactions WHERE project_id = ? AND id <> ?'
    : 'SELECT COALESCE(MAX(project_tx_no), 0) + 1 AS next_no FROM transactions WHERE project_id = ?';
  const rows = await queryDbAsync(dbClient, sql, excludeId ? [pid, excludeId] : [pid]);
  return Number(rows?.[0]?.next_no || 1) || 1;
}

async function resolveProjectTransactionNo(projectId, existingProjectId = null, existingProjectTxNo = null, excludeTransactionId = null, dbClient = null) {
  const pid = Number(projectId || 0);
  if (!pid) return null;

  if (Number(existingProjectId || 0) === pid && Number(existingProjectTxNo || 0) > 0) {
    return Number(existingProjectTxNo || 0) || null;
  }

  return getNextProjectTransactionNo(pid, excludeTransactionId, dbClient);
}

async function syncTransactionProjectLink(transactionId, projectId, dbClient = null) {
  const tid = Number(transactionId || 0);
  const pid = Number(projectId || 0);
  if (!tid || !pid) return null;

  const ownsConnection = !dbClient;
  const connection = dbClient || await getConnectionAsync();

  try {
    if (ownsConnection) {
      await beginTransactionAsync(connection);
    }

    const currentRows = await connectionQueryAsync(
      connection,
      'SELECT project_id, project_tx_no FROM transactions WHERE id = ? LIMIT 1 FOR UPDATE',
      [tid]
    );
    const currentRow = currentRows?.[0] || null;
    const projectTxNo = await resolveProjectTransactionNo(
      pid,
      currentRow?.project_id || null,
      currentRow?.project_tx_no || null,
      tid,
      connection
    );

    await connectionQueryAsync(
      connection,
      'UPDATE transactions SET project_id = ?, project_tx_no = ? WHERE id = ?',
      [pid, projectTxNo, tid]
    );

    if (ownsConnection) {
      await commitTransactionAsync(connection);
    }

    return projectTxNo;
  } catch (err) {
    if (ownsConnection) {
      try {
        await rollbackTransactionAsync(connection);
      } catch (rollbackErr) {
        console.error('Project transaction sync rollback error:', rollbackErr);
      }
    }
    throw err;
  } finally {
    if (ownsConnection && connection) {
      connection.release();
    }
  }
}

function getConnectionAsync() {
  return new Promise((resolve, reject) => {
    if (!db) return reject(new Error('Database pool not ready.'));
    db.getConnection((err, connection) => {
      if (err) return reject(err);
      resolve(connection);
    });
  });
}

function connectionQueryAsync(connection, sql, params = []) {
  return new Promise((resolve, reject) => {
    connection.query(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows);
    });
  });
}

function queryDbAsync(dbClient, sql, params = []) {
  if (dbClient && typeof dbClient.query === 'function') {
    return connectionQueryAsync(dbClient, sql, params);
  }
  return queryAsync(sql, params);
}

function beginTransactionAsync(connection) {
  return new Promise((resolve, reject) => {
    connection.beginTransaction((err) => {
      if (err) return reject(err);
      return resolve();
    });
  });
}

function commitTransactionAsync(connection) {
  return new Promise((resolve, reject) => {
    connection.commit((err) => {
      if (err) return reject(err);
      return resolve();
    });
  });
}

function rollbackTransactionAsync(connection) {
  return new Promise((resolve) => {
    connection.rollback(() => resolve());
  });
}

async function getDefaultWarehouseId() {
  const rows = await queryAsync('SELECT id FROM warehouses WHERE is_active = TRUE ORDER BY id ASC LIMIT 1');
  return Number(rows?.[0]?.id || 0) || null;
}

async function getInventoryProductById(productId) {
  const pid = Number(productId || 0);
  if (!pid) return null;
  const rows = await queryAsync(
    'SELECT id, sku, name, category, description, unit_price, reorder_level FROM products WHERE id = ? AND is_active = TRUE LIMIT 1',
    [pid]
  );
  return rows?.[0] || null;
}

async function applyInventoryStockChange({
  productId,
  quantity,
  movementType,
  referenceDoc = null,
  transactionId = null,
  notes = null,
  warehouseId = null
}) {
  const pid = Number(productId || 0);
  const qty = Number(quantity || 0);
  if (!pid || !qty) return null;

  const wid = Number(warehouseId || 0) || await getDefaultWarehouseId();
  if (!wid) {
    throw new Error('Walang active warehouse para sa inventory movement.');
  }

  const nextMovementType = movementType === 'inbound' ? 'inbound' : 'outbound';
  const qtyChange = nextMovementType === 'inbound' ? qty : -qty;

  await queryAsync(
    'INSERT IGNORE INTO stock (product_id, warehouse_id, quantity) VALUES (?, ?, 0)',
    [pid, wid]
  );

  if (qtyChange < 0) {
    const rows = await queryAsync(
      'SELECT quantity FROM stock WHERE product_id = ? AND warehouse_id = ? LIMIT 1',
      [pid, wid]
    );
    const currentQty = Number(rows?.[0]?.quantity || 0);
    if ((currentQty + qtyChange) < 0) {
      throw new Error('Insufficient stock para sa selected item.');
    }
  }

  await queryAsync(
    `INSERT INTO stock_movements
      (product_id, warehouse_id, movement_type, quantity, reference_doc, transaction_id, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [pid, wid, nextMovementType, qty, referenceDoc || null, transactionId || null, notes || null]
  );

  await queryAsync(
    'UPDATE stock SET quantity = quantity + ? WHERE product_id = ? AND warehouse_id = ?',
    [qtyChange, pid, wid]
  );

  return { productId: pid, warehouseId: wid, quantity: qty, movementType: nextMovementType, qtyChange };
}

function getInventorySignedQuantity(type, quantity) {
  const qty = Math.abs(Number(quantity || 0));
  return String(type || '').toLowerCase() === 'receipt' ? qty : -qty;
}

async function canApplyInventoryStockChange(productId, signedQuantity, warehouseId = null) {
  const pid = Number(productId || 0);
  const signedQty = Number(signedQuantity || 0);
  if (!pid || !signedQty || signedQty > 0) return true;

  const wid = Number(warehouseId || 0) || await getDefaultWarehouseId();
  if (!wid) {
    throw new Error('Walang active warehouse para sa inventory check.');
  }

  const rows = await queryAsync(
    'SELECT quantity FROM stock WHERE product_id = ? AND warehouse_id = ? LIMIT 1',
    [pid, wid]
  );
  const currentQty = Number(rows?.[0]?.quantity || 0);
  if ((currentQty + signedQty) < 0) {
    throw new Error('Insufficient stock para sa selected item.');
  }
  return true;
}

function backfillTransactionProjectLinks(callback) {
  const done = typeof callback === 'function' ? callback : () => {};
  if (!db) return done(new Error('Database pool not ready.'));

  db.query(`
    UPDATE transactions t
    JOIN projects p
      ON p.transaction_id = t.id
      OR (
        p.source_docno IS NOT NULL
        AND p.source_docno <> ''
        AND LOWER(TRIM(p.source_docno)) = LOWER(TRIM(t.docno))
      )
    SET t.project_id = p.id
    WHERE t.project_id IS NULL
  `, async (err) => {
    if (err) {
      console.error('Transaction project_id backfill error:', err);
      return done(err);
    }

    try {
      const rows = await queryAsync(`
        SELECT id, project_id
        FROM transactions
        WHERE COALESCE(project_id, 0) > 0
        ORDER BY project_id ASC, id ASC
      `);

      let currentProjectId = null;
      let seq = 0;

      for (const row of rows || []) {
        const projectId = Number(row.project_id || 0);
        if (!projectId) continue;
        if (currentProjectId !== projectId) {
          currentProjectId = projectId;
          seq = 0;
        }
        seq += 1;
        await queryAsync('UPDATE transactions SET project_tx_no = ? WHERE id = ?', [seq, row.id]);
      }

      done(null);
    } catch (seqErr) {
      console.error('Transaction project sequence backfill error:', seqErr);
      done(seqErr);
    }
  });
}

function csvEscape(value) {
  const str = String(value ?? '');
  return `"${str.replace(/"/g, '""')}"`;
}

function htmlEscape(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function sendCsvResponse(res, filename, headers, rows) {
  const lines = [headers.map(csvEscape).join(',')];
  for (const row of rows) {
    lines.push(headers.map((header) => csvEscape(row?.[header] ?? '')).join(','));
  }

  const csv = `\ufeff${lines.join('\r\n')}`;
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(csv);
}

function sendHtmlSpreadsheetResponse(res, filename, title, headers, rows) {
  const tableRows = rows.map((row) => `
    <tr>
      ${headers.map((header) => `<td>${htmlEscape(row?.[header] ?? '')}</td>`).join('')}
    </tr>
  `).join('');

  const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${htmlEscape(title)}</title>
  <style>
    body { font-family: Arial, sans-serif; color: #111827; }
    h1 { font-size: 18px; margin: 0 0 12px; }
    .meta { margin: 0 0 14px; color: #6b7280; font-size: 12px; }
    table { border-collapse: collapse; width: 100%; }
    th, td { border: 1px solid #d1d5db; padding: 6px 8px; font-size: 12px; text-align: left; vertical-align: top; }
    th { background: #f3f4f6; font-weight: 700; }
  </style>
</head>
<body>
  <h1>${htmlEscape(title)}</h1>
  <div class="meta">Generated at ${htmlEscape(new Date().toLocaleString('en-PH'))}</div>
  <table>
    <thead><tr>${headers.map((header) => `<th>${htmlEscape(header)}</th>`).join('')}</tr></thead>
    <tbody>${tableRows}</tbody>
  </table>
</body>
</html>`;

  res.setHeader('Content-Type', 'application/vnd.ms-excel; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(`\ufeff${html}`);
}

function wrapExportText(value, maxLength = 96) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return [''];
  if (text.length <= maxLength) return [text];

  const parts = [];
  let remaining = text;
  while (remaining.length > maxLength) {
    let cut = remaining.lastIndexOf(' ', maxLength);
    if (cut < Math.floor(maxLength / 2)) cut = maxLength;
    parts.push(remaining.slice(0, cut).trim());
    remaining = remaining.slice(cut).trim();
  }
  if (remaining) parts.push(remaining);
  return parts;
}

function escapePdfText(value) {
  return String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)')
    .replace(/\r?\n/g, ' ')
    .replace(/[^\x20-\x7E]/g, '?');
}

function buildSimplePdfBuffer({ title, subtitle = '', headers = [], rows = [] }) {
  const rawLines = [];
  if (title) rawLines.push(String(title));
  if (subtitle) rawLines.push(String(subtitle));
  if (headers.length) rawLines.push(headers.join(' | '));

  rows.forEach((row) => {
    rawLines.push(headers.map((header) => String(row?.[header] ?? '')).join(' | '));
  });

  const lines = [];
  rawLines.forEach((line) => {
    wrapExportText(line, 100).forEach((part) => lines.push(part));
  });

  const maxLinesPerPage = 42;
  const pages = [];
  for (let i = 0; i < lines.length; i += maxLinesPerPage) {
    pages.push(lines.slice(i, i + maxLinesPerPage));
  }
  if (!pages.length) pages.push(['No data found.']);

  const objectStrings = [];
  objectStrings.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');

  const pageCount = pages.length;
  const pageObjectNumbers = [];
  for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
    const contentObjectNumber = objectStrings.length + 1;
    const pageObjectNumber = objectStrings.length + 2;
    pageObjectNumbers.push(pageObjectNumber);

    const pageLines = pages[pageIndex];
    const contentLines = ['BT', '/F1 10 Tf'];
    let y = 760;
    pageLines.forEach((line) => {
      contentLines.push(`1 0 0 1 50 ${y} Tm (${escapePdfText(line)}) Tj`);
      y -= 14;
    });
    contentLines.push('ET');
    const contentStream = contentLines.join('\n');
    objectStrings.push(`<< /Length ${Buffer.byteLength(contentStream, 'utf8')} >>\nstream\n${contentStream}\nendstream`);
    objectStrings.push(`<< /Type /Page /Parent ${pageCount * 2 + 2} 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 1 0 R >> >> /Contents ${contentObjectNumber} 0 R >>`);
  }

  const pagesObjectNumber = objectStrings.length + 1;
  const catalogObjectNumber = objectStrings.length + 2;
  objectStrings.push(`<< /Type /Pages /Kids [${pageObjectNumbers.map((num) => `${num} 0 R`).join(' ')}] /Count ${pageCount} >>`);
  objectStrings.push(`<< /Type /Catalog /Pages ${pagesObjectNumber} 0 R >>`);

  let pdf = '%PDF-1.4\n';
  const offsets = ['0000000000 65535 f \n'];
  objectStrings.forEach((body, index) => {
    offsets.push(`${String(pdf.length).padStart(10, '0')} 00000 n \n`);
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });

  const xrefStart = pdf.length;
  pdf += `xref\n0 ${objectStrings.length + 1}\n`;
  pdf += offsets.join('');
  pdf += `trailer\n<< /Size ${objectStrings.length + 1} /Root ${catalogObjectNumber} 0 R >>\n`;
  pdf += `startxref\n${xrefStart}\n%%EOF`;
  return Buffer.from(pdf, 'binary');
}

function sendPdfTableResponse(res, filename, title, headers, rows, subtitle = '') {
  const pdf = buildSimplePdfBuffer({ title, subtitle, headers, rows });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(pdf);
}

// ==================== AUTH MIDDLEWARE ====================
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
  if (user && (user.role === 'admin' || user.role === 'staff')) {
    return next();
  }
  return rejectUnauthorized(req, res);
}

function protectAdminOnly(req, res, next) {
  const user = getAuthenticatedUser(req);
  if (user && user.role === 'admin') {
    return next();
  }

  if (isApiRequest(req)) {
    return res.status(403).json({ error: 'Access denied' });
  }
  return rejectUnauthorized(req, res);
}

function sendTransactionPdf(req, res, whereClause, params) {
  db.query(
    `SELECT id, docno, pdfFilename FROM transactions WHERE ${whereClause} LIMIT 1`,
    params,
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!rows.length || !rows[0].pdfFilename) {
        return res.status(404).json({ error: 'PDF not found' });
      }

      const record = rows[0];
      const safeFilename = path.basename(record.pdfFilename);
      const filePath = path.join(UPLOAD_DIR, safeFilename);

      if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: 'PDF file missing on disk' });
      }

      noCache(res);
      res.type('application/pdf');
      if (req.query.download === '1') {
        return res.download(filePath, safeFilename);
      }

      res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(safeFilename)}"`);
      return res.sendFile(filePath);
    }
  );
}

function sendBillPdf(req, res, billId) {
  db.query(
    'SELECT id, bill_number, pdfFilename FROM accounts_payable WHERE id = ? LIMIT 1',
    [billId],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!rows.length || !rows[0].pdfFilename) {
        return res.status(404).json({ error: 'PDF not found' });
      }

      const record = rows[0];
      const safeFilename = path.basename(record.pdfFilename);
      const filePath = path.join(UPLOAD_DIR, safeFilename);

      if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: 'PDF file missing on disk' });
      }

      noCache(res);
      res.type('application/pdf');
      if (req.query.download === '1') {
        return res.download(filePath, safeFilename);
      }

      res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(safeFilename)}"`);
      return res.sendFile(filePath);
    }
  );
}

function sendProjectPdf(req, res, projectId) {
  db.query(
    'SELECT id, project_docno, pdfFilename FROM projects WHERE id = ? LIMIT 1',
    [projectId],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!rows.length || !rows[0].pdfFilename) {
        return res.status(404).json({ error: 'PDF not found' });
      }

      const record = rows[0];
      const safeFilename = path.basename(record.pdfFilename);
      const filePath = path.join(UPLOAD_DIR, safeFilename);

      if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: 'PDF file missing on disk' });
      }

      noCache(res);
      res.type('application/pdf');
      if (req.query.download === '1') {
        return res.download(filePath, safeFilename);
      }

      res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(safeFilename)}"`);
      return res.sendFile(filePath);
    }
  );
}

function sendServiceOrderPdf(req, res, serviceOrderId) {
  db.query(
    'SELECT id, so_number, pdfFilename FROM service_orders WHERE id = ? LIMIT 1',
    [serviceOrderId],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!rows.length || !rows[0].pdfFilename) {
        return res.status(404).json({ error: 'PDF not found' });
      }

      const record = rows[0];
      const safeFilename = path.basename(record.pdfFilename);
      const filePath = path.join(UPLOAD_DIR, safeFilename);

      if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: 'PDF file missing on disk' });
      }

      noCache(res);
      res.type('application/pdf');
      if (req.query.download === '1') {
        return res.download(filePath, safeFilename);
      }

      res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(safeFilename)}"`);
      return res.sendFile(filePath);
    }
  );
}

function normalizeServiceOrderStatusValue(status) {
  const normalized = String(status || 'draft').trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (normalized === 'inprogress') return 'in_progress';
  if (normalized === 'canceled') return 'cancelled';
  const allowed = new Set(['draft', 'issued', 'accepted', 'in_progress', 'completed', 'cancelled']);
  return allowed.has(normalized) ? normalized : 'draft';
}

async function resolveServiceOrderCompanyRecord(input, projectRow = null, dbClient = null) {
  const explicitCompanyId = Number(input?.company_id || 0);
  if (explicitCompanyId) {
    const explicitRows = await queryDbAsync(
      dbClient,
      'SELECT id, company_no, company_name, address, contact_person, phone, email, tin, industry FROM company_registry WHERE id = ? LIMIT 1',
      [explicitCompanyId]
    );
    if (explicitRows.length) {
      const projectCompanyId = Number(projectRow?.company_id || 0);
      if (projectCompanyId && Number(explicitRows[0].id || 0) !== projectCompanyId) {
        throw new Error('Selected company must match the project company.');
      }
      return explicitRows[0];
    }
  }

  const projectCompanyId = Number(projectRow?.company_id || 0);
  if (projectCompanyId) {
    const projectCompanyRows = await queryDbAsync(
      dbClient,
      'SELECT id, company_no, company_name, address, contact_person, phone, email, tin, industry FROM company_registry WHERE id = ? LIMIT 1',
      [projectCompanyId]
    );
    if (projectCompanyRows.length) {
      return projectCompanyRows[0];
    }
  }

  throw new Error('Company selection is required. Please select a company from the search results.');
}

async function resolveServiceOrderVendorRecord(input, companyId, dbClient = null) {
  const explicitVendorId = Number(input?.vendor_id || 0);
  if (!explicitVendorId) {
    throw new Error('Vendor selection is required.');
  }

  const explicitRows = await queryDbAsync(
    dbClient,
    'SELECT id, vendor_name, company_id FROM vendors WHERE id = ? LIMIT 1',
    [explicitVendorId]
  );
  if (!explicitRows.length) {
    throw new Error('Vendor selection is required.');
  }

  const vendorRecord = explicitRows[0];
  const vendorCompanyId = Number(vendorRecord.company_id || 0);
  const normalizedCompanyId = Number(companyId || 0) || 0;

  if (normalizedCompanyId && vendorCompanyId && vendorCompanyId !== normalizedCompanyId) {
    throw new Error('Selected vendor must match the company.');
  }

  return vendorRecord;
}

async function resolveTransactionServiceOrderContext(projectId, serviceOrderId) {
  let normalizedProjectId = Number(projectId || 0) || null;
  let normalizedServiceOrderId = Number(serviceOrderId || 0) || null;
  let serviceOrderRow = null;

  if (normalizedServiceOrderId) {
    const rows = await queryAsync(
      'SELECT id, so_number, service_title, project_id, company_id FROM service_orders WHERE id = ? LIMIT 1',
      [normalizedServiceOrderId]
    );
    if (!rows.length) {
      throw new Error('Selected service order was not found.');
    }

    serviceOrderRow = rows[0];
    const linkedProjectId = Number(serviceOrderRow.project_id || 0) || null;
    if (normalizedProjectId && linkedProjectId && normalizedProjectId !== linkedProjectId) {
      throw new Error('Selected service order must belong to the selected project.');
    }

    if (!normalizedProjectId) {
      normalizedProjectId = linkedProjectId || null;
    }
  }

  return {
    projectId: normalizedProjectId,
    serviceOrderId: normalizedServiceOrderId,
    serviceOrderRow
  };
}

async function resolveTransactionCompanyId(projectId, serviceOrderRow = null) {
  const serviceOrderCompanyId = Number(serviceOrderRow?.company_id || 0) || null;
  if (serviceOrderCompanyId) {
    return serviceOrderCompanyId;
  }

  const normalizedProjectId = Number(projectId || 0) || null;
  if (!normalizedProjectId) {
    return null;
  }

  const rows = await queryAsync(
    'SELECT company_id FROM projects WHERE id = ? LIMIT 1',
    [normalizedProjectId]
  );
  return Number(rows[0]?.company_id || 0) || null;
}

async function createLinkedTransactionForServiceOrder({
  serviceOrderId,
  soNumber,
  projectId = null,
  projectRow = null,
  companyRecord = null,
  businessEntityId = null,
  serviceType = null,
  serviceDate,
  serviceTitle,
  description,
  totalAmount = 0,
  dbClient = null
}) {
  const normalizedProjectId = Number(projectId || 0) || null;
  const resolvedBusinessEntityId = normalizeBusinessEntityId(businessEntityId) || normalizeBusinessEntityId(projectRow?.business_entity_id) || await getDefaultBusinessEntityId();
  const companyId = Number(companyRecord?.id || 0) || null;
  const clientName = String(companyRecord?.company_name || '').trim() || 'Unknown Customer';
  const clientAddress = String(companyRecord?.address || '').trim() || null;
  const clientTin = formatTin(normalizeTin(companyRecord?.tin || '')) || null;
  const clientPhone = normalizePhone(companyRecord?.phone || '');
  const clientBizstyle = String(companyRecord?.industry || '').trim() || null;
  const txDate = String(serviceDate || getManilaYmd()).trim() || getManilaYmd();
  const finalAmount = Number(totalAmount || 0);
  const txServiceType = capitalizeProjectStatus(serviceType || 'installation');
  const txDescription = [txServiceType, String(description || serviceTitle || '').trim() || `Service Order ${soNumber}`]
    .filter(Boolean)
    .join(' - ');
  const projectTxNo = normalizedProjectId ? await getNextProjectTransactionNo(normalizedProjectId, null, dbClient) : null;
  const docno = await generateNextTransactionDocnoAsync(dbClient, resolvedBusinessEntityId);

  const insertResult = await queryDbAsync(
    dbClient,
    `INSERT INTO transactions
      (docno, type, client, address, tin, bizstyle, phone,
       description, archived, archived_auto, qty, unitprice, amount, downpayment, checkno, pono, date,
       project_start_date, project_end_date, status, pdfFilename, business_entity_id, project_id, company_id, service_order_id, project_tx_no,
       project_members, member_role, member_phone,
       project_members_2, member_role_2, member_phone_2,
       project_members_3, member_role_3, member_phone_3)
     VALUES (${Array(35).fill('?').join(', ')})`,
    [
      docno,
      'invoice',
      clientName,
      clientAddress,
      clientTin,
      clientBizstyle,
      clientPhone || null,
      txDescription,
      0,
      0,
      1,
      finalAmount || null,
      finalAmount,
      0,
      null,
      null,
      txDate,
      String(projectRow?.start_date || projectRow?.planned_start_date || projectRow?.actual_start_date || '').trim() || null,
      String(projectRow?.end_date || projectRow?.planned_end_date || projectRow?.actual_end_date || '').trim() || null,
      'unpaid',
      null,
      resolvedBusinessEntityId,
      normalizedProjectId,
      companyId,
      Number(serviceOrderId || 0) || null,
      projectTxNo,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null
    ]
  );

  const transactionId = Number(insertResult?.insertId || 0) || null;
  if (!transactionId) {
    throw new Error('Unable to create linked transaction.');
  }

  const linkedTransaction = {
    id: transactionId,
    type: 'invoice',
    client: clientName,
    address: clientAddress,
    tin: clientTin,
    bizstyle: clientBizstyle,
    phone: clientPhone || null,
    description: txDescription,
    archived: 0,
    qty: 1,
    unitprice: finalAmount || null,
    amount: finalAmount,
    downpayment: 0,
    checkno: null,
    pono: null,
    date: txDate,
    project_start_date: String(projectRow?.start_date || projectRow?.planned_start_date || projectRow?.actual_start_date || '').trim() || null,
    project_end_date: String(projectRow?.end_date || projectRow?.planned_end_date || projectRow?.actual_end_date || '').trim() || null,
    status: 'unpaid',
    pdfFilename: null,
    business_entity_id: resolvedBusinessEntityId,
    project_id: normalizedProjectId,
    company_id: companyId,
    service_order_id: Number(serviceOrderId || 0) || null,
    service_order_no: soNumber,
    project_tx_no: projectTxNo
  };

  await new Promise((resolve, reject) => {
    syncReceivableForTransaction(linkedTransaction, (syncErr) => {
      if (syncErr) return reject(syncErr);
      return resolve(null);
    }, dbClient);
  });

  return {
    id: transactionId,
    docno,
    company_id: companyId,
    project_tx_no: projectTxNo
  };
}

async function syncLinkedTransactionForServiceOrder({
  serviceOrderId,
  soNumber,
  projectId = null,
  projectRow = null,
  companyRecord = null,
  businessEntityId = null,
  serviceType = null,
  serviceDate,
  serviceTitle,
  description,
  totalAmount = 0,
  dbClient = null
}) {
  const normalizedServiceOrderId = Number(serviceOrderId || 0) || 0;
  if (!normalizedServiceOrderId) {
    throw new Error('Invalid service order id.');
  }

  const linkedRows = await queryDbAsync(
    dbClient,
    `SELECT id, docno, status, downpayment, checkno, pono, pdfFilename, project_id, project_tx_no
     FROM transactions
     WHERE service_order_id = ? AND COALESCE(archived, 0) = 0
     ORDER BY id DESC
     LIMIT 1 FOR UPDATE`,
    [normalizedServiceOrderId]
  );

  if (!linkedRows.length) {
    return createLinkedTransactionForServiceOrder({
      serviceOrderId: normalizedServiceOrderId,
      soNumber,
      projectId,
      projectRow,
      companyRecord,
      businessEntityId,
      serviceType,
      serviceDate,
      serviceTitle,
      description,
      totalAmount,
      dbClient
    });
  }

  const linkedRow = linkedRows[0];
  const normalizedProjectId = Number(projectId || 0) || null;
  const resolvedBusinessEntityId = normalizeBusinessEntityId(businessEntityId) || normalizeBusinessEntityId(projectRow?.business_entity_id) || await getDefaultBusinessEntityId();
  const companyId = Number(companyRecord?.id || 0) || null;
  const clientName = String(companyRecord?.company_name || '').trim() || 'Unknown Customer';
  const clientAddress = String(companyRecord?.address || '').trim() || null;
  const clientTin = formatTin(normalizeTin(companyRecord?.tin || '')) || null;
  const clientPhone = normalizePhone(companyRecord?.phone || '');
  const clientBizstyle = String(companyRecord?.industry || '').trim() || null;
  const txDate = String(serviceDate || getManilaYmd()).trim() || getManilaYmd();
  const finalAmount = Number(totalAmount || 0);
  const txServiceType = capitalizeProjectStatus(serviceType || 'installation');
  const txDescription = [txServiceType, String(description || serviceTitle || '').trim() || `Service Order ${soNumber}`]
    .filter(Boolean)
    .join(' - ');
  const projectTxNo = normalizedProjectId
    ? await resolveProjectTransactionNo(
        normalizedProjectId,
        Number(linkedRow.project_id || 0) || null,
        Number(linkedRow.project_tx_no || 0) || null,
        Number(linkedRow.id || 0) || null,
        dbClient
      )
    : null;

  await queryDbAsync(
    dbClient,
    `UPDATE transactions SET
      type = ?, client = ?, address = ?, tin = ?, bizstyle = ?, phone = ?,
      description = ?, qty = ?, unitprice = ?, amount = ?, business_entity_id = ?, project_id = ?, company_id = ?,
      service_order_id = ?, project_tx_no = ?, project_start_date = ?, project_end_date = ?, date = ?, status = ?
     WHERE id = ?`,
    [
      'invoice',
      clientName,
      clientAddress,
      clientTin,
      clientBizstyle,
      clientPhone || null,
      txDescription,
      1,
      finalAmount || null,
      finalAmount,
      resolvedBusinessEntityId,
      normalizedProjectId,
      companyId,
      normalizedServiceOrderId,
      projectTxNo,
      String(projectRow?.start_date || projectRow?.planned_start_date || projectRow?.actual_start_date || '').trim() || null,
      String(projectRow?.end_date || projectRow?.planned_end_date || projectRow?.actual_end_date || '').trim() || null,
      txDate,
      normalizeTransactionStatusValue(linkedRow.status || 'unpaid') || 'unpaid',
      Number(linkedRow.id || 0) || 0
    ]
  );

  const updatedTransaction = {
    id: Number(linkedRow.id || 0) || null,
    docno: String(linkedRow.docno || '').trim() || null,
    type: 'invoice',
    client: clientName,
    address: clientAddress,
    tin: clientTin,
    bizstyle: clientBizstyle,
    phone: clientPhone || null,
    description: txDescription,
    archived: 0,
    qty: 1,
    unitprice: finalAmount || null,
    amount: finalAmount,
    downpayment: Number(linkedRow.downpayment || 0),
    checkno: linkedRow.checkno || null,
    pono: linkedRow.pono || null,
    date: txDate,
    project_start_date: String(projectRow?.start_date || projectRow?.planned_start_date || projectRow?.actual_start_date || '').trim() || null,
    project_end_date: String(projectRow?.end_date || projectRow?.planned_end_date || projectRow?.actual_end_date || '').trim() || null,
    status: normalizeTransactionStatusValue(linkedRow.status || 'unpaid') || 'unpaid',
    pdfFilename: linkedRow.pdfFilename || null,
    business_entity_id: resolvedBusinessEntityId,
    project_id: normalizedProjectId,
    company_id: companyId,
    service_order_id: normalizedServiceOrderId,
    service_order_no: soNumber,
    project_tx_no: projectTxNo
  };

  await new Promise((resolve, reject) => {
    syncReceivableForTransaction(updatedTransaction, (syncErr) => {
      if (syncErr) return reject(syncErr);
      return resolve(null);
    }, dbClient);
  });

  return {
    id: Number(linkedRow.id || 0) || null,
    docno: String(linkedRow.docno || '').trim() || null,
    company_id: companyId,
    project_tx_no: projectTxNo
  };
}

app.post('/api/service-orders', protectAdmin, async (req, res) => {
  let soNumber = String(req.body.so_number || req.body.doc_no || '').trim();
  const projectId = Number(req.body.project_id || 0) || null;
  const serviceType = String(req.body.service_type || req.body.serviceType || '').trim().toLowerCase().replace(/[\s-]+/g, '_') || 'installation';
  const serviceDate = String(req.body.service_date || req.body.so_date || '').trim() || new Date().toISOString().slice(0, 10);
  const serviceTitle = String(req.body.service_title || req.body.title || '').trim();
  const description = String(req.body.description || '').trim() || null;
  const notes = String(req.body.notes || '').trim() || null;
  const totalAmount = toNumber(req.body.total_amount ?? req.body.amount, 0);
  const normalizedStatus = normalizeServiceOrderStatusValue(req.body.status || 'issued');
  const status = normalizedStatus === 'draft' ? 'issued' : normalizedStatus;

  if (!serviceTitle) {
    return res.status(400).json({ error: 'Service title is required.' });
  }

  let connection = null;
  try {
    connection = await getConnectionAsync();
    await beginTransactionAsync(connection);

    let projectRow = null;
    if (projectId) {
      const projectRows = await connectionQueryAsync(
        connection,
        'SELECT id, business_entity_id, project_name, company_id, company_no, company_name, client_name FROM projects WHERE id = ? LIMIT 1',
        [projectId]
      );
      if (!projectRows.length) {
        throw Object.assign(new Error('Selected project was not found.'), { statusCode: 400 });
      }
      projectRow = projectRows[0];
    }

    const companyRecord = await resolveServiceOrderCompanyRecord(req.body, projectRow, connection);
    const vendorRecord = await resolveServiceOrderVendorRecord(req.body, companyRecord.id, connection);
    const businessEntityId = await resolveBusinessEntityId(req.body.business_entity_id || projectRow?.business_entity_id || null);
    if (!soNumber) {
      soNumber = await generateNextEntityDocumentNo({
        businessEntityId,
        documentType: 'service-order',
        prefix: 'SO',
        tableName: 'service_orders',
        columnName: 'so_number',
        dbClient: connection
      });
    }

    const insertResult = await connectionQueryAsync(
      connection,
      `INSERT INTO service_orders
        (so_number, business_entity_id, vendor_id, company_id, project_id, service_type, service_date, service_title, description, total_amount, status, notes, pdfFilename, is_archived, archived_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 0, NULL)`,
      [
        soNumber,
        businessEntityId,
        vendorRecord.id,
        companyRecord.id,
        projectId,
        serviceType,
        serviceDate,
        serviceTitle,
        description,
        totalAmount,
        status,
        notes
      ]
    );

    const linkedTransaction = await syncLinkedTransactionForServiceOrder({
      serviceOrderId: insertResult.insertId,
      soNumber,
      projectId,
      projectRow,
      companyRecord,
      businessEntityId,
      serviceType,
      serviceDate,
      serviceTitle,
      description,
      totalAmount,
      dbClient: connection
    });

    await commitTransactionAsync(connection);

    logAction(
      req,
      'CREATE_SERVICE_ORDER',
      `Created service order ${soNumber} and linked transaction ${linkedTransaction.docno}`
    );

    res.json({
      success: true,
      id: insertResult.insertId,
      so_number: soNumber,
      posted_transaction: true,
      linked_transaction_id: linkedTransaction.id || null,
      linked_transaction_docno: linkedTransaction.docno || null
    });
  } catch (err) {
    if (connection) {
      try {
        await rollbackTransactionAsync(connection);
      } catch (rollbackErr) {
        console.error('Service order create rollback error:', rollbackErr);
      }
    }

    if (err.code === 'ER_DUP_ENTRY') {
      const sqlMessage = String(err.sqlMessage || err.message || '').toLowerCase();
      if (sqlMessage.includes('so_number')) {
        return res.status(409).json({ error: 'Service order number already exists.' });
      }
      return res.status(409).json({ error: 'Duplicate service order record.' });
    }

    const validationMessage = String(err?.message || '').toLowerCase();
    if (validationMessage.includes('required') || validationMessage.includes('must match') || validationMessage.includes('not found')) {
      return res.status(400).json({ error: err.message || 'Unable to create service order.' });
    }

    console.error('Create service order error:', err);
    res.status(500).json({ error: err.message || 'Unable to create service order.' });
  } finally {
    if (connection) {
      connection.release();
    }
  }
});

app.put('/api/service-orders/:id', protectAdmin, async (req, res) => {
  const serviceOrderId = Number(req.params.id || 0) || 0;
  if (!serviceOrderId) {
    return res.status(400).json({ error: 'Invalid service order id.' });
  }

  const incomingSoNumber = String(req.body.so_number || req.body.doc_no || '').trim();
  const projectId = Number(req.body.project_id || 0) || null;
  const serviceType = String(req.body.service_type || req.body.serviceType || '').trim().toLowerCase().replace(/[\s-]+/g, '_') || 'installation';
  const serviceDate = String(req.body.service_date || req.body.so_date || '').trim() || new Date().toISOString().slice(0, 10);
  const serviceTitle = String(req.body.service_title || req.body.title || '').trim();
  const description = String(req.body.description || '').trim() || null;
  const notes = String(req.body.notes || '').trim() || null;
  const totalAmount = toNumber(req.body.total_amount ?? req.body.amount, 0);
  const normalizedStatus = normalizeServiceOrderStatusValue(req.body.status || 'issued');
  const status = normalizedStatus === 'draft' ? 'issued' : normalizedStatus;

  if (!serviceTitle) {
    return res.status(400).json({ error: 'Service title is required.' });
  }

  let connection = null;
  try {
    connection = await getConnectionAsync();
    await beginTransactionAsync(connection);

    const currentRows = await connectionQueryAsync(
      connection,
      'SELECT id, so_number, business_entity_id, project_id, company_id, vendor_id, service_type, service_date, service_title, description, total_amount, status, notes, is_archived FROM service_orders WHERE id = ? LIMIT 1 FOR UPDATE',
      [serviceOrderId]
    );
    if (!currentRows.length) {
      throw Object.assign(new Error('Service order not found.'), { statusCode: 404 });
    }

    const currentRow = currentRows[0];
    const finalSoNumber = incomingSoNumber || String(currentRow.so_number || '').trim() || generateCode('SO');

    let projectRow = null;
    if (projectId) {
      const projectRows = await connectionQueryAsync(
        connection,
        'SELECT id, business_entity_id, project_name, company_id, company_no, company_name, client_name FROM projects WHERE id = ? LIMIT 1',
        [projectId]
      );
      if (!projectRows.length) {
        throw Object.assign(new Error('Selected project was not found.'), { statusCode: 400 });
      }
      projectRow = projectRows[0];
    }

    const companyRecord = await resolveServiceOrderCompanyRecord(req.body, projectRow, connection);
    const vendorRecord = await resolveServiceOrderVendorRecord(req.body, companyRecord.id, connection);
    const businessEntityId = await resolveBusinessEntityId(req.body.business_entity_id || projectRow?.business_entity_id || currentRow.business_entity_id || null);

    await connectionQueryAsync(
      connection,
      `UPDATE service_orders
       SET so_number = ?, business_entity_id = ?, vendor_id = ?, company_id = ?, project_id = ?, service_type = ?, service_date = ?, service_title = ?, description = ?, total_amount = ?, status = ?, notes = ?
       WHERE id = ?`,
      [
        finalSoNumber,
        businessEntityId,
        vendorRecord.id,
        companyRecord.id,
        projectId,
        serviceType,
        serviceDate,
        serviceTitle,
        description,
        totalAmount,
        status,
        notes,
        serviceOrderId
      ]
    );

    const linkedTransaction = await syncLinkedTransactionForServiceOrder({
      serviceOrderId,
      soNumber: finalSoNumber,
      projectId,
      projectRow,
      companyRecord,
      businessEntityId,
      serviceType,
      serviceDate,
      serviceTitle,
      description,
      totalAmount,
      dbClient: connection
    });

    await commitTransactionAsync(connection);

    logAction(
      req,
      'UPDATE_SERVICE_ORDER',
      `Updated service order ${finalSoNumber} and synced linked transaction ${linkedTransaction.docno}`
    );

    res.json({
      success: true,
      id: serviceOrderId,
      so_number: finalSoNumber,
      posted_transaction: true,
      linked_transaction_id: linkedTransaction.id || null,
      linked_transaction_docno: linkedTransaction.docno || null
    });
  } catch (err) {
    if (connection) {
      try {
        await rollbackTransactionAsync(connection);
      } catch (rollbackErr) {
        console.error('Service order update rollback error:', rollbackErr);
      }
    }

    if (err.statusCode === 404) {
      return res.status(404).json({ error: err.message || 'Service order not found.' });
    }
    if (err.statusCode === 400) {
      return res.status(400).json({ error: err.message || 'Unable to update service order.' });
    }

    if (err.code === 'ER_DUP_ENTRY') {
      const sqlMessage = String(err.sqlMessage || err.message || '').toLowerCase();
      if (sqlMessage.includes('so_number')) {
        return res.status(409).json({ error: 'Service order number already exists.' });
      }
      return res.status(409).json({ error: 'Duplicate service order record.' });
    }

    const validationMessage = String(err?.message || '').toLowerCase();
    if (validationMessage.includes('required') || validationMessage.includes('must match') || validationMessage.includes('not found')) {
      return res.status(400).json({ error: err.message || 'Unable to update service order.' });
    }

    console.error('Update service order error:', err);
    res.status(500).json({ error: err.message || 'Unable to update service order.' });
  } finally {
    if (connection) {
      connection.release();
    }
  }
});

function getManilaYmd(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);
  const map = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

const PHONE_MIN_DIGITS = 7;
const PHONE_MAX_DIGITS = 15;

function normalizePhone(value) {
  return String(value || '').replace(/\D/g, '');
}

function normalizeTin(value) {
  return String(value || '').replace(/\D/g, '').slice(0, 12);
}

function formatTin(value) {
  const digits = normalizeTin(value);
  if (!digits) return '';
  return digits.match(/.{1,3}/g)?.join('-') || digits;
}

function isValidPhone(value) {
  const phone = String(value || '').trim();
  return /^\d+$/.test(phone) && phone.length >= PHONE_MIN_DIGITS && phone.length <= PHONE_MAX_DIGITS;
}

function isValidEmail(value) {
  const email = String(value || '').trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function buildResetLink(token) {
  return `${APP_BASE_URL}/reset-password/index.html?token=${token}`;
}

// ==================== ROUTES ====================

app.get('/', (req, res) => {
    noCache(res);
    if (req.session.user) {
        if (req.session.user.role === 'admin' || req.session.user.role === 'staff') {
            return res.redirect('/admin');
        }
        return res.redirect('/status');
    }
    res.sendFile(path.join(__dirname, 'public', 'login', 'index.html'), err => {
        if (err) {
            console.error('Error sending login file:', err);
            res.status(404).send('Login page not found');
        }
    });
});

app.get('/login', (req, res) => {
    noCache(res);
    if (req.session.user) {
        if (req.session.user.role === 'admin' || req.session.user.role === 'staff') {
            return res.redirect('/admin');
        }
        return res.redirect('/status');
    }
    res.sendFile(path.join(__dirname, 'public', 'login', 'index.html'));
});

// âœ… No-cache helper â€” para hindi ma-restore ang page via back button / bfcache
function noCache(res) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.setHeader('Surrogate-Control', 'no-store');
}

app.get('/healthz', (req, res) => {
  const payload = {
    status: 'ok',
    uptime: Math.floor(process.uptime()),
    environment: process.env.NODE_ENV || 'development',
    database: db ? 'ready' : 'initializing'
  };

  if (!db) {
    return res.status(503).json(payload);
  }

  db.query('SELECT 1 AS ok', (err) => {
    if (err) {
      return res.status(503).json({
        ...payload,
        status: 'degraded',
        database: 'error'
      });
    }

    res.json(payload);
  });
});

async function syncReceivableForTransaction(transaction, callback, dbClient = null) {
  const done = typeof callback === 'function' ? callback : () => {};

  try {
    if (!transaction || !transaction.id) {
      return done(new Error('Missing transaction for AR sync'));
    }

    if (transaction.type !== 'invoice' || transaction.archived) {
      await queryDbAsync(dbClient, 'DELETE FROM accounts_receivable WHERE transaction_id = ?', [transaction.id]);
      return done(null);
    }

    const amount = Number(transaction.amount || 0);
    const downpayment = Number(transaction.downpayment || 0);
    const status = normalizeTransactionStatusValue(transaction.status);
    const businessEntityId = normalizeBusinessEntityId(transaction.business_entity_id) || await getDefaultBusinessEntityId();
    const projectId = Number(transaction.project_id || 0) || null;
    let projectDocno = String(transaction.project_docno || '').trim();
    const serviceOrderId = Number(transaction.service_order_id || 0) || null;
    let serviceOrderNo = String(transaction.service_order_no || '').trim();

    if (!projectDocno && projectId) {
      const projectRows = await queryDbAsync(
        dbClient,
        'SELECT project_docno FROM projects WHERE id = ? LIMIT 1',
        [projectId]
      );
      projectDocno = String(projectRows[0]?.project_docno || '').trim();
    }

    if (!serviceOrderNo && serviceOrderId) {
      const serviceOrderRows = await queryDbAsync(
        dbClient,
        'SELECT so_number FROM service_orders WHERE id = ? LIMIT 1',
        [serviceOrderId]
      );
      serviceOrderNo = String(serviceOrderRows[0]?.so_number || '').trim();
    }

    const existingRows = await queryDbAsync(dbClient, 'SELECT id, paid_amount FROM accounts_receivable WHERE transaction_id = ? LIMIT 1', [transaction.id]);
    const existingReceivableId = existingRows.length > 0 ? Number(existingRows[0].id || 0) : 0;
    const existingPaidAmount = existingRows.length > 0 ? Number(existingRows[0].paid_amount || 0) : 0;
    const paidFromTransaction = amount > 0 && downpayment >= amount
      ? amount
      : (downpayment > 0 ? Math.min(amount, downpayment) : 0);

    let paidAmount = 0;
    if (existingReceivableId) {
      const paidRows = await queryDbAsync(
        dbClient,
        "SELECT COALESCE(SUM(amount), 0) AS paid_amount FROM payments WHERE payment_type = 'ar' AND ar_id = ?",
        [existingReceivableId]
      );
      paidAmount = Number(paidRows[0]?.paid_amount || 0);
      if (paidAmount <= 0 && existingPaidAmount > 0) {
        paidAmount = existingPaidAmount;
      }
    }

    if (paidAmount <= 0) {
      paidAmount = paidFromTransaction > 0
        ? paidFromTransaction
        : (status === 'paid'
          ? amount
          : (status === 'partial' ? Math.min(amount, downpayment) : 0));
    }

    const receivableStatus = mapTransactionToReceivableStatus(transaction.type, amount, paidAmount, transaction.archived, status);
    const payload = [
      transaction.client || 'Unknown Customer',
      transaction.docno,
      transaction.date,
      transaction.date,
      'Due on Receipt',
      amount,
      paidAmount,
      receivableStatus,
      businessEntityId,
      transaction.id,
      transaction.description || null,
      projectId,
      projectDocno || null,
      serviceOrderNo || null
    ];

    if (existingReceivableId) {
      await queryDbAsync(
        dbClient,
        `UPDATE accounts_receivable
         SET customer_name = ?, invoice_number = ?, invoice_date = ?, due_date = ?,
             payment_terms = ?, total_amount = ?, paid_amount = ?, status = ?, notes = ?,
             business_entity_id = ?, project_id = ?, project_docno = ?, service_order_no = ?
         WHERE transaction_id = ?`,
        [
          payload[0], payload[1], payload[2], payload[3],
          payload[4], payload[5], payload[6], payload[7], payload[10],
          payload[8], payload[11], payload[12], payload[13],
          payload[9]
        ]
      );
    } else {
      await queryDbAsync(
        dbClient,
        `INSERT INTO accounts_receivable
          (customer_name, invoice_number, invoice_date, due_date, payment_terms, total_amount, paid_amount, status, business_entity_id, transaction_id, notes, project_id, project_docno, service_order_no)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        payload
      );
    }

    await queryDbAsync(dbClient, 'UPDATE transactions SET status = ? WHERE id = ?', [mapReceivableToTransactionStatus(amount, paidAmount), transaction.id]);
    return done(null);
  } catch (err) {
    return done(err);
  }
}

function mapProjectReceivableStatus(totalAmount, paidAmount, dueDate) {
  const total = Number(totalAmount || 0);
  const paid = Number(paidAmount || 0);

  if (total <= 0) return 'draft';
  if (paid >= total) return 'paid';
  if (paid > 0) return 'partial';

  if (dueDate) {
    const due = new Date(dueDate);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (!Number.isNaN(due.getTime())) {
      due.setHours(0, 0, 0, 0);
      if (due < today) return 'overdue';
    }
  }

  return 'sent';
}

function extractProjectClientName(projectName) {
  const parts = String(projectName || '')
    .split(' - ')
    .map(part => part.trim())
    .filter(Boolean);
  return parts.length >= 2 ? parts[0] : '';
}

function syncReceivableForProject(project, callback) {
  const done = typeof callback === 'function' ? callback : () => {};
  if (!project || !project.id) {
    return done(new Error('Missing project for AR sync'));
  }

  const invoiceNumber = getProjectInvoiceNumber(project.project_docno);
  if (!invoiceNumber) {
    return done(new Error('Missing project doc no for AR sync'));
  }

  const customerName = String(project.company_name || project.client_name || '').trim()
    || extractProjectClientName(project.project_name)
    || 'Unknown Customer';
  const invoiceDate = project.start_date || project.planned_start_date || new Date().toISOString().slice(0, 10);
  const dueDate = project.end_date || project.planned_end_date || null;
  const totalAmount = Number(project.budget || 0);
  const paidAmount = Number(project.downpayment || 0);
  const businessEntityId = normalizeBusinessEntityId(project.business_entity_id);
  if (totalAmount <= 0) {
    return db.query(
      'DELETE FROM accounts_receivable WHERE project_id = ?',
      [project.id],
      (deleteErr) => done(deleteErr || null)
    );
  }
  const status = mapProjectReceivableStatus(totalAmount, paidAmount, dueDate);
  const notes = project.description || null;
  const payload = [
    customerName,
    invoiceNumber,
    invoiceDate,
    dueDate,
    'Project Terms',
    totalAmount,
    paidAmount,
    status,
    businessEntityId,
    Number(project.transaction_id || 0) || null,
    notes,
    Number(project.id),
    invoiceNumber
  ];

  db.query(
    'SELECT id FROM accounts_receivable WHERE project_id = ? OR invoice_number = ? LIMIT 1',
    [project.id, invoiceNumber],
    (findErr, rows) => {
      if (findErr) return done(findErr);

      if (rows && rows.length) {
        return db.query(
          `UPDATE accounts_receivable
           SET customer_name = ?, invoice_number = ?, invoice_date = ?, due_date = ?,
               payment_terms = ?, total_amount = ?, paid_amount = ?, status = ?, transaction_id = ?, notes = ?,
               business_entity_id = ?, project_id = ?, project_docno = ?
           WHERE id = ?`,
          [
            payload[0], payload[1], payload[2], payload[3],
            payload[4], payload[5], payload[6], payload[7],
            payload[9], payload[10], payload[8], payload[11], payload[12],
            rows[0].id
          ],
          (updateErr) => done(updateErr || null)
        );
      }

      db.query(
        `INSERT INTO accounts_receivable
          (customer_name, invoice_number, invoice_date, due_date, payment_terms, total_amount, paid_amount, status, business_entity_id, transaction_id, notes, project_id, project_docno)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        payload,
        (insertErr) => done(insertErr || null)
      );
    }
  );
}

function resolveCompanyRegistryReference(input, callback) {
  const done = typeof callback === 'function' ? callback : () => {};
  const companyId = Number(input?.company_id || 0);
  const companyNo = String(input?.company_no || '').trim();
  const companyName = String(input?.company_name || input?.client_name || '').trim();

  const selectById = (next) => {
    if (!companyId) return next(false);
    db.query(
      'SELECT id, company_no, company_name FROM company_registry WHERE id = ? LIMIT 1',
      [companyId],
      (err, rows) => {
        if (err) return done(err);
        if (rows && rows.length) return done(null, rows[0]);
        next(false);
      }
    );
  };

  const selectByNo = (next) => {
    if (!companyNo) return next(false);
    db.query(
      'SELECT id, company_no, company_name FROM company_registry WHERE LOWER(TRIM(company_no)) = LOWER(TRIM(?)) LIMIT 1',
      [companyNo],
      (err, rows) => {
        if (err) return done(err);
        if (rows && rows.length) return done(null, rows[0]);
        next(false);
      }
    );
  };

  const selectByName = (next) => {
    if (!companyName) return done(new Error('Company is required'));
    db.query(
      'SELECT id, company_no, company_name FROM company_registry WHERE LOWER(TRIM(company_name)) = LOWER(TRIM(?)) LIMIT 1',
      [companyName],
      (err, rows) => {
        if (err) return done(err);
        if (rows && rows.length) return done(null, rows[0]);
        done(new Error('Selected company was not found in Company Registry'));
      }
    );
  };

  selectById((hasId) => {
    if (hasId !== false) return;
    selectByNo((hasNo) => {
      if (hasNo !== false) return;
      selectByName();
    });
  });
}

function ensureCompanyRegistryForProject(project, callback) {
  const done = typeof callback === 'function' ? callback : () => {};
  const companyId = Number(project?.company_id || 0);
  const companyNo = String(project?.company_no || '').trim();
  const companyName = String(project?.company_name || project?.client_name || '').trim();

  if (companyId) {
    db.query(
      'SELECT id FROM company_registry WHERE id = ? LIMIT 1',
      [companyId],
      (err, rows) => {
        if (err) return done(err);
        if (rows && rows.length) return done(null, rows[0].id);
        if (!companyName && !companyNo) return done(null);
        const fallbackName = companyName || companyNo;
        if (!fallbackName) return done(null);
        db.query(
          'SELECT id FROM company_registry WHERE LOWER(TRIM(company_name)) = LOWER(TRIM(?)) OR LOWER(TRIM(company_no)) = LOWER(TRIM(?)) LIMIT 1',
          [fallbackName, companyNo || fallbackName],
          (fallbackErr, fallbackRows) => {
            if (fallbackErr) return done(fallbackErr);
            if (fallbackRows && fallbackRows.length) return done(null, fallbackRows[0].id);
            done(null);
          }
        );
      }
    );
    return;
  }

  if (!companyName) return done(null);

  db.query(
    'SELECT id FROM company_registry WHERE LOWER(TRIM(company_name)) = LOWER(TRIM(?)) LIMIT 1',
    [companyName],
    (findErr, rows) => {
      if (findErr) return done(findErr);
      if (rows && rows.length) return done(null, rows[0].id);

      generateNextCompanyNo((noErr, companyNo) => {
        if (noErr) return done(noErr);
        db.query(
          'INSERT INTO company_registry (company_no, company_name, status) VALUES (?, ?, ?)',
          [companyNo, companyName, 'active'],
          (insertErr, result) => {
            if (insertErr) {
              if (insertErr.code === 'ER_DUP_ENTRY') return done(null);
              return done(insertErr);
            }
            done(null, result.insertId);
          }
        );
      });
    }
  );
}

function setProjectArchiveStateByClient(clientName, isArchived, callback) {
  const done = typeof callback === 'function' ? callback : () => {};
  const normalized = String(clientName || '').trim();
  if (!normalized) return done(null);

  db.query(
    'UPDATE projects SET is_archived = ?, archived_auto = 0 WHERE LOWER(TRIM(project_name)) = LOWER(TRIM(?))',
    [isArchived ? 1 : 0, normalized],
    (err) => done(err || null)
  );
}

function syncProjectArchiveStateForTransaction(transactionId, isArchived, callback) {
  const done = typeof callback === 'function' ? callback : () => {};
  const normalizedId = Number(transactionId || 0);
  if (!normalizedId) return done(null);

  db.query(
    `UPDATE projects
     SET is_archived = ?, archived_auto = 0
     WHERE transaction_id = ?`,
    [isArchived ? 1 : 0, normalizedId],
    (err) => done(err || null)
  );
}

function autoArchiveExpiredProjects(callback) {
  const done = typeof callback === 'function' ? callback : () => {};
  // Expired projects stay visible in Total Projects; we no longer auto-hide them.
  done(null);
}

function autoRestoreActiveProjects(callback) {
  const done = typeof callback === 'function' ? callback : () => {};
  db.query(
    `UPDATE projects
     SET is_archived = 0,
         archived_auto = 0
     WHERE COALESCE(archived_auto, 0) = 1`,
    (err) => done(err || null)
  );
}

function autoArchiveExpiredTransactions(callback) {
  const done = typeof callback === 'function' ? callback : () => {};
  // Keep completed/expired records in the main list; archive only when users do it manually.
  done(null);
}

function autoRestoreEligibleTransactions(callback) {
  const done = typeof callback === 'function' ? callback : () => {};
  db.query(
    `UPDATE transactions
     SET archived = 0,
         archived_auto = 0
     WHERE COALESCE(archived_auto, 0) = 1`,
    (err) => done(err || null)
  );
}

function backfillProjectTransactionLinks(callback) {
  const done = typeof callback === 'function' ? callback : () => {};
  db.query(
    `UPDATE projects p
     JOIN transactions t
       ON LOWER(TRIM(p.project_name)) = LOWER(TRIM(t.client))
     LEFT JOIN projects linked
       ON linked.transaction_id = t.id
     SET p.transaction_id = t.id,
         p.source_docno = t.docno,
         p.project_name = CONCAT(t.client, ' - ', t.docno)
     WHERE p.transaction_id IS NULL
       AND (p.source_docno IS NULL OR p.source_docno = '')
       AND linked.id IS NULL`,
    (err) => done(err || null)
  );
}

function runArchiveMaintenance(callback) {
  const done = typeof callback === 'function' ? callback : () => {};
  backfillProjectTransactionLinks((linkErr) => {
    if (linkErr) return done(linkErr);
    backfillTransactionProjectLinks((transactionLinkErr) => {
      if (transactionLinkErr) return done(transactionLinkErr);
      autoRestoreActiveProjects((projectRestoreErr) => {
        if (projectRestoreErr) return done(projectRestoreErr);
        autoArchiveExpiredProjects((projectArchiveErr) => {
          if (projectArchiveErr) return done(projectArchiveErr);
          autoRestoreEligibleTransactions((restoreErr) => {
            if (restoreErr) return done(restoreErr);
            autoArchiveExpiredTransactions((archiveErr) => done(archiveErr || null));
          });
        });
      });
    });
  });
}

function buildDefaultProjectTasks(startDate, endDate) {
  const start = new Date(startDate);
  const end = new Date(endDate);
  const totalDays = Math.max(1, Math.ceil((end - start) / (1000 * 60 * 60 * 24)) + 1);

  const phase1Days = Math.max(1, Math.round(totalDays * 0.2));
  const phase2Days = Math.max(1, Math.round(totalDays * 0.3));
  const phase3Days = Math.max(1, totalDays - phase1Days - phase2Days);

  const addDays = (date, days) => {
    const copy = new Date(date);
    copy.setDate(copy.getDate() + days);
    return copy;
  };

  const toYmd = (date) => date.toISOString().slice(0, 10);

  const phase1Start = new Date(start);
  const phase1End = addDays(phase1Start, phase1Days - 1);
  const phase2Start = addDays(phase1End, 1);
  const phase2End = addDays(phase2Start, phase2Days - 1);
  const phase3Start = addDays(phase2End, 1);
  const phase3End = new Date(end);

  return [
    {
      task_name: 'Planning and Preparation',
      start_date: toYmd(phase1Start),
      end_date: toYmd(phase1End),
      duration: phase1Days,
      status: 'in_progress',
      progress: 15
    },
    {
      task_name: 'Implementation and Installation',
      start_date: toYmd(phase2Start),
      end_date: toYmd(phase2End > end ? end : phase2End),
      duration: phase2Days,
      status: 'not_started',
      progress: 0
    },
    {
      task_name: 'Testing and Turnover',
      start_date: toYmd(phase3Start > end ? end : phase3Start),
      end_date: toYmd(phase3End),
      duration: Math.max(1, Math.ceil(((phase3End - (phase3Start > end ? end : phase3Start)) / (1000 * 60 * 60 * 24)) + 1)),
      status: 'not_started',
      progress: 0
    }
  ];
}

function ensureDefaultProjectTasks(projectId, startDate, endDate, callback) {
  const done = typeof callback === 'function' ? callback : () => {};

  db.query('SELECT COUNT(*) AS total FROM tasks WHERE project_id = ?', [projectId], (countErr, rows) => {
    if (countErr) return done(countErr);
    if ((rows[0]?.total || 0) > 0) return done(null, false);

    const tasks = buildDefaultProjectTasks(startDate, endDate);
    let index = 0;

    const insertNext = () => {
      if (index >= tasks.length) return done(null, true);
      const task = tasks[index++];
      db.query(
        'INSERT INTO tasks (project_id, task_name, start_date, end_date, duration, status, progress) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [projectId, task.task_name, task.start_date, task.end_date, task.duration, task.status, task.progress],
        (insertErr) => {
          if (insertErr) return done(insertErr);
          insertNext();
        }
      );
    };

    insertNext();
  });
}

app.get('/admin', protectAdmin, (req, res) => {
  noCache(res);
  res.sendFile(path.join(__dirname, 'public', 'admin', 'index.html'));
});

app.get('/inventory', protectAdmin, (req, res) => {
  noCache(res);
  res.sendFile(path.join(__dirname, 'public', 'inventory', 'index.html'));
});

app.get('/accounts-payable', protectAdmin, (req, res) => {
  noCache(res);
  res.sendFile(path.join(__dirname, 'public', 'accounts-payable', 'index.html'));
});

app.get('/accounts-receivable', protectAdmin, (req, res) => {
  noCache(res);
  res.sendFile(path.join(__dirname, 'public', 'accounts-receivable', 'index.html'));
});

app.get('/reports', protectAdmin, (req, res) => {
  noCache(res);
  res.sendFile(path.join(__dirname, 'public', 'reports', 'index.html'));
});

app.get('/gantt-chart', protectAdmin, (req, res) => {
  noCache(res);
  res.sendFile(path.join(__dirname, 'public', 'gantt-chart', 'index.html'));
});

app.get('/user-management', protectAdminOnly, (req, res) => {
  noCache(res);
  res.sendFile(path.join(__dirname, 'public', 'user-management', 'index.html'));
});

app.get('/business-entities', protectAdminOnly, (req, res) => {
  noCache(res);
  res.sendFile(path.join(__dirname, 'public', 'business-entities', 'index.html'));
});

app.get('/procurement', protectAdmin, (req, res) => {
  noCache(res);
  const params = new URLSearchParams(req.query || {});
  if (!params.has('tab')) {
    params.set('tab', String(params.get('action') || '').toLowerCase() === 'po' ? 'purchase-orders' : 'vendors');
  }
  res.redirect(`/accounts-payable?${params.toString()}`);
});

app.get('/erp', protectAdmin, (req, res) => {
  noCache(res);
  res.sendFile(path.join(__dirname, 'public', 'company', 'index.html'));
});

app.get('/company-registry', protectAdminOnly, (req, res) => {
  noCache(res);
  res.sendFile(path.join(__dirname, 'public', 'company', 'index.html'));
});

app.get('/status', protectAuthenticated, (req, res) => {
  noCache(res);
  res.sendFile(path.join(__dirname, 'public', 'user-index', 'index.html'));
});



app.get('/api/me', (req, res) => {
  noCache(res);
  const user = getAuthenticatedUser(req);
  if (!user) {
    return res.status(401).json({ loggedIn: false });
  }
  const csrfToken = req.session?.user ? ensureSessionCsrfToken(req) : '';
  res.json({
    loggedIn: true,
    username: user.username,
    fullname: user.fullname,
    role:     user.role,
    permissions: getRolePermissions(user.role),
    csrfToken
  });
});

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// AUTHENTICATION
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

app.post('/register', registerRateLimiter, async (req, res) => {
  if (!allowPublicRegistration) {
    return res.status(403).json({ status: 'error', message: 'Public registration is disabled.' });
  }

  const { name, username, email, password } = req.body;

  if (!name || !username || !email || !password) {
    return res.status(400).json({ status: 'error', message: 'All fields are required' });
  }

  if (String(password).length < 8) {
    return res.status(400).json({ status: 'error', message: 'Password must be at least 8 characters long' });
  }

  try {
    db.query('SELECT id FROM users WHERE username = ?', [username], async (err, rows) => {
      if (err) return res.status(500).json({ status: 'error', message: 'Database error' });
      if (rows.length > 0)
        return res.status(400).json({ status: 'error', message: 'Username already exists' });

      db.query('SELECT id FROM users WHERE email = ?', [email], (err, rows) => {
        if (err) return res.status(500).json({ status: 'error', message: 'Database error' });
        if (rows.length > 0)
          return res.status(400).json({ status: 'error', message: 'Email already exists' });

        bcrypt.hash(password, 10, (err, hashedPassword) => {
          if (err) return res.status(500).json({ status: 'error', message: 'Password hashing error' });

          db.query(
            'INSERT INTO users (fullname, username, email, password, role, active, created_at) VALUES (?, ?, ?, ?, ?, 1, NOW())',
            [name, username, email, hashedPassword, 'user'],
            (err) => {
              if (err) return res.status(500).json({ status: 'error', message: 'Failed to create account' });
              logAction(req, 'REGISTER', `Created public user account: ${username}`);
              res.json({ status: 'success', message: 'Account created successfully' });
            }
          );
        });
      });
    });
  } catch (error) {
    res.status(500).json({ status: 'error', message: 'Server error' });
  }
});

// âœ… FIXED LOGIN â€” Suportahan ang bcrypt (registered users) AT plain text (legacy)
app.post('/login', loginRateLimiter, async (req, res) => {
  const username = String(req.body?.username || '').trim();
  const password = String(req.body?.password || '');

  if (!username || !password) {
    return res.status(400).json({ status: 'error', message: 'Username and password are required' });
  }

  const cooldownRemaining = getLoginCooldownRemaining(req, username);
  if (cooldownRemaining > 0) {
    res.setHeader('Retry-After', String(cooldownRemaining));
    return res.status(429).json({
      status: 'error',
      message: `Too many login attempts. Try again in ${cooldownRemaining} seconds.`,
      retryAfter: cooldownRemaining
    });
  }

  db.query('SELECT * FROM users WHERE username = ?', [username], async (err, rows) => {
    if (err) return res.status(500).json({ status: 'error', message: 'Database error' });

    if (rows.length === 0) {
      const lockState = registerLoginFailure(req, username);
      if (lockState.locked) {
        res.setHeader('Retry-After', String(lockState.retryAfter));
        return res.status(429).json({
          status: 'error',
          message: `Too many login attempts. Try again in ${lockState.retryAfter} seconds.`,
          retryAfter: lockState.retryAfter
        });
      }
      return res.status(401).json({ status: 'error', message: 'Invalid username or password' });
    }

    const user = rows[0];
    if (Number(user.active || 0) !== 1) {
      registerLoginFailure(req, username);
      return res.status(403).json({ status: 'error', message: 'Disabled account. Please contact the administrator.' });
    }

    let passwordMatch = false;

    try {
      if (user.password.startsWith('$2b$') || user.password.startsWith('$2a$')) {
        passwordMatch = await bcrypt.compare(password, user.password);
      } else if (allowLegacyPlaintextPasswords) {
        passwordMatch = (password === user.password);

        if (passwordMatch) {
          bcrypt.hash(password, 10, (hashErr, newHash) => {
            if (!hashErr) {
              db.query('UPDATE users SET password = ? WHERE id = ?', [newHash, user.id], (updateErr) => {
                if (!updateErr) console.log(`âœ… Auto-upgraded password hash for user: ${user.username}`);
              });
            }
          });
        }
      } else {
        passwordMatch = false;
      }
    } catch (compareErr) {
      console.error('Password comparison error:', compareErr);
      return res.status(500).json({ status: 'error', message: 'Server error during authentication' });
    }

    if (!passwordMatch) {
      const lockState = registerLoginFailure(req, username);
      if (lockState.locked) {
        res.setHeader('Retry-After', String(lockState.retryAfter));
        return res.status(429).json({
          status: 'error',
          message: `Too many login attempts. Try again in ${lockState.retryAfter} seconds.`,
          retryAfter: lockState.retryAfter
        });
      }
      return res.status(401).json({ status: 'error', message: 'Invalid username or password' });
    }

    req.session.regenerate((regenErr) => {
      if (regenErr) {
        console.error('Session regeneration error:', regenErr);
        return res.status(500).json({ status: 'error', message: 'Unable to start secure session' });
      }

      req.session.user = {
        id:       user.id,
        username: user.username,
        role:     user.role,
        fullname: user.fullname
      };
      req.session.csrfToken = crypto.randomBytes(32).toString('hex');

      db.query('UPDATE users SET last_login = NOW() WHERE id = ?', [user.id], (loginStampErr) => {
        if (loginStampErr) console.error('Last login update error:', loginStampErr);
      });

      clearLoginThrottle(req, username);
      logAction(req, 'LOGIN', `User ${user.username} logged in successfully.`);
      const accessToken = signJwtPayload({
        sub: String(user.id),
        username: user.username,
        role: user.role,
        fullname: user.fullname
      });
      res.json({
        status: 'success',
        role: user.role,
        fullname: user.fullname,
        csrfToken: req.session.csrfToken,
        accessToken,
        tokenType: 'Bearer',
        expiresIn: Number.isFinite(jwtExpiresInSeconds) && jwtExpiresInSeconds > 0 ? jwtExpiresInSeconds : 15 * 60
      });
    });
  });
});

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// FORGOT / RESET PASSWORD
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

app.post('/api/forgot-password', forgotPasswordRateLimiter, (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  if (!email) return res.status(400).json({ status: 'error', message: 'Email is required' });

  db.query('SELECT id, username FROM users WHERE email = ?', [email], (err, rows) => {
    if (err) return res.status(500).json({ status: 'error', message: 'Database error' });
    if (rows.length === 0) {
      return res.json({
        status: 'success',
        message: 'If the email exists, a reset link will be sent.'
      });
    }

    const token = crypto.randomBytes(32).toString('hex');
    const tokenHash = hashResetToken(token);
    const expiry = Date.now() + 3600000; // 1 hour valid

    db.query('UPDATE users SET reset_token = ?, reset_token_expiry = ? WHERE email = ?', 
    [tokenHash, expiry, email], (updErr) => {
      if (updErr) return res.status(500).json({ status: 'error', message: 'Failed to set token' });

      const resetLink = buildResetLink(token);
      
      const mailOptions = {
        from: `Kinaadman System <${SMTP_FROM}>`,
        to: email,
        subject: 'Password Reset Request',
        html: `<p>Hello ${rows[0].username},</p>
               <p>Nakatanggap kami ng request na i-reset ang iyong password. I-click ang link sa ibaba para magpatuloy:</p>
               <a href="${resetLink}">${resetLink}</a>
               <p>Ang link na ito ay valid sa loob ng isang oras lamang.</p>`
      };

      logAction(req, 'PASSWORD_RESET_REQUEST', `Reset requested for ${email}`);

      if (!transporter) {
        console.warn('SMTP is not configured.');
        if (isProduction) {
          return res.status(503).json({
            status: 'error',
            message: 'Password reset email is unavailable right now.'
          });
        }
        console.warn(`Reset link for ${email}: ${resetLink}`);
        return res.json({
          status: 'success',
          message: 'Email sender is not configured yet. Use the reset link below for now.',
          resetLink
        });
      }

      transporter.sendMail(mailOptions, (mailErr) => {
        if (mailErr) {
          console.error('Email error:', mailErr);
          return res.status(500).json({
            status: 'error',
            message: 'Failed to send email. Check SMTP settings in server environment.'
          });
        }
        res.json({ status: 'success', message: 'Reset link sent to your email' });
      });
    });
  });
});

app.post('/api/reset-password', resetPasswordRateLimiter, (req, res) => {
  const { token, newPassword } = req.body;
  const tokenHash = hashResetToken(token);

  if (!token || !newPassword) return res.status(400).json({ status: 'error', message: 'Missing fields' });
  if (String(newPassword).length < 8) {
    return res.status(400).json({ status: 'error', message: 'Password must be at least 8 characters.' });
  }

  db.query('SELECT id FROM users WHERE reset_token = ? AND reset_token_expiry > ?', 
  [tokenHash, Date.now()], (err, rows) => {
    if (err) return res.status(500).json({ status: 'error', message: 'Database error' });
    if (rows.length === 0) return res.status(400).json({ status: 'error', message: 'Invalid or expired token' });

    const userId = rows[0].id;

    bcrypt.hash(newPassword, 10, (hashErr, hash) => {
      if (hashErr) return res.status(500).json({ status: 'error', message: 'Hashing error' });

      db.query(
        'UPDATE users SET password = ?, reset_token = NULL, reset_token_expiry = NULL WHERE id = ?',
        [hash, userId],
        (updErr) => {
          if (updErr) return res.status(500).json({ status: 'error', message: 'Update error' });
          logAction(req, 'PASSWORD_RESET_COMPLETE', `Password reset completed for user ID ${userId}`);
          res.json({ status: 'success', message: 'Password updated successfully' });
        }
      );
    });
  });
});

app.post('/logout', (req, res) => {
    if (req.session?.user) {
      logAction(req, 'LOGOUT', `User ${req.session.user.username} logged out.`);
    }

    req.session.destroy(() => {
      res.clearCookie('kinaadman.sid');
      res.redirect('/');
    });
});

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// PUBLIC API
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
app.get('/api/public/transactions', protectAuthenticated, (req, res) => {
  runArchiveMaintenance((maintenanceErr) => {
    if (maintenanceErr) {
      console.error('Public archive maintenance error:', maintenanceErr);
      return res.status(500).json({ error: maintenanceErr.message });
    }

    db.query(`
      SELECT t.id, t.docno, t.type, t.client, t.phone, t.project_id, t.service_order_id, t.project_tx_no, t.checkno, t.pono,
             so.so_number AS service_order_no,
             so.service_title AS service_order_title,
             t.description AS description, project_members, member_role, member_phone,
             project_members_2, member_role_2, member_phone_2,
             project_members_3, member_role_3, member_phone_3,
             qty, unitprice,
             amount, downpayment,
             DATE_FORMAT(date, '%Y-%m-%d') AS date,
             DATE_FORMAT(project_start_date, '%Y-%m-%d') AS project_start_date,
             DATE_FORMAT(project_end_date, '%Y-%m-%d') AS project_end_date,
             t.status AS status, t.pdfFilename
      FROM transactions t
      LEFT JOIN service_orders so ON so.id = t.service_order_id
      LEFT JOIN accounts_receivable ar ON ar.transaction_id = t.id
      WHERE t.archived = 0
      ORDER BY t.id ASC
    `, (err, rows) => {
      if (err) {
        console.error('Public transaction query error:', err);
        return res.status(500).json({ error: err.message });
      }
      res.json(rows);
    });
  });
});

app.get('/api/public/transactions/:id/pdf', protectAuthenticated, (req, res) => {
  sendTransactionPdf(req, res, 'id = ? AND archived = 0', [req.params.id]);
});
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// PROTECTED API
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
app.get('/api/transactions', protectAdmin, (req, res) => {
  runArchiveMaintenance((maintenanceErr) => {
    if (maintenanceErr) {
      console.error('Transaction archive maintenance error:', maintenanceErr);
      return res.status(500).json({ error: maintenanceErr.message });
    }

    db.query(`
      SELECT t.id, t.docno, t.type, t.client, t.address, t.tin, t.bizstyle, t.phone, t.service_order_id, t.business_entity_id, t.company_id, t.project_tx_no,
             be.company_name AS business_entity_name,
             c.company_no,
             c.company_name,
             so.so_number AS service_order_no,
             so.service_title AS service_order_title,
             t.description AS description, project_members, member_role, member_phone,
             project_members_2, member_role_2, member_phone_2,
             project_members_3, member_role_3, member_phone_3,
             qty, unitprice, amount, downpayment, t.project_id AS project_id, checkno, pono,
             COALESCE(ar.paid_amount, 0) AS receivable_paid_amount,
             ar.status AS receivable_status,
             DATE_FORMAT(date, '%Y-%m-%d') AS date,
             DATE_FORMAT(project_start_date, '%Y-%m-%d') AS project_start_date,
             DATE_FORMAT(project_end_date, '%Y-%m-%d') AS project_end_date,
             t.status AS status, t.pdfFilename
      FROM transactions t
      LEFT JOIN business_entities be ON be.id = t.business_entity_id
      LEFT JOIN company_registry c ON c.id = t.company_id
      LEFT JOIN service_orders so ON so.id = t.service_order_id
      LEFT JOIN accounts_receivable ar ON ar.transaction_id = t.id
      WHERE t.archived = 0
      ORDER BY t.id DESC
    `, (err, rows) => {
      if (err) {
        console.error('Transaction query error:', err);
        return res.status(500).json({ error: err.message });
      }
      res.json(rows);
    });
  });
});

app.get('/api/transactions/:id/pdf', protectAdmin, (req, res) => {
  sendTransactionPdf(req, res, 'id = ?', [req.params.id]);
});

app.get('/api/transactions/by-docno/:docno', protectAdmin, (req, res) => {
  const docno = String(req.params.docno || '').trim();
  if (!docno) {
    return res.status(400).json({ error: 'Document number is required.' });
  }

  db.query(
    `SELECT t.id, t.docno, t.type, t.client, t.description AS description, t.amount, t.downpayment, t.checkno, t.pono,
            t.project_id, t.service_order_id, t.project_tx_no,
            so.so_number AS service_order_no,
            so.service_title AS service_order_title,
            COALESCE(ar.paid_amount, 0) AS receivable_paid_amount,
            ar.status AS receivable_status,
            project_members, member_role, member_phone,
            project_members_2, member_role_2, member_phone_2,
            project_members_3, member_role_3, member_phone_3,
            DATE_FORMAT(date, '%Y-%m-%d') AS date
     FROM transactions t
     LEFT JOIN service_orders so ON so.id = t.service_order_id
     LEFT JOIN accounts_receivable ar ON ar.transaction_id = t.id
     WHERE t.docno = ?
     LIMIT 1`,
    [docno],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!rows || !rows.length) {
        return res.status(404).json({ error: 'Transaction not found.' });
      }
      res.json(rows[0]);
    }
  );
});

async function generateNextTransactionDocnoAsync(dbClient = null, businessEntityId = null) {
  const resolvedBusinessEntityId = normalizeBusinessEntityId(businessEntityId) || await getDefaultBusinessEntityId();
  const ownsConnection = !dbClient;
  const connection = dbClient || await getConnectionAsync();
  try {
    return await generateNextEntityDocumentNo({
      businessEntityId: resolvedBusinessEntityId,
      documentType: 'transaction-docno',
      prefix: 'TRN',
      tableName: 'transactions',
      columnName: 'docno',
      dbClient: connection
    });
  } finally {
    if (ownsConnection && connection) {
      connection.release();
    }
  }
}

function generateNextTransactionDocno(callback, businessEntityId = null) {
  generateNextTransactionDocnoAsync(null, businessEntityId)
    .then((docno) => callback(null, docno))
    .catch((err) => callback(err));
}

function generateNextProjectDocno(callback, businessEntityId = null) {
  generateNextEntityDocumentNo({
    businessEntityId,
    documentType: 'project-docno',
    prefix: 'PRJ',
    tableName: 'projects',
    columnName: 'project_docno'
  })
    .then((projectDocno) => callback(null, projectDocno))
    .catch((err) => callback(err));
}

function generateNextCompanyNo(callback) {
  const prefix = 'CMP';

  db.query(
    `SELECT CAST(SUBSTRING(company_no, 5) AS UNSIGNED) AS seqNum
     FROM company_registry
     WHERE company_no LIKE ?
     ORDER BY seqNum ASC`,
    [`${prefix}-%`],
    (err, rows) => {
      if (err) return callback(err);

      const used = new Set(
        rows
          .map(row => Number(row.seqNum || 0))
          .filter(num => Number.isInteger(num) && num > 0)
      );

      let nextNum = 1;
      while (used.has(nextNum)) nextNum += 1;

      callback(null, `${prefix}-${String(nextNum).padStart(3, '0')}`);
    }
  );
}

async function findProjectDuplicateByIdentity({
  businessEntityId,
  companyId,
  projectName,
  plannedStartDate,
  plannedEndDate,
  excludeProjectId = null
}) {
  const normalizedProjectName = String(projectName || '').trim();
  const resolvedBusinessEntityId = normalizeBusinessEntityId(businessEntityId);
  const resolvedCompanyId = Number(companyId || 0) || null;
  const startDate = String(plannedStartDate || '').trim();
  const endDate = String(plannedEndDate || '').trim();

  if (!resolvedBusinessEntityId || !resolvedCompanyId || !normalizedProjectName || !startDate || !endDate) {
    return null;
  }

  const params = [
    resolvedBusinessEntityId,
    resolvedCompanyId,
    normalizedProjectName.toLowerCase(),
    startDate,
    endDate
  ];
  let excludeSql = '';
  if (excludeProjectId) {
    excludeSql = ' AND id <> ?';
    params.push(Number(excludeProjectId));
  }

  const rows = await queryAsync(
    `SELECT id, project_docno, project_name
     FROM projects
     WHERE COALESCE(is_archived, 0) = 0
       AND business_entity_id = ?
       AND company_id = ?
       AND LOWER(TRIM(project_name)) = ?
       AND COALESCE(planned_start_date, start_date) = ?
       AND COALESCE(planned_end_date, end_date) = ?
       ${excludeSql}
     LIMIT 1`,
    params
  );

  return rows?.[0] || null;
}

function sendProjectDuplicateResponse(res, duplicate) {
  return res.status(409).json({
    error: `A project with the same company, title, start date, and end date already exists${duplicate?.project_docno ? ` (${duplicate.project_docno})` : ''}.`,
    field: 'project_identity',
    duplicate_project_id: duplicate?.id || null,
    duplicate_project_docno: duplicate?.project_docno || null
  });
}

function formatVendorNo(year, sequence) {
  const safeYear = String(year || new Date().getFullYear()).replace(/\D/g, '').slice(-4) || String(new Date().getFullYear());
  const safeSequence = Math.max(1, Number(sequence || 0) || 1);
  return `VEN-${safeYear}-${String(safeSequence).padStart(2, '0')}`;
}

function parseVendorNo(value) {
  const match = /^VEN-(\d{4})-(\d{1,})$/i.exec(String(value || '').trim());
  if (!match) return null;
  return {
    year: Number(match[1]),
    sequence: Number(match[2])
  };
}

function generateNextVendorNo(callback) {
  const year = new Date().getFullYear();
  const prefix = `VEN-${year}`;

  db.query(
    `SELECT CAST(SUBSTRING_INDEX(vendor_no, '-', -1) AS UNSIGNED) AS seqNum
     FROM vendors
     WHERE vendor_no LIKE ?
     ORDER BY seqNum ASC`,
    [`${prefix}-%`],
    (err, rows) => {
      if (err) return callback(err);

      const used = new Set(
        (rows || [])
          .map(row => Number(row.seqNum || 0))
          .filter(num => Number.isInteger(num) && num > 0)
      );

      let nextNum = 1;
      while (used.has(nextNum)) nextNum += 1;

      callback(null, formatVendorNo(year, nextNum));
    }
  );
}

function backfillVendorNumbers() {
  queryAsync('SELECT id, created_at, vendor_no FROM vendors ORDER BY created_at ASC, id ASC')
    .then((rows) => {
      const usedByYear = new Map();
      const updates = [];

      for (const row of rows || []) {
        if (!row) continue;
        const parsed = parseVendorNo(row.vendor_no);
        if (!parsed) continue;
        if (!usedByYear.has(parsed.year)) {
          usedByYear.set(parsed.year, new Set());
        }
        usedByYear.get(parsed.year).add(parsed.sequence);
      }

      for (const row of rows || []) {
        if (!row) continue;
        if (parseVendorNo(row.vendor_no)) continue;

        const createdAt = row.created_at ? new Date(row.created_at) : null;
        const year = createdAt && Number.isFinite(createdAt.getFullYear()) ? createdAt.getFullYear() : new Date().getFullYear();
        let yearSet = usedByYear.get(year);
        if (!yearSet) {
          yearSet = new Set();
          usedByYear.set(year, yearSet);
        }

        let nextSeq = 1;
        while (yearSet.has(nextSeq)) nextSeq += 1;
        yearSet.add(nextSeq);
        updates.push({ id: row.id, vendorNo: formatVendorNo(year, nextSeq) });
      }

      if (!updates.length) return null;

      return updates.reduce(
        (promise, item) => promise.then(() => queryAsync('UPDATE vendors SET vendor_no = ? WHERE id = ?', [item.vendorNo, item.id])),
        Promise.resolve()
      );
    })
    .catch((err) => {
      console.error('Vendor number backfill error:', err);
    });
}

function normalizeCompanyNameForCompare(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeCompanyTinForCompare(value) {
  return normalizeTin(value).toLowerCase();
}

function findCompanyRegistryDuplicate(companyName, phone, tin, excludeId, businessEntityId, callback) {
  const done = typeof callback === 'function' ? callback : (typeof businessEntityId === 'function' ? businessEntityId : () => {});
  const normalizedName = normalizeCompanyNameForCompare(companyName);
  const normalizedPhone = normalizePhone(phone);
  const normalizedTin = normalizeCompanyTinForCompare(tin);
  const currentId = Number(excludeId || 0) || 0;
  const scopedBusinessEntityId = normalizeBusinessEntityId(typeof businessEntityId === 'function' ? null : businessEntityId);

  queryAsync(
    `SELECT id, company_name, phone, tin
     FROM company_registry
     ${scopedBusinessEntityId ? 'WHERE business_entity_id = ?' : ''}`,
    scopedBusinessEntityId ? [scopedBusinessEntityId] : []
  )
    .then((rows) => {
      for (const company of rows || []) {
        if (!company) continue;
        if (currentId && Number(company.id || 0) === currentId) continue;

        if (normalizedName && normalizeCompanyNameForCompare(company.company_name) === normalizedName) {
          return done(null, { field: 'company_name', row: company });
        }

        if (normalizedPhone && normalizePhone(company.phone) === normalizedPhone) {
          return done(null, { field: 'phone', row: company });
        }

        if (normalizedTin && normalizeCompanyTinForCompare(company.tin) === normalizedTin) {
          return done(null, { field: 'tin', row: company });
        }
      }
      return done(null, null);
    })
    .catch((err) => done(err));
}

function normalizeEmailForCompare(value) {
  return String(value || '').trim().toLowerCase();
}

function findVendorDuplicate(phone, tin, email, excludeId, callback) {
  const done = typeof callback === 'function' ? callback : () => {};
  const normalizedPhone = normalizePhone(phone);
  const normalizedTin = normalizeTin(tin);
  const normalizedEmail = normalizeEmailForCompare(email);
  const currentId = Number(excludeId || 0) || 0;

  queryAsync('SELECT id, phone, tin, email FROM vendors')
    .then((rows) => {
      for (const vendor of rows || []) {
        if (!vendor) continue;
        if (currentId && Number(vendor.id || 0) === currentId) continue;

        if (normalizedPhone && normalizePhone(vendor.phone) === normalizedPhone) {
          return done(null, { field: 'phone', row: vendor });
        }

        if (normalizedTin && normalizeTin(vendor.tin) === normalizedTin) {
          return done(null, { field: 'tin', row: vendor });
        }

        if (normalizedEmail && normalizeEmailForCompare(vendor.email) === normalizedEmail) {
          return done(null, { field: 'vendor_email', row: vendor });
        }
      }
      return done(null, null);
    })
    .catch((err) => done(err));
}

function normalizeUniqueTextForCompare(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function findTextDuplicate(tableName, columnName, value, excludeId, callback) {
  const done = typeof callback === 'function' ? callback : () => {};
  const normalizedValue = normalizeUniqueTextForCompare(value);
  const currentId = Number(excludeId || 0) || 0;

  if (!normalizedValue) return done(null, null);

  queryAsync(`SELECT id, ${columnName} AS duplicate_value FROM ${tableName}`)
    .then((rows) => {
      for (const row of rows || []) {
        if (!row) continue;
        if (currentId && Number(row.id || 0) === currentId) continue;
        if (normalizeUniqueTextForCompare(row.duplicate_value) === normalizedValue) {
          return done(null, { field: columnName, row });
        }
      }
      return done(null, null);
    })
    .catch((err) => done(err));
}

function getProjectInvoiceNumber(projectDocno) {
  const docno = String(projectDocno || '').trim();
  return docno ? `INV-${docno}` : '';
}

function getProjectBillNumber(projectDocno) {
  const docno = String(projectDocno || '').trim();
  return docno ? `BILL-${docno}` : '';
}

let projectDocnoMigrationStarted = false;
let projectDocnoMigrationCompleted = false;

function getProjectMonthKey(dateValue) {
  const ymd = getManilaYmd(dateValue || new Date());
  return ymd.slice(0, 7);
}

async function migrateExistingProjectDocnos({ attempt = 0 } = {}) {
  if (projectDocnoMigrationCompleted || projectDocnoMigrationStarted) return;
  projectDocnoMigrationStarted = true;

  try {
    const projectRows = await queryAsync(`
      SELECT id, project_docno, created_at, start_date, project_ar_invoice_no, project_ap_bill_no
      FROM projects
      ORDER BY COALESCE(created_at, start_date, id) ASC, id ASC
    `);

    if (!Array.isArray(projectRows) || !projectRows.length) {
      projectDocnoMigrationCompleted = true;
      return;
    }

    const usedByMonth = new Map();
    const plan = [];

    for (const row of projectRows) {
      const createdAt = row.created_at || row.start_date || new Date();
      const monthKey = getProjectMonthKey(createdAt);
      const currentDocno = String(row.project_docno || '').trim();
      const monthSet = usedByMonth.get(monthKey) || new Set();
      usedByMonth.set(monthKey, monthSet);

      let finalDocno = currentDocno;
      const keepCurrent = /^PRJ-\d{4}-\d{2}-\d{2}$/.test(currentDocno) && currentDocno.startsWith(`PRJ-${monthKey}-`);

      if (keepCurrent) {
        const suffix = Number(currentDocno.slice(-2));
        if (Number.isInteger(suffix) && suffix > 0) {
          monthSet.add(suffix);
        } else {
          finalDocno = '';
        }
      } else {
        finalDocno = '';
      }

      if (!finalDocno) {
        let suffix = 1;
        while (monthSet.has(suffix)) suffix += 1;
        finalDocno = `PRJ-${monthKey}-${String(suffix).padStart(2, '0')}`;
        monthSet.add(suffix);
      }

      const desiredInvoice = getProjectInvoiceNumber(finalDocno);
      const desiredBill = getProjectBillNumber(finalDocno);
      const needsUpdate =
        currentDocno !== finalDocno ||
        String(row.project_ar_invoice_no || '').trim() !== desiredInvoice ||
        String(row.project_ap_bill_no || '').trim() !== desiredBill;

      if (needsUpdate) {
        plan.push({
          id: Number(row.id),
          oldDocno: currentDocno,
          newDocno: finalDocno,
          invoiceNumber: desiredInvoice,
          billNumber: desiredBill
        });
      }
    }

    for (const item of plan) {
      await queryAsync(
        'UPDATE projects SET project_docno = ?, project_ar_invoice_no = ?, project_ap_bill_no = ? WHERE id = ?',
        [item.newDocno, item.invoiceNumber, item.billNumber, item.id]
      );

      if (item.oldDocno && item.oldDocno !== item.newDocno) {
        await queryAsync(
          `UPDATE accounts_receivable
           SET invoice_number = ?, project_docno = ?
           WHERE project_id = ? OR project_docno = ?`,
          [item.invoiceNumber, item.newDocno, item.id, item.oldDocno]
        );
      } else {
        await queryAsync(
          `UPDATE accounts_receivable
           SET invoice_number = ?, project_docno = ?
           WHERE project_id = ? OR project_docno = ?`,
          [item.invoiceNumber, item.newDocno, item.id, item.newDocno]
        );
      }
    }

    projectDocnoMigrationCompleted = true;
    console.log(`✅ Project docno migration complete (${plan.length} updates applied)`);
  } catch (err) {
    projectDocnoMigrationStarted = false;
    if ((err && err.code === 'ER_NO_SUCH_TABLE') && attempt < 12) {
      setTimeout(() => {
        migrateExistingProjectDocnos({ attempt: attempt + 1 }).catch(migrationErr => {
          console.error('Project docno migration retry failed:', migrationErr);
        });
      }, 1000);
      return;
    }
    console.error('Project docno migration error:', err);
  } finally {
    projectDocnoMigrationStarted = false;
  }
}

app.get('/api/transactions/next-docno', protectAdminOnly, (req, res) => {
  generateNextTransactionDocno((err, docno) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ docno });
  }, req.query.business_entity_id);
});

app.get('/api/projects/next-docno', protectAdmin, (req, res) => {
  peekNextProjectDocno((err, projectDocno) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ project_docno: projectDocno });
  }, req.query.business_entity_id);
});

app.get('/api/service-orders/next-number', protectAdmin, async (req, res) => {
  try {
    const businessEntityId = await resolveBusinessEntityId(req.query.business_entity_id);
    const so_number = await generateNextEntityDocumentNo({
      businessEntityId,
      documentType: 'service-order',
      prefix: 'SO',
      tableName: 'service_orders',
      columnName: 'so_number'
    });
    res.json({ so_number });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Unable to generate service order number.' });
  }
});

app.get('/api/procurement/requisitions/next-number', protectAdmin, async (req, res) => {
  try {
    const businessEntityId = await resolveBusinessEntityId(req.query.business_entity_id);
    const pr_number = await generateNextEntityDocumentNo({
      businessEntityId,
      documentType: 'purchase-requisition',
      prefix: 'PR',
      tableName: 'purchase_requisitions',
      columnName: 'pr_number'
    });
    res.json({ pr_number });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Unable to generate PR number.' });
  }
});

app.get('/api/procurement/purchase-orders/next-number', protectAdmin, async (req, res) => {
  try {
    const businessEntityId = await resolveBusinessEntityId(req.query.business_entity_id);
    const po_number = await peekNextEntityDocumentNo({
      businessEntityId,
      documentType: 'purchase-order',
      prefix: 'PO',
      tableName: 'purchase_orders',
      columnName: 'po_number'
    });
    res.json({ po_number });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Unable to generate PO number.' });
  }
});

app.get('/api/procurement/goods-receipts/next-number', protectAdmin, (req, res) => {
  res.json({ grn_number: generateCode('GRN') });
});

app.get('/api/bills/next-number', protectAdmin, async (req, res) => {
  try {
    const businessEntityId = await resolveBusinessEntityId(req.query.business_entity_id);
    const bill_number = await peekNextEntityDocumentNo({
      businessEntityId,
      documentType: 'ap-bill',
      prefix: 'BILL',
      tableName: 'accounts_payable',
      columnName: 'bill_number'
    });
    res.json({ bill_number });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Unable to generate bill number.' });
  }
});
app.post('/api/transactions', [
  protectAdminOnly,
  upload.single('pdf_file')
], (req, res) => {
  const d = req.body;
  const tin = normalizeTin(d.tin);
  const phone = normalizePhone(d.phone);
  let projectId = Number(d.project_id || 0) || null;
  const serviceOrderInputId = Number(d.service_order_id || 0) || null;
  const qty = Number(d.qty || 1) || 1;
  const amount = Number(d.amount || 0);
  const downpayment = Number(d.downpayment || 0);
  let unitPrice = Number(d.unitprice || 0);
  let description = String(d.description || '').trim();
  const requestedStatus = normalizeTransactionStatusValue(d.status);
  let status = requestedStatus || ((amount - downpayment) <= 0 ? 'paid' : (downpayment > 0 ? 'partial' : 'unpaid'));

  if (phone && !isValidPhone(phone)) {
    return res.status(400).json({ error: 'Phone number must be digits only, 7 to 15 digits.' });
  }

  const pdfFilename = req.file ? req.file.filename : null;
  const insertTransaction = async (docno) => {
    try {
      const serviceOrderContext = await resolveTransactionServiceOrderContext(projectId, serviceOrderInputId);
      projectId = serviceOrderContext.projectId;
      const serviceOrderId = serviceOrderContext.serviceOrderId;
      const serviceOrderRow = serviceOrderContext.serviceOrderRow;
      const businessEntityId = await resolveBusinessEntityId(d.business_entity_id);
      const companyId = await resolveTransactionCompanyId(projectId, serviceOrderRow);
      const projectTxNo = projectId ? await getNextProjectTransactionNo(projectId) : null;
      const finalAmount = Number(amount || 0);
      status = requestedStatus || ((finalAmount - downpayment) <= 0 ? 'paid' : (downpayment > 0 ? 'partial' : 'unpaid'));

      db.query(`
      INSERT INTO transactions
        (docno, type, client, address, tin, bizstyle, phone,
         description, archived, archived_auto, qty, unitprice, amount, downpayment, checkno, pono, date,
         project_start_date, project_end_date, status, pdfFilename, business_entity_id, project_id, company_id, service_order_id, project_tx_no,
         project_members, member_role, member_phone,
         project_members_2, member_role_2, member_phone_2,
         project_members_3, member_role_3, member_phone_3)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
              ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      docno, d.type, d.client,
      d.address    || null, tin         || null,
      d.bizstyle   || null, phone       || null,
      description || null,
      0, 0,
      qty, unitPrice || null,
      finalAmount, downpayment || 0,
      d.checkno    || null, d.pono      || null,
      d.date, d.project_start_date || null, d.project_end_date || null, status, pdfFilename,
      businessEntityId, projectId, companyId, serviceOrderId, projectTxNo,
      null, null, null,
      null, null, null,
      null, null, null
    ], (err, result) => {
      if (err) {
        if (err.code === 'ER_DUP_ENTRY')
          return res.status(409).json({ error: 'Doc No. ay ginagamit na.' });
        return res.status(500).json({ error: err.message });
      }
      const newTransaction = {
        id: result.insertId,
        type: d.type,
        client: d.client,
        docno,
        date: d.date,
        amount: finalAmount,
        downpayment,
        status,
        business_entity_id: businessEntityId,
        project_id: projectId,
        company_id: companyId,
        service_order_id: serviceOrderId,
        service_order_no: serviceOrderRow?.so_number || null,
        project_tx_no: projectTxNo,
        archived: 0,
        description: description || null
      };

      const finishCreate = (syncErr, stockErr) => {
        if (syncErr || stockErr) {
          const warningParts = [];
          if (syncErr) warningParts.push('Accounts Receivable sync warning');
          if (stockErr) warningParts.push('inventory stock warning');
          const warningText = warningParts.join(' and ');
          if (syncErr) {
            logAction(req, 'CREATE_TRANSACTION', `Added ${d.type}: ${docno} for ${d.client} (with AR sync warning)`);
          } else {
            logAction(req, 'CREATE_TRANSACTION', `Added ${d.type}: ${docno} for ${d.client} (with inventory stock warning)`);
          }
          return res.json({
            id: result.insertId,
            docno,
            project_tx_no: projectTxNo,
            warning: `Transaction saved, pero may ${warningText}.`
          });
        }
        logAction(req, 'CREATE_TRANSACTION', `Added ${d.type}: ${docno} for ${d.client}`);
        res.json({ id: result.insertId, docno, project_tx_no: projectTxNo });
      };

      const afterStock = (stockErr) => {
        syncReceivableForTransaction(newTransaction, (syncErr) => {
          finishCreate(syncErr, stockErr);
        });
      };

      syncReceivableForTransaction(newTransaction, (syncErr) => {
        finishCreate(syncErr, null);
      });
    });
    } catch (err) {
      console.error('Create transaction project sequence error:', err);
      res.status(500).json({ error: err.message || 'Unable to save transaction.' });
    }
  };

  if (String(d.docno || '').trim()) {
    return insertTransaction(String(d.docno).trim());
  }

  generateNextTransactionDocno((err, docno) => {
    if (err) return res.status(500).json({ error: err.message });
    insertTransaction(docno);
  }, d.business_entity_id);
});

app.put('/api/transactions/:id/archive', protectAdminOnly, (req, res) => {
  db.query('SELECT id, type, client, docno, date, amount, downpayment, status, description, project_id, service_order_id, project_tx_no FROM transactions WHERE id = ?', [req.params.id], (findErr, rows) => {
    if (findErr) return res.status(500).json({ error: findErr.message });
    if (!rows.length) return res.status(404).json({ error: 'Record not found' });

      db.query('UPDATE transactions SET archived = 1, archived_auto = 0 WHERE id = ?', [req.params.id], (err, result) => {
      if (err) return res.status(500).json({ error: err.message });
      if (result.affectedRows === 0)
        return res.status(404).json({ error: 'Record not found' });

      const currentRow = rows[0];
      syncReceivableForTransaction({ ...currentRow, archived: 1 }, (syncErr) => {
        if (syncErr) {
          console.error('AR sync archive error:', syncErr);
          return res.status(500).json({ error: 'Archived record but failed to sync accounts receivable.' });
        }
        logAction(req, 'ARCHIVE_TRANSACTION', `Archived record ID: ${req.params.id}`);
        res.json({ success: true });
      });
    });
  });
});

app.put('/api/transactions/:id/restore', protectAdminOnly, (req, res) => {
  db.query('UPDATE transactions SET archived = 0, archived_auto = 0 WHERE id = ?', [req.params.id], (err, result) => {
    if (err) return res.status(500).json({ error: err.message });
    if (result.affectedRows === 0)
      return res.status(404).json({ error: 'Record not found' });

    db.query('SELECT id, type, client, docno, date, amount, downpayment, status, description, archived, project_id, service_order_id FROM transactions WHERE id = ?', [req.params.id], (findErr, rows) => {
      if (findErr) return res.status(500).json({ error: findErr.message });
      if (!rows.length) return res.status(404).json({ error: 'Record not found' });

      const restoredRow = rows[0];
      syncReceivableForTransaction(restoredRow, (syncErr) => {
        if (syncErr) {
          console.error('AR sync restore error:', syncErr);
          return res.status(500).json({ error: 'Restored record but failed to sync accounts receivable.' });
        }
        logAction(req, 'RESTORE_TRANSACTION', `Restored record ID: ${req.params.id}`);
        res.json({ success: true });
      });
    });
  });
});

app.delete('/api/transactions/:id', protectAdminOnly, (req, res) => {
  logAction(req, 'BLOCKED_HARD_DELETE', `Blocked permanent delete attempt for transaction ID: ${req.params.id}`, 'audit');
  return res.status(409).json({
    error: 'Permanent delete is disabled. Please archive and restore records instead.'
  });
});

app.get('/api/transactions/archived', protectAdmin, (req, res) => {
  runArchiveMaintenance((maintenanceErr) => {
    if (maintenanceErr) {
      console.error('Archived archive maintenance error:', maintenanceErr);
      return res.status(500).json({ error: maintenanceErr.message });
    }

    db.query(`
      SELECT t.id, t.docno, t.type, t.client, t.address, t.tin, t.bizstyle, t.phone, t.service_order_id, t.project_tx_no,
             so.so_number AS service_order_no,
             so.service_title AS service_order_title,
             t.description AS description, project_members, member_role, member_phone,
             project_members_2, member_role_2, member_phone_2,
             project_members_3, member_role_3, member_phone_3,
             qty, unitprice, amount, downpayment, t.project_id AS project_id, checkno, pono,
             DATE_FORMAT(date, '%Y-%m-%d') AS date,
             DATE_FORMAT(project_start_date, '%Y-%m-%d') AS project_start_date,
             DATE_FORMAT(project_end_date, '%Y-%m-%d') AS project_end_date,
             status, pdfFilename
      FROM transactions t
      LEFT JOIN service_orders so ON so.id = t.service_order_id
      LEFT JOIN accounts_receivable ar ON ar.transaction_id = t.id
      WHERE t.archived = 1
      ORDER BY t.id DESC
    `, (err, rows) => {
      if (err) {
        console.error('Archived transaction query error:', err);
        return res.status(500).json({ error: err.message });
      }
      res.json(rows);
    });
  });
});

// ==================== INVENTORY API ====================

app.get('/api/products', protectAdmin, (req, res) => {
  db.query('SELECT * FROM products WHERE is_active = TRUE ORDER BY name ASC', (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

app.post('/api/products', protectAdmin, (req, res) => {
  const { sku, name, category, description, unit_price, reorder_level } = req.body;
  if (!sku || !name || !unit_price)
    return res.status(400).json({ error: 'SKU, Name, and Unit Price are required' });

  findTextDuplicate('products', 'sku', sku, 0, (dupErr, duplicate) => {
    if (dupErr) return res.status(500).json({ error: dupErr.message });
    if (duplicate) return res.status(409).json({ error: 'SKU already exists', field: 'sku' });

    db.query(
      'INSERT INTO products (sku, name, category, description, unit_price, reorder_level) VALUES (?, ?, ?, ?, ?, ?)',
      [sku, name, category || null, description || null, unit_price, reorder_level || 10],
      (err, result) => {
        if (err) {
          if (err.code === 'ER_DUP_ENTRY')
            return res.status(409).json({ error: 'SKU already exists', field: 'sku' });
          return res.status(500).json({ error: err.message });
        }
        res.json({ id: result.insertId });
      }
    );
  });
});

app.get('/api/warehouses', protectAdmin, (req, res) => {
  db.query('SELECT * FROM warehouses WHERE is_active = TRUE ORDER BY name ASC', (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

app.post('/api/warehouses', protectAdmin, (req, res) => {
  const { name, location } = req.body;
  if (!name) return res.status(400).json({ error: 'Warehouse name is required' });
  findTextDuplicate('warehouses', 'name', name, 0, (dupErr, duplicate) => {
    if (dupErr) return res.status(500).json({ error: dupErr.message });
    if (duplicate) return res.status(409).json({ error: 'Warehouse name already exists', field: 'name' });

    db.query(
      'INSERT INTO warehouses (name, location) VALUES (?, ?)',
      [name, location || null],
      (err, result) => {
        if (err) {
          if (err.code === 'ER_DUP_ENTRY')
            return res.status(409).json({ error: 'Warehouse name already exists', field: 'name' });
          return res.status(500).json({ error: err.message });
        }
        res.json({ id: result.insertId });
      }
    );
  });
});

app.get('/api/stock/product/:productId', protectAdmin, (req, res) => {
  db.query(`
    SELECT s.id, s.product_id, s.warehouse_id, w.name AS warehouse_name, s.quantity
    FROM stock s
    JOIN warehouses w ON s.warehouse_id = w.id
    WHERE s.product_id = ?
  `, [req.params.productId], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

app.get('/api/stock/total/:productId', protectAdmin, (req, res) => {
  db.query('SELECT SUM(quantity) AS total_quantity FROM stock WHERE product_id = ?',
    [req.params.productId], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ total_quantity: rows[0]?.total_quantity || 0 });
  });
});

// ==================== EDIT TRANSACTION (PUT) ====================
app.put('/api/transactions/:id', [
  protectAdminOnly,
  upload.single('pdf_file')
], (req, res) => {
  const d = req.body;
  const tin = normalizeTin(d.tin);
  const phone = normalizePhone(d.phone);
  const memberPhone = normalizePhone(d.member_phone);
  const memberPhone2 = normalizePhone(d.member_phone_2);
  const memberPhone3 = normalizePhone(d.member_phone_3);
  let projectId = Number(d.project_id || 0) || null;
  const serviceOrderInputId = Number(d.service_order_id || 0) || null;
  const qty = Number(d.qty || 1) || 1;
  let unitPrice = Number(d.unitprice || 0);
  let description = String(d.description || '').trim();
  const amount = Number(d.amount || 0);
  const downpayment = Number(d.downpayment || 0);
  const requestedStatus = normalizeTransactionStatusValue(d.status);
  let status = requestedStatus || ((amount - downpayment) <= 0 ? 'paid' : (downpayment > 0 ? 'partial' : 'unpaid'));

  if (phone && !isValidPhone(phone)) {
    return res.status(400).json({ error: 'Phone number must be digits only, 7 to 15 digits.' });
  }

  if (memberPhone && !isValidPhone(memberPhone)) {
    return res.status(400).json({ error: 'Member phone number must be digits only, 7 to 15 digits.' });
  }

  if (memberPhone2 && !isValidPhone(memberPhone2)) {
    return res.status(400).json({ error: 'Member 2 phone number must be digits only, 7 to 15 digits.' });
  }

  if (memberPhone3 && !isValidPhone(memberPhone3)) {
    return res.status(400).json({ error: 'Member 3 phone number must be digits only, 7 to 15 digits.' });
  }

  db.query(
    'SELECT pdfFilename, project_id, service_order_id, project_tx_no, type, qty, docno, description FROM transactions WHERE id = ?',
    [req.params.id],
    async (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });

      const currentRow = (rows && rows.length > 0) ? rows[0] : null;
      const currentFile = currentRow ? currentRow.pdfFilename : null;
      let finalPdf = d.pdfFilename || null;

      if (req.file) {
        if (currentFile) {
          const oldPath = path.join(UPLOAD_DIR, path.basename(currentFile));
          if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
        }
        finalPdf = req.file.filename;
      } else if (!d.pdfFilename && currentFile) {
        const oldPath = path.join(UPLOAD_DIR, path.basename(currentFile));
        if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
        finalPdf = null;
      } else {
        finalPdf = d.pdfFilename || currentFile;
      }

      const serviceOrderContext = await resolveTransactionServiceOrderContext(projectId, serviceOrderInputId || currentRow?.service_order_id || null);
      projectId = serviceOrderContext.projectId;
      const finalServiceOrderId = serviceOrderContext.serviceOrderId;
      const serviceOrderRow = serviceOrderContext.serviceOrderRow;
      const businessEntityId = await resolveBusinessEntityId(d.business_entity_id);
      const companyId = await resolveTransactionCompanyId(projectId, serviceOrderRow);

      let finalProjectTxNo = null;
      if (projectId) {
        finalProjectTxNo = await getNextProjectTransactionNo(projectId, req.params.id);
      }

      const finalAmount = Number(amount || 0);
      status = requestedStatus || ((finalAmount - downpayment) <= 0 ? 'paid' : (downpayment > 0 ? 'partial' : 'unpaid'));

      db.query(`
        UPDATE transactions SET
          docno = ?, type = ?, client = ?, address = ?, tin = ?,
          bizstyle = ?, phone = ?, description = ?, qty = ?,
          unitprice = ?, amount = ?, downpayment = ?, business_entity_id = ?, project_id = ?, company_id = ?, service_order_id = ?, project_tx_no = ?, checkno = ?, pono = ?, date = ?,
          project_start_date = ?, project_end_date = ?,
          status = ?, pdfFilename = ?,
          project_members = ?, member_role = ?, member_phone = ?,
          project_members_2 = ?, member_role_2 = ?, member_phone_2 = ?,
          project_members_3 = ?, member_role_3 = ?, member_phone_3 = ?
        WHERE id = ?
      `, [
        d.docno, d.type, d.client,
        d.address || null, tin || null,
        d.bizstyle || null, phone || null,
        d.description || null,
        d.qty || 1, d.unitprice || null,
        finalAmount, downpayment || 0, businessEntityId, projectId, companyId, finalServiceOrderId, finalProjectTxNo,
        d.checkno || null, d.pono || null,
        d.date, d.project_start_date || null, d.project_end_date || null, status, finalPdf,
        d.project_members || null, d.member_role || null, memberPhone || null,
        d.project_members_2 || null, d.member_role_2 || null, memberPhone2 || null,
        d.project_members_3 || null, d.member_role_3 || null, memberPhone3 || null,
        req.params.id
      ], (updateErr, result) => {
        if (updateErr) {
          if (updateErr.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({ error: 'Doc No. ay ginagamit na.' });
          }
          return res.status(500).json({ error: updateErr.message });
        }
        if (result.affectedRows === 0) {
          return res.status(404).json({ error: 'Record not found' });
        }

        syncReceivableForTransaction({
          id: Number(req.params.id),
          type: d.type,
          client: d.client,
          docno: d.docno,
          date: d.date,
          amount: finalAmount,
          downpayment,
          status,
          business_entity_id: businessEntityId,
          archived: 0,
          description: d.description || null,
          project_id: projectId,
          company_id: companyId,
          service_order_id: finalServiceOrderId,
          service_order_no: serviceOrderRow?.so_number || null
        }, (syncErr) => {
          if (syncErr) {
            console.error('AR sync update error:', syncErr);
            logAction(req, 'UPDATE_TRANSACTION', `Modified Doc No: ${d.docno} (with AR sync warning)`);
            return res.json({
              success: true,
              warning: 'Transaction updated, pero may issue sa Accounts Receivable sync.'
            });
          }
          logAction(req, 'UPDATE_TRANSACTION', `Modified Doc No: ${d.docno}`);
          res.json({ success: true });
        });
      });
    }
  );
});

app.post('/api/stock-movements', protectAdmin, (req, res) => {
  const { product_id, warehouse_id, movement_type, quantity, source_type, reference_doc, notes } = req.body;
  if (!product_id || !warehouse_id || !movement_type || !quantity)
    return res.status(400).json({ error: 'Missing required fields' });

  const normalizedSourceType = normalizeStockMovementSourceType(source_type);
  const sourceReference = String(reference_doc || '').trim();
  if (normalizedSourceType !== 'manual' && !sourceReference) {
    return res.status(400).json({ error: 'Source reference is required for AP-linked stock movements.' });
  }

  db.query(
    'INSERT IGNORE INTO stock (product_id, warehouse_id, quantity) VALUES (?, ?, 0)',
    [product_id, warehouse_id],
    (err) => {
      if (err) return res.status(500).json({ error: err.message });
      db.query(
        'INSERT INTO stock_movements (product_id, warehouse_id, movement_type, quantity, source_type, reference_doc, notes) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [product_id, warehouse_id, movement_type, quantity, normalizedSourceType, sourceReference || null, notes || null],
        (err, result) => {
          if (err) return res.status(500).json({ error: err.message });
          const qtyChange = movement_type === 'inbound' ? quantity : -quantity;
          db.query(
            'UPDATE stock SET quantity = quantity + ? WHERE product_id = ? AND warehouse_id = ?',
            [qtyChange, product_id, warehouse_id],
            (err) => {
              if (err) return res.status(500).json({ error: err.message });
              res.json({ id: result.insertId });
            }
          );
        }
      );
    }
  );
});

app.get('/api/stock-movements/:productId', protectAdmin, (req, res) => {
  db.query(`
    SELECT sm.*, p.name AS product_name, w.name AS warehouse_name, t.docno AS transaction_docno
    FROM stock_movements sm
    JOIN products p ON sm.product_id = p.id
    JOIN warehouses w ON sm.warehouse_id = w.id
    LEFT JOIN transactions t ON t.id = sm.transaction_id
    WHERE sm.product_id = ?
    ORDER BY sm.created_at DESC
  `, [req.params.productId], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// Get all current stock levels across all warehouses
app.get('/api/stock', protectAdmin, (req, res) => {
  db.query(`
    SELECT s.*, p.name AS product_name, p.sku, w.name AS warehouse_name
    FROM stock s
    JOIN products p ON s.product_id = p.id
    JOIN warehouses w ON s.warehouse_id = w.id
    ORDER BY p.name ASC
  `, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// Get all stock movements (for inventory module)
app.get('/api/stock-movements', protectAdmin, (req, res) => {
  db.query(`
    SELECT sm.*, p.name AS product_name, p.sku AS product_sku, w.name AS warehouse_name, t.docno AS transaction_docno
    FROM stock_movements sm
    JOIN products p ON sm.product_id = p.id
    JOIN warehouses w ON sm.warehouse_id = w.id
    LEFT JOIN transactions t ON t.id = sm.transaction_id
    ORDER BY sm.created_at DESC
  `, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// ==================== ACCOUNTS PAYABLE API ====================

app.get('/api/vendors', protectAdmin, (req, res) => {
  const includeInactive = String(req.query.include_inactive || '0') === '1';
  const whereClause = includeInactive ? '' : 'WHERE COALESCE(v.is_active, TRUE) = TRUE';
  db.query(`
    SELECT
      v.*,
      COALESCE(c.company_no, be.entity_code) AS company_no,
      COALESCE(c.company_name, be.company_name) AS company_name
    FROM vendors v
    LEFT JOIN company_registry c ON c.id = v.company_id
    LEFT JOIN business_entities be ON be.id = v.business_entity_id
    ${whereClause}
    ORDER BY COALESCE(v.vendor_no, '') ASC, v.vendor_name ASC
  `, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

app.get('/api/vendors/next-no', protectAdmin, (req, res) => {
  generateNextVendorNo((err, vendorNo) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ vendor_no: vendorNo });
  });
});

app.get('/api/company-registry/next-no', protectAdmin, (req, res) => {
  generateNextCompanyNo((err, companyNo) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ company_no: companyNo });
  });
});

app.get('/api/company-registry', protectAdminOnly, async (req, res) => {
  try {
    const includeArchived = String(req.query.include_archived || '0') === '1';
    const businessEntityId = normalizeBusinessEntityId(req.query.business_entity_id);
    const clauses = [];
    const params = [];
    if (!includeArchived) clauses.push('COALESCE(archived, 0) = 0');
    if (businessEntityId) {
      clauses.push('business_entity_id = ?');
      params.push(businessEntityId);
    }
    const whereClause = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const rows = await queryAsync(`SELECT * FROM company_registry ${whereClause} ORDER BY company_name ASC`, params);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/business-entities', protectAdmin, async (req, res) => {
  try {
    const includeInactive = String(req.query.include_inactive || '0') === '1';
    const whereClause = includeInactive ? '' : "WHERE status = 'active'";
    const rows = await queryAsync(`
      SELECT *
      FROM business_entities
      ${whereClause}
      ORDER BY is_default DESC, company_name ASC
    `);
    res.json(rows);
  } catch (err) {
    console.error('Business entities load error:', err);
    res.status(500).json({ error: err.message || 'Unable to load operating companies.' });
  }
});

app.get('/api/public-business-entities', async (req, res) => {
  try {
    const rows = await queryAsync(`
      SELECT id, entity_code, company_name, is_default
      FROM business_entities
      WHERE status = 'active'
      ORDER BY is_default DESC, company_name ASC
    `);
    res.json(rows);
  } catch (err) {
    console.error('Public business entities load error:', err);
    res.status(500).json({ error: 'Unable to load workspaces.' });
  }
});

app.post('/api/business-entities/:id/vendor-profile', protectAdminOnly, async (req, res) => {
  const businessEntityId = Number(req.params.id || 0);
  if (!businessEntityId) return res.status(400).json({ error: 'Invalid business entity id.' });

  try {
    const entityRows = await queryAsync(
      `SELECT id, entity_code, company_name, address, contact_person, phone, email, tin, status
       FROM business_entities
       WHERE id = ?
       LIMIT 1`,
      [businessEntityId]
    );

    if (!entityRows.length) {
      return res.status(404).json({ error: 'Business entity not found.' });
    }

    const entity = entityRows[0];
    if (String(entity.status || 'active').toLowerCase() === 'inactive') {
      return res.status(400).json({ error: 'Activate the business entity before creating its vendor profile.' });
    }

    const existingRows = await queryAsync(
      'SELECT id, vendor_no, vendor_name, COALESCE(is_active, TRUE) AS is_active FROM vendors WHERE business_entity_id = ? LIMIT 1',
      [businessEntityId]
    );

    if (existingRows.length) {
      return res.json({
        id: existingRows[0].id,
        vendor_no: existingRows[0].vendor_no,
        vendor_name: existingRows[0].vendor_name,
        business_entity_id: businessEntityId,
        already_exists: true,
        is_active: Number(existingRows[0].is_active || 0) ? 1 : 0
      });
    }

    const vendorName = String(entity.company_name || '').trim();
    const vendorContact = String(entity.contact_person || '').trim() || null;
    const vendorEmail = String(entity.email || '').trim() || null;
    const vendorPhone = normalizePhone(entity.phone) || null;
    const vendorAddress = String(entity.address || '').trim() || null;
    const vendorTinDigits = normalizeTin(entity.tin);
    const vendorTinFormatted = vendorTinDigits ? formatTin(vendorTinDigits) : null;

    if (!vendorName) return res.status(400).json({ error: 'Business title is required before creating a vendor profile.' });
    if (vendorEmail && !isValidEmail(vendorEmail)) {
      return res.status(400).json({ error: 'Business entity email must be valid before creating a vendor profile.' });
    }
    if (vendorPhone && !isValidPhone(vendorPhone)) {
      return res.status(400).json({ error: 'Business entity phone number must be digits only, 7 to 15 digits.' });
    }
    if (vendorTinDigits && vendorTinDigits.length !== 12) {
      return res.status(400).json({ error: 'Business entity TIN must follow 000-000-000-000 format.' });
    }

    const duplicate = await new Promise((resolve, reject) => {
      findVendorDuplicate(vendorPhone, vendorTinFormatted, vendorEmail, 0, (dupErr, row) => {
        if (dupErr) reject(dupErr);
        else resolve(row || null);
      });
    });

    if (duplicate) {
      return res.status(409).json({
        error: duplicate.field === 'tin'
          ? 'TIN already exists in Vendor Directory.'
          : (duplicate.field === 'vendor_email'
            ? 'Email already exists in Vendor Directory.'
            : 'Vendor phone already exists in Vendor Directory.'),
        field: duplicate.field
      });
    }

    const vendorNo = await new Promise((resolve, reject) => {
      generateNextVendorNo((noErr, nextNo) => {
        if (noErr) reject(noErr);
        else resolve(nextNo);
      });
    });

    const result = await queryAsync(
      'INSERT INTO vendors (business_entity_id, vendor_no, vendor_name, contact_person, email, phone, address, tin, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, TRUE)',
      [businessEntityId, vendorNo, vendorName, vendorContact, vendorEmail, vendorPhone, vendorAddress, vendorTinFormatted]
    );

    logAction(req, 'CREATE_VENDOR', `Vendor No: ${vendorNo} | Business Entity ID: ${businessEntityId} | Entity Code: ${entity.entity_code || ''} | Business Title: ${vendorName} | Created vendor profile from business entity.`);

    res.json({
      id: result.insertId,
      business_entity_id: businessEntityId,
      vendor_no: vendorNo,
      vendor_name: vendorName,
      already_exists: false,
      is_active: 1
    });
  } catch (err) {
    console.error('Create vendor from business entity error:', err);
    return res.status(500).json({ error: err.message || 'Unable to create vendor profile.' });
  }
});

app.post('/api/business-entities', protectAdminOnly, async (req, res) => {
  try {
    const entityCode = String(req.body.entity_code || '').trim() || generateCode('ENT');
    const companyName = String(req.body.company_name || '').trim();
    const isDefault = Number(req.body.is_default || 0) ? 1 : 0;
    if (!companyName) return res.status(400).json({ error: 'Company name is required.' });

    if (isDefault) {
      await queryAsync('UPDATE business_entities SET is_default = 0');
    }

    const result = await queryAsync(
      `INSERT INTO business_entities
        (entity_code, company_name, address, contact_person, phone, email, tin, status, is_default)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        entityCode,
        companyName,
        req.body.address || null,
        req.body.contact_person || null,
        normalizePhone(req.body.phone) || null,
        req.body.email || null,
        normalizeTin(req.body.tin) || null,
        String(req.body.status || 'active').trim().toLowerCase() === 'inactive' ? 'inactive' : 'active',
        isDefault
      ]
    );
    res.json({ id: result.insertId, entity_code: entityCode });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'Operating company already exists.' });
    }
    console.error('Create business entity error:', err);
    res.status(500).json({ error: err.message || 'Unable to save operating company.' });
  }
});

app.put('/api/business-entities/:id', protectAdminOnly, async (req, res) => {
  const businessEntityId = Number(req.params.id || 0);
  if (!businessEntityId) return res.status(400).json({ error: 'Invalid business entity id.' });

  try {
    const entityCode = String(req.body.entity_code || '').trim() || generateCode('ENT');
    const companyName = String(req.body.company_name || '').trim();
    const isDefault = Number(req.body.is_default || 0) ? 1 : 0;
    if (!companyName) return res.status(400).json({ error: 'Company name is required.' });

    if (isDefault) {
      await queryAsync('UPDATE business_entities SET is_default = 0 WHERE id <> ?', [businessEntityId]);
    }

    const result = await queryAsync(
      `UPDATE business_entities
       SET entity_code = ?, company_name = ?, address = ?, contact_person = ?, phone = ?, email = ?, tin = ?, status = ?, is_default = ?
       WHERE id = ?`,
      [
        entityCode,
        companyName,
        req.body.address || null,
        req.body.contact_person || null,
        normalizePhone(req.body.phone) || null,
        req.body.email || null,
        normalizeTin(req.body.tin) || null,
        String(req.body.status || 'active').trim().toLowerCase() === 'inactive' ? 'inactive' : 'active',
        isDefault,
        businessEntityId
      ]
    );

    if (!result.affectedRows) {
      return res.status(404).json({ error: 'Business entity not found.' });
    }

    await queryAsync(
      `UPDATE vendors
       SET vendor_name = ?, contact_person = ?, email = ?, phone = ?, address = ?, tin = ?
       WHERE business_entity_id = ?`,
      [
        companyName,
        req.body.contact_person || null,
        req.body.email || null,
        normalizePhone(req.body.phone) || null,
        req.body.address || null,
        normalizeTin(req.body.tin) ? formatTin(req.body.tin) : null,
        businessEntityId
      ]
    );

    res.json({ success: true, id: businessEntityId, entity_code: entityCode });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'Operating company already exists.' });
    }
    console.error('Update business entity error:', err);
    res.status(500).json({ error: err.message || 'Unable to update operating company.' });
  }
});

app.post('/api/company-registry', protectAdminOnly, async (req, res) => {
  try {
    const {
      company_name,
      branch_code,
      address,
      contact_person,
      phone,
      email,
      tin,
      industry,
      status,
      notes
    } = req.body;
    const companyName = String(company_name || '').trim();
    const companyBranchCode = String(branch_code || '').trim().slice(0, 10);
    const companyTin = String(tin || '').trim();
    const companyPhone = normalizePhone(phone);
    const companyTinDigits = normalizeTin(companyTin);
    const companyTinFormatted = formatTin(companyTinDigits);
    const companyBranchValue = companyBranchCode || '000';
    const businessEntityId = normalizeBusinessEntityId(req.body.business_entity_id);

    if (!companyName) return res.status(400).json({ error: 'Company name is required' });
    if (companyPhone && !isValidPhone(companyPhone)) {
      return res.status(400).json({ error: 'Company phone number must be digits only, 7 to 15 digits.' });
    }
    if (companyTinDigits.length !== 12) {
      return res.status(400).json({ error: 'TIN must follow 000-000-000-000 format.', field: 'tin' });
    }

    findCompanyRegistryDuplicate(companyName, companyPhone, companyTin, 0, businessEntityId, (dupErr, duplicate) => {
      if (dupErr) return res.status(500).json({ error: dupErr.message });
      if (duplicate) {
        return res.status(409).json({
          error: duplicate.field === 'tin'
            ? 'TIN already exists in Company Registry.'
            : duplicate.field === 'phone'
              ? 'Company phone already exists in Company Registry.'
            : 'Company name already exists in Company Registry.',
          field: duplicate.field
        });
      }

      generateNextCompanyNo((noErr, companyNo) => {
        if (noErr) return res.status(500).json({ error: noErr.message });

        db.query(
          `INSERT INTO company_registry
            (company_no, business_entity_id, branch_code, company_name, address, contact_person, phone, email, tin, industry, status, notes)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            companyNo,
            businessEntityId,
            companyBranchValue,
            companyName,
            address || null,
            contact_person || null,
            companyPhone || null,
            email || null,
            companyTinFormatted || null,
            industry || null,
            status || 'active',
            notes || null
          ],
          (err, result) => {
            if (err) {
              if (err.code === 'ER_DUP_ENTRY') {
                return res.status(409).json({ error: 'Company name already exists in Company Registry.', field: 'company_name' });
              }
              return res.status(500).json({ error: err.message });
            }
            logAction(req, 'CREATE_COMPANY', `Company ID: ${result.insertId} | Company No: ${companyNo} | Company Name: ${companyName} | Created company record.`);
            res.json({ id: result.insertId, company_no: companyNo, business_entity_id: businessEntityId });
          });
      });
    });
  } catch (err) {
    res.status(400).json({ error: err.message || 'Unable to save company.' });
  }
});

app.put('/api/company-registry/:id', protectAdminOnly, async (req, res) => {
  try {
    const companyId = Number(req.params.id);
    const {
      company_name,
      branch_code,
      address,
      status,
      contact_person,
      phone,
      email,
      tin,
      industry,
      notes
    } = req.body;
    const companyName = String(company_name || '').trim();
    const companyBranchCode = String(branch_code || '').trim().slice(0, 10);
    const companyTin = String(tin || '').trim();
    const companyPhone = normalizePhone(phone);
    const companyTinDigits = normalizeTin(companyTin);
    const companyTinFormatted = formatTin(companyTinDigits);
    const companyBranchValue = companyBranchCode || '000';
    const businessEntityId = normalizeBusinessEntityId(req.body.business_entity_id);

    if (!companyId) {
      return res.status(400).json({ error: 'Invalid company id' });
    }

    if (!companyName) {
      return res.status(400).json({ error: 'Company name is required' });
    }

    if (companyPhone && !isValidPhone(companyPhone)) {
      return res.status(400).json({ error: 'Company phone number must be digits only, 7 to 15 digits.' });
    }
    if (companyTinDigits.length !== 12) {
      return res.status(400).json({ error: 'TIN must follow 000-000-000-000 format.', field: 'tin' });
    }

    findCompanyRegistryDuplicate(companyName, companyPhone, companyTin, companyId, businessEntityId, (dupErr, duplicate) => {
      if (dupErr) return res.status(500).json({ error: dupErr.message });
      if (duplicate) {
        return res.status(409).json({
          error: duplicate.field === 'tin'
            ? 'TIN already exists in Company Registry.'
            : duplicate.field === 'phone'
              ? 'Company phone already exists in Company Registry.'
            : 'Company name already exists in Company Registry.',
          field: duplicate.field
        });
      }

      db.query(
        `UPDATE company_registry
         SET business_entity_id = ?, branch_code = ?, company_name = ?, address = ?, status = COALESCE(?, status), contact_person = ?, phone = ?, email = ?, tin = ?, industry = ?, notes = ?
         WHERE id = ?`,
        [
          businessEntityId,
          companyBranchValue,
          companyName,
          address || null,
          status || null,
          contact_person || null,
          companyPhone || null,
          email || null,
          companyTinFormatted || null,
          industry || null,
          notes || null,
          companyId
        ],
        (err, result) => {
          if (err) {
            if (err.code === 'ER_DUP_ENTRY') {
              return res.status(409).json({ error: 'Company name already exists in Company Registry.', field: 'company_name' });
            }
            return res.status(500).json({ error: err.message });
          }
          if (result.affectedRows === 0) return res.status(404).json({ error: 'Company not found' });
          logAction(req, 'UPDATE_COMPANY', `Company ID: ${companyId} | Company Name: ${companyName} | Updated company record.`);
          res.json({ success: true, business_entity_id: businessEntityId });
        }
      );
    });
  } catch (err) {
    res.status(400).json({ error: err.message || 'Unable to update company.' });
  }
});

app.put('/api/company-registry/:id/archive', protectAdminOnly, (req, res) => {
  const companyId = Number(req.params.id);
  if (!companyId) return res.status(400).json({ error: 'Invalid company id' });

  db.query(
    'UPDATE company_registry SET archived = 1, archived_at = CURRENT_TIMESTAMP WHERE id = ?',
    [companyId],
    (err, result) => {
      if (err) return res.status(500).json({ error: err.message });
      if (result.affectedRows === 0) return res.status(404).json({ error: 'Company not found' });
      logAction(req, 'ARCHIVE_COMPANY', `Company ID: ${companyId} | Archived company record.`);
      res.json({ success: true });
    }
  );
});

app.put('/api/company-registry/:id/restore', protectAdminOnly, (req, res) => {
  const companyId = Number(req.params.id);
  if (!companyId) return res.status(400).json({ error: 'Invalid company id' });

  db.query(
    'UPDATE company_registry SET archived = 0, archived_at = NULL WHERE id = ?',
    [companyId],
    (err, result) => {
      if (err) return res.status(500).json({ error: err.message });
      if (result.affectedRows === 0) return res.status(404).json({ error: 'Company not found' });
      logAction(req, 'RESTORE_COMPANY', `Company ID: ${companyId} | Restored company record.`);
      res.json({ success: true });
    }
  );
});

app.get('/api/company-registry/:id/history', protectAdmin, (req, res) => {
  const companyId = Number(req.params.id || 0);
  if (!companyId) return res.status(400).json({ error: 'Invalid company id' });

  db.query(
    'SELECT company_no, company_name FROM company_registry WHERE id = ? LIMIT 1',
    [companyId],
    (lookupErr, rows) => {
      if (lookupErr) return res.status(500).json({ error: lookupErr.message });
      if (!rows || !rows.length) return res.status(404).json({ error: 'Company not found' });

      const companyNo = String(rows[0].company_no || '').trim();
      const companyName = String(rows[0].company_name || '').trim();
      const patterns = [`%Company ID: ${companyId}%`];
      if (companyNo) patterns.push(`%Company No: ${companyNo}%`);
      if (companyName) patterns.push(`%Company Name: ${companyName}%`);

      db.query(
        `SELECT l.id, l.action, l.details, l.created_at, u.fullname, u.username
         FROM system_logs l
         LEFT JOIN users u ON u.id = l.user_id
         WHERE ${patterns.map(() => 'l.details LIKE ?').join(' OR ')}
         ORDER BY l.created_at DESC, l.id DESC
         LIMIT 20`,
        patterns,
        (err, logRows) => {
          if (err) return res.status(500).json({ error: err.message });
          res.json(Array.isArray(logRows) ? logRows : []);
        }
      );
    }
  );
});

app.get('/api/company-registry/:id/overview', protectAdminOnly, async (req, res) => {
  const companyId = Number(req.params.id || 0);
  if (!companyId) return res.status(400).json({ error: 'Invalid company id' });

  try {
    const [companyRows, countRows, recentProjects, recentServiceOrders] = await Promise.all([
      queryAsync(
        'SELECT id, company_no, company_name, status, archived, contact_person, phone, email, tin, industry FROM company_registry WHERE id = ? LIMIT 1',
        [companyId]
      ),
      queryAsync(`
        SELECT
          (SELECT COUNT(*) FROM projects WHERE company_id = ?) AS project_count,
          (SELECT COUNT(*) FROM projects WHERE company_id = ? AND COALESCE(is_archived, 0) = 0 AND status NOT IN ('completed', 'cancelled')) AS active_project_count,
          (SELECT COUNT(*) FROM projects WHERE company_id = ? AND status = 'completed') AS completed_project_count,
          (SELECT COUNT(*) FROM service_orders WHERE company_id = ?) AS service_order_count,
          (SELECT COUNT(*) FROM purchase_orders WHERE company_id = ?) AS purchase_order_count,
          (SELECT COUNT(*) FROM transactions WHERE company_id = ?) AS transaction_count,
          (SELECT COUNT(*) FROM vendors WHERE company_id = ?) AS vendor_count,
          (SELECT COUNT(*) FROM accounts_receivable ar JOIN transactions t ON t.id = ar.transaction_id WHERE t.company_id = ?) AS receivable_count
      `, [companyId, companyId, companyId, companyId, companyId, companyId, companyId, companyId]),
      queryAsync(`
        SELECT
          id,
          project_docno,
          project_name,
          status,
          planned_start_date,
          planned_end_date,
          actual_start_date,
          actual_end_date,
          created_at
        FROM projects
        WHERE company_id = ?
        ORDER BY COALESCE(actual_start_date, planned_start_date, start_date, created_at) DESC, id DESC
        LIMIT 5
      `, [companyId]),
      queryAsync(`
        SELECT
          so.id,
          so.so_number,
          so.service_title,
          so.status,
          so.service_date,
          so.total_amount,
          p.project_docno,
          p.project_name
        FROM service_orders so
        LEFT JOIN projects p ON p.id = so.project_id
        WHERE so.company_id = ?
        ORDER BY so.created_at DESC, so.id DESC
        LIMIT 5
      `, [companyId])
    ]);

    if (!companyRows.length) {
      return res.status(404).json({ error: 'Company not found' });
    }

    const counts = countRows[0] || {};
    res.json({
      company: companyRows[0],
      counts: {
        project_count: Number(counts.project_count || 0),
        active_project_count: Number(counts.active_project_count || 0),
        completed_project_count: Number(counts.completed_project_count || 0),
        service_order_count: Number(counts.service_order_count || 0),
        purchase_order_count: Number(counts.purchase_order_count || 0),
        transaction_count: Number(counts.transaction_count || 0),
        vendor_count: Number(counts.vendor_count || 0),
        receivable_count: Number(counts.receivable_count || 0)
      },
      recent_projects: Array.isArray(recentProjects) ? recentProjects : [],
      recent_service_orders: Array.isArray(recentServiceOrders) ? recentServiceOrders : []
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Unable to load company overview.' });
  }
});

app.post('/api/company-registry/:id/vendor-profile', protectAdmin, async (req, res) => {
  const companyId = Number(req.params.id || 0);
  if (!companyId) return res.status(400).json({ error: 'Invalid company id.' });

  try {
    const companyRows = await queryAsync(
      `SELECT id, company_no, company_name, contact_person, email, phone, address, tin, archived
       FROM company_registry
       WHERE id = ?
       LIMIT 1`,
      [companyId]
    );

    if (!companyRows.length) {
      return res.status(404).json({ error: 'Company not found.' });
    }

    const company = companyRows[0];
    if (Number(company.archived || 0) === 1) {
      return res.status(400).json({ error: 'Restore the company before creating its vendor profile.' });
    }

    const existingRows = await queryAsync(
      'SELECT id, vendor_no, vendor_name, COALESCE(is_active, TRUE) AS is_active FROM vendors WHERE company_id = ? LIMIT 1',
      [companyId]
    );

    if (existingRows.length) {
      return res.json({
        id: existingRows[0].id,
        vendor_no: existingRows[0].vendor_no,
        vendor_name: existingRows[0].vendor_name,
        company_id: companyId,
        already_exists: true,
        is_active: Number(existingRows[0].is_active || 0) ? 1 : 0
      });
    }

    const vendorName = String(company.company_name || '').trim();
    const vendorContact = String(company.contact_person || '').trim();
    const vendorEmail = String(company.email || '').trim();
    const vendorPhone = normalizePhone(company.phone);
    const vendorAddress = String(company.address || '').trim();
    const vendorTinFormatted = formatTin(normalizeTin(company.tin));

    if (!vendorName) return res.status(400).json({ error: 'Company name is required before creating a vendor profile.' });
    if (!vendorContact) return res.status(400).json({ error: 'Contact person is required before creating a vendor profile.' });
    if (!vendorEmail || !isValidEmail(vendorEmail)) {
      return res.status(400).json({ error: 'Valid company email is required before creating a vendor profile.' });
    }
    if (!vendorPhone || !isValidPhone(vendorPhone)) {
      return res.status(400).json({ error: 'Valid company phone is required before creating a vendor profile.' });
    }
    if (!normalizeTin(vendorTinFormatted) || normalizeTin(vendorTinFormatted).length !== 12) {
      return res.status(400).json({ error: 'Valid company TIN is required before creating a vendor profile.' });
    }
    if (!vendorAddress) return res.status(400).json({ error: 'Company address is required before creating a vendor profile.' });

    const duplicate = await new Promise((resolve, reject) => {
      findVendorDuplicate(vendorPhone, vendorTinFormatted, vendorEmail, 0, (dupErr, row) => {
        if (dupErr) reject(dupErr);
        else resolve(row || null);
      });
    });

    if (duplicate) {
      return res.status(409).json({
        error: duplicate.field === 'tin'
          ? 'TIN already exists in Vendor Directory.'
          : (duplicate.field === 'vendor_email'
            ? 'Email already exists in Vendor Directory.'
            : 'Vendor phone already exists in Vendor Directory.'),
        field: duplicate.field
      });
    }

    const vendorNo = await new Promise((resolve, reject) => {
      generateNextVendorNo((noErr, nextNo) => {
        if (noErr) reject(noErr);
        else resolve(nextNo);
      });
    });

    const result = await queryAsync(
      'INSERT INTO vendors (company_id, vendor_no, vendor_name, contact_person, email, phone, address, tin, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, TRUE)',
      [companyId, vendorNo, vendorName, vendorContact, vendorEmail, vendorPhone, vendorAddress, vendorTinFormatted]
    );

    logAction(req, 'CREATE_VENDOR', `Vendor No: ${vendorNo} | Company ID: ${companyId} | Company No: ${company.company_no || ''} | Company Name: ${vendorName} | Created vendor profile from company registry.`);

    res.json({
      id: result.insertId,
      company_id: companyId,
      vendor_no: vendorNo,
      vendor_name: vendorName,
      already_exists: false,
      is_active: 1
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Unable to create vendor profile.' });
  }
});

app.post('/api/vendors', protectAdmin, (req, res) => {
  const { vendor_name, contact_person, email, phone, address, tin } = req.body;
  const companyId = Number(req.body.company_id || 0) || null;
  const vendorName = String(vendor_name || '').trim();
  const vendorContact = String(contact_person || '').trim();
  const vendorEmail = String(email || '').trim();
  const vendorPhone = normalizePhone(phone);
  const vendorAddress = String(address || '').trim();
  const vendorTinDigits = normalizeTin(tin);
  const vendorTinFormatted = formatTin(vendorTinDigits);
  if (!vendorName) return res.status(400).json({ error: 'Vendor name is required', field: 'vendor_name' });
  if (!vendorContact) return res.status(400).json({ error: 'Contact person is required', field: 'vendor_contact' });
  if (!vendorEmail) return res.status(400).json({ error: 'Email is required', field: 'vendor_email' });
  if (!isValidEmail(vendorEmail)) {
    return res.status(400).json({ error: 'Please enter a valid email address.', field: 'vendor_email' });
  }
  if (!vendorPhone) return res.status(400).json({ error: 'Vendor phone is required', field: 'vendor_phone' });
  if (!isValidPhone(vendorPhone)) {
    return res.status(400).json({ error: 'Vendor phone number must be digits only, 7 to 15 digits.' });
  }
  if (!vendorTinDigits) return res.status(400).json({ error: 'TIN is required', field: 'vendor_tin' });
  if (vendorTinDigits.length !== 12) {
    return res.status(400).json({ error: 'TIN must follow 000-000-000-000 format.', field: 'tin' });
  }
  if (!vendorAddress) return res.status(400).json({ error: 'Address is required', field: 'vendor_address' });

  const createVendor = () => {
  findVendorDuplicate(vendorPhone, vendorTinFormatted, vendorEmail, 0, (dupErr, duplicate) => {
    if (dupErr) return res.status(500).json({ error: dupErr.message });
    if (duplicate) {
      return res.status(409).json({
        error: duplicate.field === 'tin'
          ? 'TIN already exists in Vendor Directory.'
          : (duplicate.field === 'vendor_email'
            ? 'Email already exists in Vendor Directory.'
            : 'Vendor phone already exists in Vendor Directory.'),
        field: duplicate.field
      });
    }

    generateNextVendorNo((noErr, vendorNo) => {
      if (noErr) return res.status(500).json({ error: noErr.message });

      db.query(
        'INSERT INTO vendors (company_id, vendor_no, vendor_name, contact_person, email, phone, address, tin, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, TRUE)',
        [companyId, vendorNo, vendorName, vendorContact, vendorEmail, vendorPhone || null, vendorAddress, vendorTinFormatted || null],
        (err, result) => {
          if (err) return res.status(500).json({ error: err.message });
          res.json({ id: result.insertId, company_id: companyId, vendor_no: vendorNo, is_active: 1 });
        }
      );
    });
  });
  };

  if (!companyId) {
    createVendor();
    return;
  }

  db.query('SELECT id FROM company_registry WHERE id = ? LIMIT 1', [companyId], (companyErr, rows) => {
    if (companyErr) return res.status(500).json({ error: companyErr.message });
    if (!rows || !rows.length) {
      return res.status(400).json({ error: 'Selected company was not found.', field: 'company_id' });
    }
    createVendor();
  });
});

app.patch('/api/vendors/:id/status', protectAdmin, (req, res) => {
  const vendorId = Number(req.params.id || 0);
  if (!vendorId) return res.status(400).json({ error: 'Invalid vendor id.' });

  const nextActive = String(req.body?.is_active ?? req.body?.active ?? '').trim().toLowerCase();
  const isActive = ['1', 'true', 'yes', 'on', 'active'].includes(nextActive);

  db.query(
    'SELECT id, vendor_no, vendor_name, COALESCE(is_active, TRUE) AS is_active FROM vendors WHERE id = ? LIMIT 1',
    [vendorId],
    (findErr, rows) => {
      if (findErr) return res.status(500).json({ error: findErr.message });
      if (!rows || !rows.length) return res.status(404).json({ error: 'Vendor not found.' });

      const vendor = rows[0];
      db.query(
        'UPDATE vendors SET is_active = ? WHERE id = ?',
        [isActive ? 1 : 0, vendorId],
        (updateErr) => {
          if (updateErr) return res.status(500).json({ error: updateErr.message });
          logAction(
            req,
            'TOGGLE_VENDOR_STATUS',
            `Vendor status changed: ${vendor.vendor_no || `ID ${vendor.id}`} | ${vendor.vendor_name || 'Unnamed'} => ${isActive ? 'Active' : 'Inactive'}`
          );
          res.json({
            success: true,
            id: vendorId,
            is_active: isActive ? 1 : 0,
            message: `Vendor ${isActive ? 'activated' : 'deactivated'} successfully.`
          });
        }
      );
    }
  );
});

app.get('/api/bills', protectAdmin, (req, res) => {
  db.query(`
    SELECT ap.*, p.project_docno, p.project_name, v.vendor_name, po.po_number,
           be.company_name AS business_entity_name, be.entity_code AS business_entity_code
    FROM accounts_payable ap
    LEFT JOIN projects p ON p.id = ap.project_id
    LEFT JOIN vendors v ON v.id = ap.vendor_id
    LEFT JOIN purchase_orders po ON po.id = ap.po_id
    LEFT JOIN business_entities be ON be.id = ap.business_entity_id
    ORDER BY COALESCE(ap.bill_date, ap.created_at) DESC, ap.created_at DESC
  `, (err, rows) => {
    if (err) {
      console.error('Load bills error:', err);
      if (['ER_NO_SUCH_TABLE', 'ER_BAD_FIELD_ERROR'].includes(err.code)) {
        return res.json([]);
      }
      return res.status(500).json({ error: err.message || 'Unable to load bills.' });
    }
    res.json(Array.isArray(rows) ? rows : []);
  });
});

async function syncReceivableBalance(receivableId) {
  const id = Number(receivableId || 0);
  if (!id) return;
  const rows = await queryAsync('SELECT id, total_amount, due_date, archived, transaction_id FROM accounts_receivable WHERE id = ? LIMIT 1', [id]);
  if (!rows.length) return;
  const paidRows = await queryAsync(
    "SELECT COALESCE(SUM(amount), 0) AS paid_amount FROM payments WHERE payment_type = 'ar' AND ar_id = ?",
    [id]
  );
  const paidAmount = Number(paidRows[0]?.paid_amount || 0);
  const status = calculateReceivableStatus(rows[0].total_amount, paidAmount, rows[0].due_date, rows[0].archived);
  await queryAsync(
    'UPDATE accounts_receivable SET paid_amount = ?, status = ? WHERE id = ?',
    [paidAmount, status, id]
  );

  const transactionId = Number(rows[0].transaction_id || 0);
  if (transactionId && Number(rows[0].archived || 0) !== 1) {
    const transactionStatus = mapReceivableToTransactionStatus(rows[0].total_amount, paidAmount);
    await queryAsync('UPDATE transactions SET status = ? WHERE id = ?', [transactionStatus, transactionId]);
  }
}

async function syncTransactionFromReceivable(receivableId) {
  const id = Number(receivableId || 0);
  if (!id) return;

  const rows = await queryAsync(
    `SELECT id, transaction_id, total_amount, paid_amount, status, archived
     FROM accounts_receivable
     WHERE id = ? LIMIT 1`,
    [id]
  );
  if (!rows.length) return;

  const row = rows[0];
  const transactionId = Number(row.transaction_id || 0);
  if (!transactionId || Number(row.archived || 0) === 1) return;

  const totalAmount = Number(row.total_amount || 0);
  const paidAmount = Number(row.paid_amount || 0);
  const transactionStatus = mapReceivableToTransactionStatus(totalAmount, paidAmount);

  await queryAsync('UPDATE transactions SET status = ? WHERE id = ?', [transactionStatus, transactionId]);
}

async function syncPayableBalance(payableId) {
  const id = Number(payableId || 0);
  if (!id) return;
  const rows = await queryAsync('SELECT id, total_amount FROM accounts_payable WHERE id = ? LIMIT 1', [id]);
  if (!rows.length) return;
  const paidRows = await queryAsync(
    "SELECT COALESCE(SUM(amount), 0) AS paid_amount FROM payments WHERE payment_type = 'ap' AND ap_id = ?",
    [id]
  );
  const paidAmount = Number(paidRows[0]?.paid_amount || 0);
  const status = calculatePayableStatus(rows[0].total_amount, paidAmount);
  await queryAsync(
    'UPDATE accounts_payable SET paid_amount = ?, status = ? WHERE id = ?',
    [paidAmount, status, id]
  );
}

app.get('/api/receivables', protectAdmin, (req, res) => {
  const includeArchived = String(req.query.include_archived || '0') === '1';
  const whereClause = includeArchived ? '' : 'WHERE COALESCE(archived, 0) = 0';
  db.query(`SELECT * FROM accounts_receivable ${whereClause} ORDER BY invoice_date DESC, created_at DESC`, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

app.post('/api/receivables', protectAdmin, async (req, res) => {
  try {
    const {
      customer_name,
      invoice_number,
      invoice_date,
      due_date,
      payment_terms,
      total_amount,
      status,
      transaction_id,
      notes,
      project_id,
      project_docno,
      service_order_no
    } = req.body;

    const resolvedTransactionId = Number(transaction_id || 0);
    if (!resolvedTransactionId) {
      return res.status(400).json({ error: 'Linked transaction is required.' });
    }

    const transactionRows = await queryAsync(
      `SELECT t.id, t.client, t.docno, t.date, t.amount, t.downpayment, t.business_entity_id,
              t.company_id, c.company_no, c.company_name,
              t.project_id, t.service_order_id,
              p.project_docno,
              so.so_number AS service_order_no
       FROM transactions t
       LEFT JOIN company_registry c ON c.id = t.company_id
       LEFT JOIN projects p ON p.id = t.project_id
       LEFT JOIN service_orders so ON so.id = t.service_order_id
       WHERE t.id = ? LIMIT 1`,
      [resolvedTransactionId]
    );

    if (!transactionRows.length) {
      return res.status(404).json({ error: 'Linked transaction not found.' });
    }

    const transaction = transactionRows[0];
    const resolvedCustomerName = String(transaction.company_name || transaction.client || customer_name || '').trim();
    const resolvedInvoiceNumber = String(transaction.docno || invoice_number || '').trim();
    const resolvedInvoiceDate = String(invoice_date || transaction.date || '').trim();
    const resolvedPaymentTerms = String(payment_terms || '').trim() || null;
    const resolvedTotalAmount = Number(transaction.amount || total_amount || 0);
    const resolvedStatus = normalizeReceivableStatusValue(status);
    const resolvedPaidAmount = resolvedStatus === 'paid'
      ? resolvedTotalAmount
      : (resolvedStatus === 'partial'
        ? Math.min(resolvedTotalAmount, Math.max(0, Number(transaction.downpayment || 0)))
        : 0);
    const resolvedProjectId = Number(transaction.project_id || project_id || 0) || null;
    const resolvedBusinessEntityId = await resolveBusinessEntityId(transaction.business_entity_id || req.body.business_entity_id || null);
    const resolvedProjectDocno = String(project_docno || transaction.project_docno || '').trim() || null;
    const resolvedServiceOrderNo = String(service_order_no || transaction.service_order_no || '').trim() || null;

    if (!resolvedCustomerName || !resolvedInvoiceNumber || !resolvedInvoiceDate || resolvedTotalAmount <= 0) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const result = await queryAsync(
      `INSERT INTO accounts_receivable
        (customer_name, invoice_number, invoice_date, due_date, payment_terms, total_amount, paid_amount, status, business_entity_id, transaction_id, notes, project_id, project_docno, service_order_no, archived, archived_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL)`,
      [
        resolvedCustomerName,
        resolvedInvoiceNumber,
        resolvedInvoiceDate,
        due_date || null,
        resolvedPaymentTerms,
        resolvedTotalAmount,
        resolvedPaidAmount,
        resolvedStatus,
        resolvedBusinessEntityId,
        resolvedTransactionId,
        notes || null,
        resolvedProjectId,
        resolvedProjectDocno,
        resolvedServiceOrderNo
      ]
    );

    let syncWarning = null;
    try {
      await syncTransactionFromReceivable(result.insertId);
    } catch (syncErr) {
      syncWarning = syncErr;
      console.error('Receivable-to-transaction sync warning:', syncErr);
    }

    const responsePayload = { id: result.insertId, transaction_id: resolvedTransactionId };
    if (syncWarning) {
      responsePayload.warning = 'Receivable saved, but transaction sync needs a retry.';
    }
    res.json(responsePayload);
  } catch (err) {
    if (err && err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'Invoice number already exists' });
    }
    console.error('Create receivable error:', err);
    res.status(500).json({ error: err.message || 'Unable to save receivable.' });
  }
});

app.put('/api/receivables/:id', protectAdmin, async (req, res) => {
  const receivableId = Number(req.params.id || 0);
  if (!receivableId) return res.status(400).json({ error: 'Invalid receivable id' });

  try {
    const existingRows = await queryAsync(
      'SELECT id, customer_name, invoice_number, invoice_date, due_date, payment_terms, total_amount, paid_amount, status, business_entity_id, transaction_id, notes, project_id, project_docno, service_order_no, archived FROM accounts_receivable WHERE id = ? LIMIT 1',
      [receivableId]
    );

    if (!existingRows.length) {
      return res.status(404).json({ error: 'Receivable not found.' });
    }

    const existing = existingRows[0];
    const {
      customer_name,
      invoice_number,
      invoice_date,
      due_date,
      payment_terms,
      total_amount,
      status,
      transaction_id,
      notes,
      project_id,
      project_docno,
      service_order_no
    } = req.body;

    const resolvedTransactionId = Number(transaction_id || existing.transaction_id || 0);
    if (!resolvedTransactionId) {
      return res.status(400).json({ error: 'Linked transaction is required.' });
    }

    const transactionRows = await queryAsync(
      `SELECT t.id, t.client, t.docno, t.date, t.amount, t.downpayment, t.business_entity_id,
              t.company_id, c.company_no, c.company_name,
              t.project_id, t.service_order_id,
              p.project_docno,
              so.so_number AS service_order_no
       FROM transactions t
       LEFT JOIN company_registry c ON c.id = t.company_id
       LEFT JOIN projects p ON p.id = t.project_id
       LEFT JOIN service_orders so ON so.id = t.service_order_id
       WHERE t.id = ? LIMIT 1`,
      [resolvedTransactionId]
    );

    if (!transactionRows.length) {
      return res.status(404).json({ error: 'Linked transaction not found.' });
    }

    const transaction = transactionRows[0];
    const resolvedCustomerName = String(transaction.company_name || transaction.client || customer_name || existing.customer_name || '').trim();
    const resolvedInvoiceNumber = String(transaction.docno || invoice_number || existing.invoice_number || '').trim();
    const resolvedInvoiceDate = String(invoice_date || transaction.date || existing.invoice_date || '').trim();
    const resolvedPaymentTerms = String(payment_terms || existing.payment_terms || '').trim() || null;
    const resolvedTotalAmount = Number(transaction.amount || total_amount || existing.total_amount || 0);
    const resolvedPaidAmount = Number(existing.paid_amount || 0);
    const resolvedStatus = calculateReceivableStatus(
      resolvedTotalAmount,
      resolvedPaidAmount,
      due_date || existing.due_date || null,
      existing.archived
    );
    const resolvedProjectId = Number(transaction.project_id || project_id || existing.project_id || 0) || null;
    const resolvedBusinessEntityId = await resolveBusinessEntityId(transaction.business_entity_id || req.body.business_entity_id || existing.business_entity_id || null);
    const resolvedProjectDocno = String(project_docno || transaction.project_docno || existing.project_docno || '').trim() || null;
    const resolvedServiceOrderNo = String(service_order_no || transaction.service_order_no || existing.service_order_no || '').trim() || null;

    if (!resolvedCustomerName || !resolvedInvoiceNumber || !resolvedInvoiceDate || resolvedTotalAmount <= 0) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    await queryAsync(
      `UPDATE accounts_receivable
          SET customer_name = ?, invoice_number = ?, invoice_date = ?, due_date = ?, payment_terms = ?, total_amount = ?,
              paid_amount = ?, status = ?, business_entity_id = ?, transaction_id = ?, notes = ?, project_id = ?, project_docno = ?,
              service_order_no = ?
        WHERE id = ?`,
      [
        resolvedCustomerName,
        resolvedInvoiceNumber,
        resolvedInvoiceDate,
        due_date || null,
        resolvedPaymentTerms,
        resolvedTotalAmount,
        resolvedPaidAmount,
        resolvedStatus,
        resolvedBusinessEntityId,
        resolvedTransactionId,
        notes || null,
        resolvedProjectId,
        resolvedProjectDocno,
        resolvedServiceOrderNo,
        receivableId
      ]
    );

    let syncWarning = null;
    try {
      await syncTransactionFromReceivable(receivableId);
    } catch (syncErr) {
      syncWarning = syncErr;
      console.error('Receivable update sync warning:', syncErr);
    }

    const responsePayload = { id: receivableId, transaction_id: resolvedTransactionId };
    if (syncWarning) {
      responsePayload.warning = 'Receivable updated, but transaction sync needs a retry.';
    }
    res.json(responsePayload);
  } catch (err) {
    if (err && err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'Invoice number already exists' });
    }
    console.error('Update receivable error:', err);
    res.status(500).json({ error: err.message || 'Unable to update receivable.' });
  }
});

app.put('/api/receivables/:id/archive', protectAdmin, async (req, res) => {
  const receivableId = Number(req.params.id || 0);
  if (!receivableId) return res.status(400).json({ error: 'Invalid receivable id' });
  try {
    const result = await queryAsync(
      'UPDATE accounts_receivable SET archived = 1, archived_at = CURRENT_TIMESTAMP, status = "cancelled" WHERE id = ?',
      [receivableId]
    );
    await syncReceivableBalance(receivableId);
    res.json({ success: true, affectedRows: result.affectedRows || 0 });
  } catch (err) {
    console.error('Archive receivable error:', err);
    res.status(500).json({ error: err.message || 'Unable to archive receivable.' });
  }
});

app.put('/api/receivables/:id/restore', protectAdmin, async (req, res) => {
  const receivableId = Number(req.params.id || 0);
  if (!receivableId) return res.status(400).json({ error: 'Invalid receivable id' });
  try {
    const result = await queryAsync(
      'UPDATE accounts_receivable SET archived = 0, archived_at = NULL WHERE id = ?',
      [receivableId]
    );
    await syncReceivableBalance(receivableId);
    res.json({ success: true, affectedRows: result.affectedRows || 0 });
  } catch (err) {
    console.error('Restore receivable error:', err);
    res.status(500).json({ error: err.message || 'Unable to restore receivable.' });
  }
});

app.post('/api/bills', protectAdmin, upload.single('pdf_file'), async (req, res) => {
  const { bill_date, due_date, notes } = req.body;
  let billNumber = String(req.body.bill_number || '').trim();
  const poId = Number(req.body.po_id || 0) || null;
  let vendorId = Number(req.body.vendor_id || 0) || null;
  let businessEntityId = Number(req.body.business_entity_id || 0) || null;
  let projectId = Number(req.body.project_id || 0) || null;
  let totalAmount = Number(req.body.total_amount || 0) || 0;
  const pdfFilename = req.file ? req.file.filename : null;

  try {
    if (poId) {
      const poRows = await queryAsync('SELECT id, business_entity_id, vendor_id, project_id, total_amount FROM purchase_orders WHERE id = ? LIMIT 1', [poId]);
      if (!poRows.length) return res.status(400).json({ error: 'Selected purchase order was not found.' });
      businessEntityId = businessEntityId || Number(poRows[0].business_entity_id || 0) || null;
      vendorId = vendorId || Number(poRows[0].vendor_id || 0) || null;
      projectId = projectId || Number(poRows[0].project_id || 0) || null;
      totalAmount = totalAmount || Number(poRows[0].total_amount || 0) || 0;
    }

    if (!vendorId || !bill_date || !totalAmount) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    businessEntityId = await resolveBusinessEntityId(businessEntityId);
    if (!billNumber) {
      billNumber = await generateNextEntityDocumentNo({
        businessEntityId,
        documentType: 'ap-bill',
        prefix: 'BILL',
        tableName: 'accounts_payable',
        columnName: 'bill_number'
      });
    }

    if (projectId) {
      const projectRows = await queryAsync('SELECT id FROM projects WHERE id = ? LIMIT 1', [projectId]);
      if (!projectRows.length) return res.status(400).json({ error: 'Selected project was not found.' });
    }

    const result = await queryAsync(
      'INSERT INTO accounts_payable (business_entity_id, vendor_id, bill_number, bill_date, due_date, project_id, po_id, total_amount, notes, pdfFilename) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [businessEntityId, vendorId, billNumber, bill_date, due_date || null, projectId, poId, totalAmount, notes || null, pdfFilename]
    );
    res.json({ id: result.insertId, project_id: projectId, po_id: poId });
  } catch (err) {
    if (err && err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'Bill number already exists' });
    }
    console.error('Create bill error:', err);
    res.status(500).json({ error: err.message || 'Unable to save bill.' });
  }
});

app.put('/api/bills/:id', protectAdmin, upload.single('pdf_file'), async (req, res) => {
  const billId = Number(req.params.id || 0);
  const { bill_number, bill_date, due_date, notes } = req.body;
  const poId = Number(req.body.po_id || 0) || null;
  let vendorId = Number(req.body.vendor_id || 0) || null;
  let businessEntityId = Number(req.body.business_entity_id || 0) || null;
  let projectId = Number(req.body.project_id || 0) || null;
  let totalAmount = Number(req.body.total_amount || 0) || 0;
  const removePdf = String(req.body.remove_pdf || '') === '1';
  const uploadedPdf = req.file ? req.file.filename : null;

  const cleanupUploadedPdf = () => {
    if (!uploadedPdf) return;
    const filePath = path.join(UPLOAD_DIR, path.basename(uploadedPdf));
    fs.unlink(filePath, () => {});
  };

  try {
    if (!billId) {
      cleanupUploadedPdf();
      return res.status(400).json({ error: 'Invalid bill id' });
    }
    if (poId) {
      const poRows = await queryAsync('SELECT id, business_entity_id, vendor_id, project_id, total_amount FROM purchase_orders WHERE id = ? LIMIT 1', [poId]);
      if (!poRows.length) {
        cleanupUploadedPdf();
        return res.status(400).json({ error: 'Selected purchase order was not found.' });
      }
      businessEntityId = businessEntityId || Number(poRows[0].business_entity_id || 0) || null;
      vendorId = vendorId || Number(poRows[0].vendor_id || 0) || null;
      projectId = projectId || Number(poRows[0].project_id || 0) || null;
      totalAmount = totalAmount || Number(poRows[0].total_amount || 0) || 0;
    }

    if (!vendorId || !bill_number || !bill_date || !totalAmount) {
      cleanupUploadedPdf();
      return res.status(400).json({ error: 'Missing required fields' });
    }
    businessEntityId = await resolveBusinessEntityId(businessEntityId);

    const existingRows = await queryAsync(
      'SELECT id, pdfFilename FROM accounts_payable WHERE id = ? LIMIT 1',
      [billId]
    );
    if (!existingRows.length) {
      cleanupUploadedPdf();
      return res.status(404).json({ error: 'Bill not found.' });
    }

    if (projectId) {
      const projectRows = await queryAsync('SELECT id FROM projects WHERE id = ? LIMIT 1', [projectId]);
      if (!projectRows.length) {
        cleanupUploadedPdf();
        return res.status(400).json({ error: 'Selected project was not found.' });
      }
    }

    const currentPdf = String(existingRows[0].pdfFilename || '').trim() || null;
    const nextPdf = uploadedPdf || (removePdf ? null : currentPdf);
    await queryAsync(
      `UPDATE accounts_payable
       SET business_entity_id = ?, vendor_id = ?, bill_number = ?, bill_date = ?, due_date = ?, project_id = ?, po_id = ?,
           total_amount = ?, notes = ?, pdfFilename = ?
       WHERE id = ?`,
      [businessEntityId, vendorId, bill_number, bill_date, due_date || null, projectId, poId, totalAmount, notes || null, nextPdf, billId]
    );
    await syncPayableBalance(billId);

    if (currentPdf && currentPdf !== nextPdf && (uploadedPdf || removePdf)) {
      const oldPath = path.join(UPLOAD_DIR, path.basename(currentPdf));
      fs.unlink(oldPath, () => {});
    }

    res.json({ id: billId, project_id: projectId, po_id: poId });
  } catch (err) {
    cleanupUploadedPdf();
    if (err && err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'Bill number already exists' });
    }
    console.error('Update bill error:', err);
    res.status(500).json({ error: err.message || 'Unable to update bill.' });
  }
});

app.get('/api/bills/:id/pdf', protectAdmin, (req, res) => {
  sendBillPdf(req, res, req.params.id);
});

function normalizeStockMovementSourceType(value) {
  const normalized = String(value || 'manual').trim().toLowerCase();
  const allowed = ['manual', 'purchase_requisition', 'purchase_order', 'goods_receipt', 'transaction'];
  return allowed.includes(normalized) ? normalized : 'manual';
}

// ==================== ERP FOUNDATION API ====================

app.get('/api/erp/summary', protectAdmin, async (req, res) => {
  try {
    const [
      accounts,
      journals,
      requisitions,
      purchaseOrders,
      bills,
      companies,
      departments,
      employees,
      payrollRuns
    ] = await Promise.all([
      queryAsync('SELECT COUNT(*) AS total FROM chart_of_accounts'),
      queryAsync('SELECT COUNT(*) AS total FROM journal_entries'),
      queryAsync('SELECT COUNT(*) AS total FROM purchase_requisitions'),
      queryAsync('SELECT COUNT(*) AS total FROM purchase_orders'),
      queryAsync('SELECT COUNT(*) AS total FROM accounts_payable'),
      queryAsync('SELECT COUNT(*) AS total FROM company_registry'),
      queryAsync('SELECT COUNT(*) AS total FROM departments'),
      queryAsync('SELECT COUNT(*) AS total FROM employees'),
      queryAsync('SELECT COUNT(*) AS total FROM payroll_runs')
    ]);

    const balanceRows = await queryAsync(`
      SELECT
        COALESCE(SUM(debit), 0) AS total_debit,
        COALESCE(SUM(credit), 0) AS total_credit
      FROM journal_lines
    `);

    const payrollTotalRows = await queryAsync(`
      SELECT
        COALESCE(SUM(gross_pay), 0) AS gross_pay,
        COALESCE(SUM(deductions), 0) AS deductions,
        COALESCE(SUM(net_pay), 0) AS net_pay
      FROM payroll_runs
    `);

    res.json({
      accounting: {
        accounts: Number(accounts[0]?.total || 0),
        journal_entries: Number(journals[0]?.total || 0),
        total_debit: Number(balanceRows[0]?.total_debit || 0),
        total_credit: Number(balanceRows[0]?.total_credit || 0)
      },
      accounts_payable: {
        requisitions: Number(requisitions[0]?.total || 0),
        purchase_orders: Number(purchaseOrders[0]?.total || 0),
        bills: Number(bills[0]?.total || 0)
      },
      companies: Number(companies[0]?.total || 0),
      hr: {
        departments: Number(departments[0]?.total || 0),
        employees: Number(employees[0]?.total || 0),
        payroll_runs: Number(payrollRuns[0]?.total || 0),
        gross_pay: Number(payrollTotalRows[0]?.gross_pay || 0),
        deductions: Number(payrollTotalRows[0]?.deductions || 0),
        net_pay: Number(payrollTotalRows[0]?.net_pay || 0)
      }
    });
  } catch (err) {
    console.error('ERP summary error:', err);
    res.status(500).json({ error: err.message || 'Unable to load ERP summary.' });
  }
});

app.get('/api/accounting/accounts', protectAdmin, async (req, res) => {
  try {
    const rows = await queryAsync(`
      SELECT a.*, p.account_code AS parent_account_code, p.account_name AS parent_account_name
      FROM chart_of_accounts a
      LEFT JOIN chart_of_accounts p ON p.id = a.parent_account_id
      ORDER BY a.account_code ASC, a.account_name ASC
    `);
    res.json(rows);
  } catch (err) {
    console.error('Accounting accounts error:', err);
    res.status(500).json({ error: err.message || 'Unable to load accounts.' });
  }
});

app.post('/api/accounting/accounts', protectAdmin, async (req, res) => {
  try {
    const accountCode = String(req.body.account_code || '').trim() || generateCode('ACCT');
    const accountName = String(req.body.account_name || '').trim();
    const accountType = String(req.body.account_type || '').trim().toLowerCase();
    const parentAccountId = req.body.parent_account_id ? Number(req.body.parent_account_id) : null;

    if (!accountName || !['asset', 'liability', 'equity', 'revenue', 'expense'].includes(accountType)) {
      return res.status(400).json({ error: 'Account name and a valid account type are required.' });
    }

    const duplicateRows = await queryAsync(
      'SELECT id FROM chart_of_accounts WHERE account_code = ? LIMIT 1',
      [accountCode]
    );
    if (duplicateRows.length) {
      return res.status(409).json({ error: 'Account code already exists.', field: 'account_code' });
    }

    const result = await queryAsync(
      'INSERT INTO chart_of_accounts (account_code, account_name, account_type, parent_account_id) VALUES (?, ?, ?, ?)',
      [accountCode, accountName, accountType, parentAccountId]
    );
    res.json({ id: result.insertId, account_code: accountCode });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'Account code already exists.' });
    }
    console.error('Create account error:', err);
    res.status(500).json({ error: err.message || 'Unable to create account.' });
  }
});

app.get('/api/accounting/periods', protectAdmin, async (req, res) => {
  try {
    const rows = await queryAsync('SELECT * FROM accounting_periods ORDER BY start_date DESC, id DESC');
    res.json(rows);
  } catch (err) {
    console.error('Accounting periods error:', err);
    res.status(500).json({ error: err.message || 'Unable to load accounting periods.' });
  }
});

app.post('/api/accounting/periods', protectAdmin, async (req, res) => {
  try {
    const periodName = String(req.body.period_name || '').trim() || generateCode('PERIOD');
    const startDate = req.body.start_date;
    const endDate = req.body.end_date;
    const isClosed = Number(req.body.is_closed || 0) ? 1 : 0;

    if (!startDate || !endDate) {
      return res.status(400).json({ error: 'Start and end dates are required.' });
    }

    const duplicateRows = await queryAsync(
      'SELECT id FROM accounting_periods WHERE period_name = ? LIMIT 1',
      [periodName]
    );
    if (duplicateRows.length) {
      return res.status(409).json({ error: 'Period name already exists.', field: 'period_name' });
    }

    const result = await queryAsync(
      'INSERT INTO accounting_periods (period_name, start_date, end_date, is_closed) VALUES (?, ?, ?, ?)',
      [periodName, startDate, endDate, isClosed]
    );
    res.json({ id: result.insertId, period_name: periodName });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'Period name already exists.' });
    }
    console.error('Create accounting period error:', err);
    res.status(500).json({ error: err.message || 'Unable to create accounting period.' });
  }
});

app.get('/api/accounting/journal-entries', protectAdmin, async (req, res) => {
  try {
    const rows = await queryAsync(`
      SELECT
        e.*,
        COALESCE(SUM(l.debit), 0) AS total_debit,
        COALESCE(SUM(l.credit), 0) AS total_credit,
        COUNT(l.id) AS line_count
      FROM journal_entries e
      LEFT JOIN journal_lines l ON l.journal_entry_id = e.id
      GROUP BY e.id
      ORDER BY e.entry_date DESC, e.id DESC
    `);
    res.json(rows);
  } catch (err) {
    console.error('Journal entries error:', err);
    res.status(500).json({ error: err.message || 'Unable to load journal entries.' });
  }
});

app.post('/api/accounting/journal-entries', protectAdmin, async (req, res) => {
  const entryDate = req.body.entry_date;
  const memo = String(req.body.memo || '').trim();
  const referenceType = String(req.body.reference_type || '').trim() || null;
  const referenceId = String(req.body.reference_id || '').trim() || null;
  const debitAccountId = Number(req.body.debit_account_id || 0);
  const creditAccountId = Number(req.body.credit_account_id || 0);
  const amount = toNumber(req.body.amount, 0);

  if (!entryDate || !debitAccountId || !creditAccountId || amount <= 0) {
    return res.status(400).json({ error: 'Entry date, debit account, credit account, and amount are required.' });
  }

  if (debitAccountId === creditAccountId) {
    return res.status(400).json({ error: 'Debit and credit accounts must be different.' });
  }

  const entryNumber = String(req.body.entry_number || '').trim() || generateCode('JE');

  try {
    const entryResult = await queryAsync(
      'INSERT INTO journal_entries (entry_number, entry_date, reference_type, reference_id, memo, status, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [entryNumber, entryDate, referenceType, referenceId, memo || null, 'posted', req.session.user?.id || null]
    );

    await queryAsync(
      'INSERT INTO journal_lines (journal_entry_id, account_id, line_memo, debit, credit) VALUES (?, ?, ?, ?, ?)',
      [entryResult.insertId, debitAccountId, memo || null, amount, 0]
    );
    await queryAsync(
      'INSERT INTO journal_lines (journal_entry_id, account_id, line_memo, debit, credit) VALUES (?, ?, ?, ?, ?)',
      [entryResult.insertId, creditAccountId, memo || null, 0, amount]
    );

    logAction(req, 'CREATE_JOURNAL_ENTRY', `Created journal entry ${entryNumber}`);
    res.json({ id: entryResult.insertId, entry_number: entryNumber });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'Journal entry number already exists.' });
    }
    console.error('Create journal entry error:', err);
    res.status(500).json({ error: err.message || 'Unable to create journal entry.' });
  }
});

app.get('/api/procurement/requisitions', protectAdmin, async (req, res) => {
  try {
    const [requisitions, items] = await Promise.all([
      queryAsync(`
        SELECT
          r.*,
          r.company_id AS company_id,
          be.company_name AS business_entity_name,
          be.entity_code AS business_entity_code,
          c.company_name,
          c.company_no
        FROM purchase_requisitions r
        LEFT JOIN business_entities be ON be.id = r.business_entity_id
        LEFT JOIN company_registry c ON c.id = r.company_id
        ORDER BY r.request_date DESC, r.id DESC
      `),
      queryAsync(`
        SELECT *
        FROM purchase_requisition_items
        ORDER BY pr_id ASC, id ASC
      `)
    ]);

    const itemsByPr = new Map();
    (Array.isArray(items) ? items : []).forEach((item) => {
      const prId = Number(item.pr_id || 0);
      if (!prId) return;
      const bucket = itemsByPr.get(prId) || [];
      bucket.push({
        ...item,
        quantity: Number(item.quantity || 0),
        estimated_unit_price: Number(item.estimated_unit_price || 0),
        unit_price: Number(item.estimated_unit_price || 0),
        line_total: Number(item.line_total || 0)
      });
      itemsByPr.set(prId, bucket);
    });

    const rows = (Array.isArray(requisitions) ? requisitions : []).map((row) => {
      const lineItems = itemsByPr.get(Number(row.id || 0)) || [];
      const totalAmount = lineItems.reduce((sum, item) => sum + Number(item.line_total || 0), 0);
      const firstItem = lineItems[0] || {};
      return {
        ...row,
        line_items: lineItems,
        item_count: lineItems.length,
        total_amount: totalAmount,
        item_summary: lineItems.map((item) => String(item.item_name || '').trim()).filter(Boolean).join(' | '),
        item_name: firstItem.item_name || null,
        item_description: firstItem.description || null,
        quantity: firstItem.quantity || null,
        unit: firstItem.unit || null,
        unit_price: firstItem.estimated_unit_price || null,
        line_total: firstItem.line_total || null
      };
    });
    res.json(rows);
  } catch (err) {
    console.error('Requisitions error:', err);
    res.status(500).json({ error: err.message || 'Unable to load requisitions.' });
  }
});

function normalizePurchaseRequisitionLineItems(body = {}) {
  const rawItems = Array.isArray(body.items) ? body.items : [];
  const normalized = rawItems
    .map((item) => ({
      item_name: String(item?.item_name || item?.name || '').trim(),
      description: String(item?.description || item?.item_description || '').trim() || null,
      quantity: toNumber(item?.quantity ?? item?.qty, 0),
      unit: String(item?.unit || '').trim() || null,
      estimated_unit_price: toNumber(item?.estimated_unit_price ?? item?.unit_price ?? item?.price, 0)
    }))
    .filter((item) => item.item_name || item.description || item.quantity > 0 || item.estimated_unit_price > 0);

  if (normalized.length) {
    return normalized.filter((item) => item.item_name && item.quantity > 0);
  }

  const fallbackName = String(body.item_name || '').trim();
  const fallbackDescription = String(body.item_description || '').trim() || null;
  const fallbackQty = toNumber(body.quantity, 0);
  const fallbackUnit = String(body.unit || '').trim() || null;
  const fallbackPrice = toNumber(body.estimated_unit_price, 0);

  if (fallbackName && fallbackQty > 0) {
    return [{
      item_name: fallbackName,
      description: fallbackDescription,
      quantity: fallbackQty,
      unit: fallbackUnit,
      estimated_unit_price: fallbackPrice
    }];
  }

  return [];
}

app.post('/api/procurement/requisitions', protectAdmin, async (req, res) => {
  let prNumber = String(req.body.pr_number || '').trim();
  const companyId = Number(req.body.company_id || 0) || 0;
  const requestDate = req.body.request_date || new Date().toISOString().slice(0, 10);
  const department = String(req.body.department || '').trim() || null;
  const requestedBy = String(req.body.requested_by || '').trim() || null;
  const neededBy = req.body.needed_by || null;
  const status = String(req.body.status || 'draft').trim().toLowerCase();
  const notes = String(req.body.notes || '').trim() || null;
  const lineItems = normalizePurchaseRequisitionLineItems(req.body);

  if (!lineItems.length) {
    return res.status(400).json({ error: 'At least one item name and quantity are required.' });
  }

  try {
    const businessEntityId = await resolveBusinessEntityId(req.body.business_entity_id);
    if (!prNumber) {
      prNumber = await generateNextEntityDocumentNo({
        businessEntityId,
        documentType: 'purchase-requisition',
        prefix: 'PR',
        tableName: 'purchase_requisitions',
        columnName: 'pr_number'
      });
    }
    const { companyRecord } = await resolvePurchaseRequisitionContext(companyId);
    const reqResult = await queryAsync(
      'INSERT INTO purchase_requisitions (pr_number, business_entity_id, company_id, request_date, department, requested_by, needed_by, status, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [
        prNumber,
        businessEntityId,
        companyRecord.id,
        requestDate,
        department,
        requestedBy,
        neededBy,
        status,
        notes
      ]
    );

    for (const item of lineItems) {
      const lineTotal = Number(item.quantity || 0) * Number(item.estimated_unit_price || 0);
      await queryAsync(
        'INSERT INTO purchase_requisition_items (pr_id, item_name, description, quantity, unit, estimated_unit_price, line_total) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [reqResult.insertId, item.item_name, item.description, item.quantity, item.unit, item.estimated_unit_price, lineTotal]
      );
    }

    logAction(req, 'CREATE_PURCHASE_REQUISITION', `Created requisition ${prNumber}`);
    res.json({ id: reqResult.insertId, pr_number: prNumber });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'PR number already exists.' });
    }
    console.error('Create requisition error:', err);
    res.status(500).json({ error: err.message || 'Unable to create requisition.' });
  }
});

function normalizePurchaseOrderLineItems(body = {}) {
  const rawItems = Array.isArray(body.items) ? body.items : [];
  const normalized = rawItems
    .map((item) => ({
      description: String(item?.description || item?.item_description || item?.item_name || '').trim(),
      quantity: toNumber(item?.quantity ?? item?.qty, 0),
      unit_price: toNumber(item?.unit_price ?? item?.price, 0),
      product_id: Number(item?.product_id || 0) || null
    }))
    .filter((item) => item.description || item.quantity > 0 || item.unit_price > 0);

  if (normalized.length) {
    return normalized.filter((item) => item.description && item.quantity > 0 && item.unit_price > 0);
  }

  const fallbackDescription = String(body.item_description || body.item_name || '').trim();
  const fallbackQty = toNumber(body.quantity, 0);
  const fallbackPrice = toNumber(body.unit_price, 0);

  if (fallbackDescription && fallbackQty > 0 && fallbackPrice > 0) {
    return [{
      description: fallbackDescription,
      quantity: fallbackQty,
      unit_price: fallbackPrice,
      product_id: Number(body.product_id || 0) || null
    }];
  }

  return [];
}

function buildPurchaseOrderItemSummary(items = []) {
  return (Array.isArray(items) ? items : [])
    .map((item) => String(item.description || item.product_name || item.product_description || '').trim())
    .filter(Boolean)
    .join(' | ');
}

async function resolvePurchaseOrderCompanyContext(explicitCompanyId = 0, options = {}) {
  let resolvedCompanyId = Number(explicitCompanyId || 0) || 0;

  if (!resolvedCompanyId) {
    if (options.required) {
      throw new Error('Company is required.');
    }
    return { companyRecord: null };
  }

  const companyRows = await queryAsync(
    'SELECT id, company_no, company_name FROM company_registry WHERE id = ? LIMIT 1',
    [resolvedCompanyId]
  );
  if (!companyRows.length) {
    throw new Error('Selected company was not found.');
  }

  return {
    companyRecord: companyRows[0]
  };
}

async function resolvePurchaseRequisitionContext(companyId = 0) {
  const normalizedCompanyId = Number(companyId || 0) || 0;
  const resolvedCompanyId = normalizedCompanyId;

  if (!resolvedCompanyId) {
    throw new Error('Company is required.');
  }

  const companyRows = await queryAsync(
    'SELECT id, company_no, company_name FROM company_registry WHERE id = ? LIMIT 1',
    [resolvedCompanyId]
  );
  if (!companyRows.length) {
    throw new Error('Selected company was not found.');
  }

  return {
    companyRecord: companyRows[0]
  };
}

function normalizeProcurementWorkflowStatus(status) {
  return String(status || '').trim().toLowerCase();
}

function getApprovalActorName(req) {
  const actor = getAuthenticatedUser(req) || {};
  return String(actor.fullname || actor.username || 'Admin').trim() || 'Admin';
}

function assertStatusTransition(currentStatus, nextStatus, allowedMap, label) {
  const current = normalizeProcurementWorkflowStatus(currentStatus || 'draft');
  const next = normalizeProcurementWorkflowStatus(nextStatus);
  const allowed = allowedMap[current] || [];
  if (!allowed.includes(next)) {
    throw new Error(`${label} cannot move from ${current || 'blank'} to ${next}.`);
  }
}

function assertRequisitionCanConvertToPurchaseOrder(requisitionRow, { allowOrdered = false } = {}) {
  if (!requisitionRow) return;
  const status = normalizeProcurementWorkflowStatus(requisitionRow.status);
  const allowedStatuses = allowOrdered ? ['approved', 'ordered'] : ['approved'];
  if (!allowedStatuses.includes(status)) {
    throw new Error('Purchase requisition must be approved before it can be converted to a purchase order.');
  }
}

async function markRequisitionOrdered(requisitionId) {
  const id = Number(requisitionId || 0) || 0;
  if (!id) return;
  await queryAsync(
    "UPDATE purchase_requisitions SET status = 'ordered' WHERE id = ? AND status <> 'ordered'",
    [id]
  );
}

async function markPurchaseOrderReceived(poId) {
  const id = Number(poId || 0) || 0;
  if (!id) return;
  await queryAsync(
    "UPDATE purchase_orders SET status = 'received' WHERE id = ? AND status <> 'received'",
    [id]
  );
}

function parsePurchaseOrderPaymentTerms(paymentTerms, totalAmount) {
  const terms = String(paymentTerms || '').trim();
  const total = Number(totalAmount || 0);
  if (!terms || total <= 0) return [];

  const parts = terms
    .split(/[,;]+/)
    .map(part => part.trim())
    .filter(Boolean);
  const sourceParts = parts.length ? parts : [terms];
  const schedule = [];

  sourceParts.forEach((part, index) => {
    const match = part.match(/(\d+(?:\.\d+)?)\s*%/);
    if (!match) return;
    const percent = Number(match[1] || 0);
    if (!Number.isFinite(percent) || percent <= 0) return;
    const label = part.replace(match[0], '').replace(/^[\s:-]+/, '').trim()
      || `Payment ${index + 1}`;
    const amount = Number(((total * percent) / 100).toFixed(2));
    schedule.push({
      percent,
      label,
      amount
    });
  });

  return schedule;
}

function resolveTermDueDate(term, poDate, deliveryDate) {
  const label = String(term?.label || '').toLowerCase();
  if (label.includes('delivery') || label.includes('deliver')) {
    return deliveryDate || poDate || getManilaYmd();
  }
  return poDate || getManilaYmd();
}

async function resolvePurchaseOrderRequisitionContext(requisitionId = 0, explicitCompanyId = 0, options = {}) {
  const normalizedRequisitionId = Number(requisitionId || 0) || 0;
  let normalizedCompanyId = Number(explicitCompanyId || 0) || 0;
  let requisitionRow = null;

  if (normalizedRequisitionId) {
    const requisitionRows = await queryAsync(
      `SELECT r.id, r.pr_number, r.business_entity_id, r.company_id, r.status
       FROM purchase_requisitions r
       WHERE r.id = ? LIMIT 1`,
      [normalizedRequisitionId]
    );
    if (!requisitionRows.length) {
      throw new Error('Selected requisition was not found.');
    }

    requisitionRow = requisitionRows[0];
    if (options.requireApproved) {
      assertRequisitionCanConvertToPurchaseOrder(requisitionRow, { allowOrdered: Boolean(options.allowOrdered) });
    }

    const requisitionCompanyId = Number(requisitionRow.company_id || 0) || 0;
    normalizedCompanyId = normalizedCompanyId || requisitionCompanyId;
  }

  const { companyRecord } = await resolvePurchaseOrderCompanyContext(normalizedCompanyId, {
    required: Boolean(requisitionRow)
  });

  if (requisitionRow && companyRecord) {
    const requisitionCompanyId = Number(requisitionRow.company_id || 0) || 0;
    const resolvedCompanyId = Number(companyRecord.id || 0) || 0;
    const expectedCompanyId = requisitionCompanyId || 0;
    if (expectedCompanyId && resolvedCompanyId && expectedCompanyId !== resolvedCompanyId) {
      throw new Error('Selected requisition must belong to the same company.');
    }
  }

  return {
    requisitionRow,
    companyRecord
  };
}

async function resolvePurchaseOrderProjectContext(projectId = 0, companyId = 0) {
  const normalizedProjectId = Number(projectId || 0) || 0;
  if (!normalizedProjectId) return null;

  const rows = await queryAsync(
    'SELECT id, project_docno, project_name, company_id FROM projects WHERE id = ? LIMIT 1',
    [normalizedProjectId]
  );
  if (!Array.isArray(rows) || !rows.length) {
    throw new Error('Selected project was not found.');
  }

  const project = rows[0];
  const projectCompanyId = Number(project.company_id || 0) || 0;
  const normalizedCompanyId = Number(companyId || 0) || 0;
  if (projectCompanyId && normalizedCompanyId && projectCompanyId !== normalizedCompanyId) {
    throw new Error('Selected project must belong to the same company.');
  }

  return project;
}

app.get('/api/procurement/purchase-orders', protectAdmin, async (req, res) => {
  try {
    const [purchaseOrders, lineItems] = await Promise.all([
      queryAsync(`
      SELECT
        po.*,
        be.company_name AS business_entity_name,
        be.entity_code AS business_entity_code,
        r.pr_number AS requisition_number,
        v.vendor_name,
        COALESCE(po.company_id, r.company_id) AS company_id,
        c.company_name,
        c.company_no,
        p.project_docno,
        p.project_name,
        (SELECT COUNT(*) FROM accounts_payable ap WHERE ap.po_id = po.id) AS bill_count
      FROM purchase_orders po
      LEFT JOIN business_entities be ON be.id = po.business_entity_id
      LEFT JOIN purchase_requisitions r ON r.id = po.requisition_id
      LEFT JOIN vendors v ON v.id = po.vendor_id
      LEFT JOIN company_registry c ON c.id = COALESCE(po.company_id, r.company_id)
      LEFT JOIN projects p ON p.id = po.project_id
        ORDER BY po.po_date DESC, po.id DESC
      `),
      queryAsync(`
        SELECT
          li.*,
          pr.name AS product_name,
          pr.description AS product_description
        FROM po_line_items li
        LEFT JOIN products pr ON pr.id = li.product_id
        ORDER BY li.po_id ASC, li.id ASC
      `)
    ]);

    const itemsByPo = new Map();
    (Array.isArray(lineItems) ? lineItems : []).forEach((item) => {
      const poId = Number(item.po_id || 0);
      if (!poId) return;

      const bucket = itemsByPo.get(poId) || [];
      bucket.push({
        ...item,
        quantity: Number(item.quantity || 0),
        unit_price: Number(item.unit_price || 0),
        line_total: Number(item.line_total || 0),
        description: String(item.description || item.product_name || item.product_description || '').trim(),
        display_label: String(item.description || item.product_name || item.product_description || '').trim()
      });
      itemsByPo.set(poId, bucket);
    });

    const rows = (Array.isArray(purchaseOrders) ? purchaseOrders : []).map((po) => {
      const items = itemsByPo.get(Number(po.id || 0)) || [];
      const computedTotal = items.reduce((sum, item) => sum + Number(item.line_total || 0), 0);
      return {
        ...po,
        line_items: items,
        line_count: items.length,
        computed_total: computedTotal || Number(po.total_amount || 0),
        item_summary: buildPurchaseOrderItemSummary(items)
      };
    });

    res.json(rows);
  } catch (err) {
    console.error('Purchase orders error:', err);
    res.status(500).json({ error: err.message || 'Unable to load purchase orders.' });
  }
});

app.post('/api/procurement/purchase-orders', protectAdmin, async (req, res) => {
  let poNumber = String(req.body.po_number || '').trim();
  const vendorId = Number(req.body.vendor_id || 0);
  const requisitionId = Number(req.body.requisition_id || 0) || null;
  const explicitBusinessEntityId = Number(req.body.business_entity_id || 0) || null;
  const explicitCompanyId = Number(req.body.company_id || 0) || 0;
  const projectId = Number(req.body.project_id || 0) || null;
  const poDate = req.body.po_date || new Date().toISOString().slice(0, 10);
  const deliveryDate = req.body.delivery_date || null;
  const paymentTerms = String(req.body.payment_terms || '').trim() || null;
  const preparedBy = String(req.body.prepared_by || '').trim() || null;
  const approvedBy = String(req.body.approved_by || '').trim() || null;
  const notes = String(req.body.notes || '').trim() || null;
  const status = String(req.body.status || 'draft').trim().toLowerCase();
  const lineItems = normalizePurchaseOrderLineItems(req.body);

  if (!vendorId || !lineItems.length) {
    return res.status(400).json({ error: 'Vendor and at least one line item description are required.' });
  }

  const totalAmount = lineItems.reduce((sum, item) => sum + (Number(item.quantity || 0) * Number(item.unit_price || 0)), 0);

  try {
    const vendorRows = await queryAsync(
      'SELECT id, vendor_no, vendor_name, business_entity_id, COALESCE(is_active, TRUE) AS is_active FROM vendors WHERE id = ? LIMIT 1',
      [vendorId]
    );
    if (!Array.isArray(vendorRows) || !vendorRows.length) {
      return res.status(404).json({ error: 'Vendor not found.' });
    }
    if (Number(vendorRows[0].is_active || 0) !== 1) {
      return res.status(400).json({ error: 'Vendor is inactive. Activate the vendor before using it in a purchase order.' });
    }

    const { companyRecord, requisitionRow } = await resolvePurchaseOrderRequisitionContext(
      requisitionId,
      explicitCompanyId,
      { requireApproved: Boolean(requisitionId), allowOrdered: false }
    );
    const businessEntityId = await resolveBusinessEntityId(explicitBusinessEntityId || requisitionRow?.business_entity_id || null);
    if (Number(vendorRows[0].business_entity_id || 0) && Number(vendorRows[0].business_entity_id || 0) === Number(businessEntityId || 0)) {
      return res.status(400).json({ error: 'Select another vendor. The issuing company cannot be its own supplier on this PO.' });
    }
    if (!poNumber) {
      poNumber = await generateNextEntityDocumentNo({
        businessEntityId,
        documentType: 'purchase-order',
        prefix: 'PO',
        tableName: 'purchase_orders',
        columnName: 'po_number'
      });
    }
    const projectRecord = await resolvePurchaseOrderProjectContext(projectId, companyRecord?.id || explicitCompanyId || 0);
    const resolvedCompanyId = Number(companyRecord?.id || projectRecord?.company_id || 0) || null;
    const poResult = await queryAsync(
      'INSERT INTO purchase_orders (po_number, requisition_id, business_entity_id, vendor_id, company_id, project_id, po_date, delivery_date, payment_terms, prepared_by, approved_by, total_amount, status, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [poNumber, requisitionRow?.id || null, businessEntityId, vendorId, resolvedCompanyId, projectRecord?.id || null, poDate, deliveryDate, paymentTerms, preparedBy, approvedBy, totalAmount, status, notes]
    );

    for (const item of lineItems) {
      const lineTotal = Number(item.quantity || 0) * Number(item.unit_price || 0);
      await queryAsync(
        'INSERT INTO po_line_items (po_id, product_id, description, quantity, unit_price, line_total) VALUES (?, ?, ?, ?, ?, ?)',
        [poResult.insertId, item.product_id || null, item.description, item.quantity, item.unit_price, lineTotal]
      );
    }
    if (requisitionRow?.id) {
      await markRequisitionOrdered(requisitionRow.id);
    }

    logAction(req, 'CREATE_PURCHASE_ORDER', `Created purchase order ${poNumber}`);
    res.json({ id: poResult.insertId, po_number: poNumber });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'PO number already exists.' });
    }
    const validationMessage = String(err?.message || '').toLowerCase();
    if (validationMessage.includes('required') || validationMessage.includes('must match') || validationMessage.includes('same company') || validationMessage.includes('not found') || validationMessage.includes('approved')) {
      return res.status(400).json({ error: err.message || 'Unable to create purchase order.' });
    }
    console.error('Create purchase order error:', err);
    res.status(500).json({ error: err.message || 'Unable to create purchase order.' });
  }
});

app.post('/api/procurement/purchase-orders/:id/generate-bills', protectAdmin, async (req, res) => {
  const poId = Number(req.params.id || 0);
  if (!poId) {
    return res.status(400).json({ error: 'Purchase order ID is required.' });
  }

  try {
    const poRows = await queryAsync(
      `SELECT id, po_number, business_entity_id, vendor_id, project_id, po_date, delivery_date,
              total_amount, payment_terms, status
       FROM purchase_orders
       WHERE id = ? LIMIT 1`,
      [poId]
    );
    if (!Array.isArray(poRows) || !poRows.length) {
      return res.status(404).json({ error: 'Purchase order not found.' });
    }

    const existingBills = await queryAsync('SELECT id FROM accounts_payable WHERE po_id = ? LIMIT 1', [poId]);
    if (existingBills.length) {
      return res.status(409).json({ error: 'This PO already has AP bill(s).' });
    }

    const po = poRows[0];
    if (normalizeProcurementWorkflowStatus(po.status) !== 'approved') {
      return res.status(400).json({ error: 'Approve this purchase order before generating AP bills.' });
    }

    const schedule = parsePurchaseOrderPaymentTerms(po.payment_terms, po.total_amount);
    if (!schedule.length) {
      return res.status(400).json({ error: 'Payment terms must include percentage terms like "30% downpayment, 70% upon delivery".' });
    }

    const businessEntityId = await resolveBusinessEntityId(po.business_entity_id);
    const createdBills = [];
    for (const term of schedule) {
      const billNumber = await generateNextEntityDocumentNo({
        businessEntityId,
        documentType: 'ap-bill',
        prefix: 'BILL',
        tableName: 'accounts_payable',
        columnName: 'bill_number'
      });
      const dueDate = resolveTermDueDate(term, po.po_date, po.delivery_date);
      const notes = `Generated from ${po.po_number}: ${term.percent}% ${term.label}`;
      const result = await queryAsync(
        'INSERT INTO accounts_payable (business_entity_id, vendor_id, bill_number, bill_date, due_date, project_id, po_id, total_amount, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [businessEntityId, po.vendor_id, billNumber, po.po_date || getManilaYmd(), dueDate, po.project_id || null, poId, term.amount, notes]
      );
      createdBills.push({
        id: result.insertId,
        bill_number: billNumber,
        amount: term.amount,
        percent: term.percent,
        label: term.label
      });
    }

    logAction(req, 'GENERATE_PO_BILLS', `Generated ${createdBills.length} AP bill(s) from PO ${po.po_number}`);
    res.json({ success: true, bills: createdBills });
  } catch (err) {
    if (err && err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'A generated bill number already exists.' });
    }
    console.error('Generate PO bills error:', err);
    res.status(500).json({ error: err.message || 'Unable to generate AP bills from PO.' });
  }
});

app.get('/api/procurement/goods-receipts', protectAdmin, async (req, res) => {
  try {
    const rows = await queryAsync(`
      SELECT gr.*, po.po_number, po.business_entity_id, v.vendor_name
      FROM goods_receipts gr
      JOIN purchase_orders po ON po.id = gr.po_id
      LEFT JOIN vendors v ON v.id = po.vendor_id
      ORDER BY gr.received_date DESC, gr.id DESC
    `);
    res.json(rows);
  } catch (err) {
    console.error('Goods receipts error:', err);
    res.status(500).json({ error: err.message || 'Unable to load goods receipts.' });
  }
});

app.post('/api/procurement/goods-receipts', protectAdmin, async (req, res) => {
  const grnNumber = String(req.body.grn_number || '').trim() || generateCode('GRN');
  const poId = Number(req.body.po_id || 0);
  const receivedDate = req.body.received_date || new Date().toISOString().slice(0, 10);
  const receivedBy = String(req.body.received_by || '').trim() || null;
  const notes = String(req.body.notes || '').trim() || null;

  if (!poId) {
    return res.status(400).json({ error: 'Purchase order is required.' });
  }

  try {
    const poRows = await queryAsync('SELECT id, status FROM purchase_orders WHERE id = ? LIMIT 1', [poId]);
    if (!Array.isArray(poRows) || !poRows.length) {
      return res.status(404).json({ error: 'Purchase order not found.' });
    }
    if (normalizeProcurementWorkflowStatus(poRows[0].status) !== 'approved') {
      return res.status(400).json({ error: 'Approve this purchase order before receiving goods.' });
    }

    const result = await queryAsync(
      'INSERT INTO goods_receipts (grn_number, po_id, received_date, received_by, status, notes) VALUES (?, ?, ?, ?, ?, ?)',
      [grnNumber, poId, receivedDate, receivedBy, 'received', notes]
    );
    await markPurchaseOrderReceived(poId);

    logAction(req, 'CREATE_GOODS_RECEIPT', `Created goods receipt ${grnNumber}`);
    res.json({ id: result.insertId, grn_number: grnNumber });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'GRN number already exists.' });
    }
    console.error('Create goods receipt error:', err);
    res.status(500).json({ error: err.message || 'Unable to create goods receipt.' });
  }
});

app.put('/api/procurement/requisitions/:id', protectAdmin, async (req, res) => {
  const requisitionId = Number(req.params.id || 0);
  const prNumber = String(req.body.pr_number || '').trim() || generateCode('PR');
  const companyId = Number(req.body.company_id || 0) || 0;
  const requestDate = req.body.request_date || new Date().toISOString().slice(0, 10);
  const department = String(req.body.department || '').trim() || null;
  const requestedBy = String(req.body.requested_by || '').trim() || null;
  const neededBy = req.body.needed_by || null;
  const status = String(req.body.status || 'draft').trim().toLowerCase();
  const notes = String(req.body.notes || '').trim() || null;
  const lineItems = normalizePurchaseRequisitionLineItems(req.body);

  if (!requisitionId) {
    return res.status(400).json({ error: 'Requisition ID is required.' });
  }
  if (!lineItems.length) {
    return res.status(400).json({ error: 'At least one item name and quantity are required.' });
  }

  try {
    const businessEntityId = await resolveBusinessEntityId(req.body.business_entity_id);
    const requisitionRows = await queryAsync('SELECT id FROM purchase_requisitions WHERE id = ? LIMIT 1', [requisitionId]);
    if (!Array.isArray(requisitionRows) || !requisitionRows.length) {
      return res.status(404).json({ error: 'Requisition not found.' });
    }

    const { companyRecord } = await resolvePurchaseRequisitionContext(companyId);

    await queryAsync(
      `UPDATE purchase_requisitions
       SET pr_number = ?, business_entity_id = ?, company_id = ?, request_date = ?, department = ?, requested_by = ?, needed_by = ?, status = ?, notes = ?
       WHERE id = ?`,
      [
        prNumber,
        businessEntityId,
        companyRecord.id,
        requestDate,
        department,
        requestedBy,
        neededBy,
        status,
        notes,
        requisitionId
      ]
    );

    await queryAsync('DELETE FROM purchase_requisition_items WHERE pr_id = ?', [requisitionId]);

    for (const item of lineItems) {
      const lineTotal = Number(item.quantity || 0) * Number(item.estimated_unit_price || 0);
      await queryAsync(
        'INSERT INTO purchase_requisition_items (pr_id, item_name, description, quantity, unit, estimated_unit_price, line_total) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [requisitionId, item.item_name, item.description, item.quantity, item.unit, item.estimated_unit_price, lineTotal]
      );
    }

    logAction(req, 'UPDATE_PURCHASE_REQUISITION', `Updated requisition ${prNumber}`);
    res.json({ success: true, pr_number: prNumber });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'PR number already exists.' });
    }
    console.error('Update requisition error:', err);
    res.status(500).json({ error: err.message || 'Unable to update requisition.' });
  }
});

app.post('/api/procurement/requisitions/:id/submit', protectAdmin, async (req, res) => {
  const requisitionId = Number(req.params.id || 0);
  if (!requisitionId) return res.status(400).json({ error: 'Requisition ID is required.' });

  try {
    const rows = await queryAsync('SELECT id, pr_number, status FROM purchase_requisitions WHERE id = ? LIMIT 1', [requisitionId]);
    if (!Array.isArray(rows) || !rows.length) return res.status(404).json({ error: 'Requisition not found.' });

    assertStatusTransition(rows[0].status, 'submitted', {
      draft: ['submitted', 'cancelled'],
      submitted: ['submitted', 'approved', 'cancelled']
    }, 'Purchase requisition');

    await queryAsync("UPDATE purchase_requisitions SET status = 'submitted' WHERE id = ?", [requisitionId]);
    logAction(req, 'SUBMIT_PURCHASE_REQUISITION', `Submitted requisition ${rows[0].pr_number}`);
    res.json({ success: true, status: 'submitted' });
  } catch (err) {
    const validationMessage = String(err?.message || '').toLowerCase();
    if (validationMessage.includes('cannot move')) return res.status(400).json({ error: err.message });
    console.error('Submit requisition error:', err);
    res.status(500).json({ error: err.message || 'Unable to submit requisition.' });
  }
});

app.post('/api/procurement/requisitions/:id/approve', protectAdminOnly, async (req, res) => {
  const requisitionId = Number(req.params.id || 0);
  if (!requisitionId) return res.status(400).json({ error: 'Requisition ID is required.' });

  try {
    const rows = await queryAsync('SELECT id, pr_number, status FROM purchase_requisitions WHERE id = ? LIMIT 1', [requisitionId]);
    if (!Array.isArray(rows) || !rows.length) return res.status(404).json({ error: 'Requisition not found.' });

    assertStatusTransition(rows[0].status, 'approved', {
      draft: ['submitted', 'approved', 'cancelled'],
      submitted: ['approved', 'cancelled'],
      approved: ['approved']
    }, 'Purchase requisition');

    await queryAsync("UPDATE purchase_requisitions SET status = 'approved' WHERE id = ?", [requisitionId]);
    logAction(req, 'APPROVE_PURCHASE_REQUISITION', `Approved requisition ${rows[0].pr_number}`);
    res.json({ success: true, status: 'approved' });
  } catch (err) {
    const validationMessage = String(err?.message || '').toLowerCase();
    if (validationMessage.includes('cannot move')) return res.status(400).json({ error: err.message });
    console.error('Approve requisition error:', err);
    res.status(500).json({ error: err.message || 'Unable to approve requisition.' });
  }
});

app.post('/api/procurement/requisitions/:id/cancel', protectAdminOnly, async (req, res) => {
  const requisitionId = Number(req.params.id || 0);
  if (!requisitionId) return res.status(400).json({ error: 'Requisition ID is required.' });

  try {
    const rows = await queryAsync('SELECT id, pr_number, status FROM purchase_requisitions WHERE id = ? LIMIT 1', [requisitionId]);
    if (!Array.isArray(rows) || !rows.length) return res.status(404).json({ error: 'Requisition not found.' });

    assertStatusTransition(rows[0].status, 'cancelled', {
      draft: ['submitted', 'approved', 'cancelled'],
      submitted: ['approved', 'cancelled'],
      approved: ['cancelled'],
      cancelled: ['cancelled']
    }, 'Purchase requisition');

    await queryAsync("UPDATE purchase_requisitions SET status = 'cancelled' WHERE id = ?", [requisitionId]);
    logAction(req, 'CANCEL_PURCHASE_REQUISITION', `Cancelled requisition ${rows[0].pr_number}`);
    res.json({ success: true, status: 'cancelled' });
  } catch (err) {
    const validationMessage = String(err?.message || '').toLowerCase();
    if (validationMessage.includes('cannot move')) return res.status(400).json({ error: err.message });
    console.error('Cancel requisition error:', err);
    res.status(500).json({ error: err.message || 'Unable to cancel requisition.' });
  }
});

app.delete('/api/procurement/requisitions/:id', protectAdmin, async (req, res) => {
  try {
    const result = await queryAsync('DELETE FROM purchase_requisitions WHERE id = ?', [Number(req.params.id || 0)]);
    logAction(req, 'DELETE_PURCHASE_REQUISITION', `Deleted requisition ID: ${req.params.id}`);
    res.json({ success: true, affectedRows: result.affectedRows || 0 });
  } catch (err) {
    console.error('Delete requisition error:', err);
    res.status(500).json({ error: err.message || 'Unable to delete requisition.' });
  }
});

app.put('/api/procurement/purchase-orders/:id', protectAdmin, async (req, res) => {
  const poId = Number(req.params.id || 0);
  const poNumber = String(req.body.po_number || '').trim() || generateCode('PO');
  const vendorId = Number(req.body.vendor_id || 0);
  const requisitionId = Number(req.body.requisition_id || 0) || null;
  const explicitBusinessEntityId = Number(req.body.business_entity_id || 0) || null;
  const explicitCompanyId = Number(req.body.company_id || 0) || 0;
  const projectId = Number(req.body.project_id || 0) || null;
  const poDate = req.body.po_date || new Date().toISOString().slice(0, 10);
  const deliveryDate = req.body.delivery_date || null;
  const paymentTerms = String(req.body.payment_terms || '').trim() || null;
  const preparedBy = String(req.body.prepared_by || '').trim() || null;
  const approvedBy = String(req.body.approved_by || '').trim() || null;
  const notes = String(req.body.notes || '').trim() || null;
  const status = String(req.body.status || 'draft').trim().toLowerCase();
  const lineItems = normalizePurchaseOrderLineItems(req.body);

  if (!poId) {
    return res.status(400).json({ error: 'Purchase order ID is required.' });
  }
  if (!vendorId || !lineItems.length) {
    return res.status(400).json({ error: 'Vendor and at least one line item description are required.' });
  }

  try {
    const poRows = await queryAsync('SELECT id, requisition_id FROM purchase_orders WHERE id = ? LIMIT 1', [poId]);
    if (!Array.isArray(poRows) || !poRows.length) {
      return res.status(404).json({ error: 'Purchase order not found.' });
    }
    const currentRequisitionId = Number(poRows[0].requisition_id || 0) || 0;

    const vendorRows = await queryAsync(
      'SELECT id, vendor_no, vendor_name, business_entity_id, COALESCE(is_active, TRUE) AS is_active FROM vendors WHERE id = ? LIMIT 1',
      [vendorId]
    );
    if (!Array.isArray(vendorRows) || !vendorRows.length) {
      return res.status(404).json({ error: 'Vendor not found.' });
    }
    if (Number(vendorRows[0].is_active || 0) !== 1) {
      return res.status(400).json({ error: 'Vendor is inactive. Activate the vendor before using it in a purchase order.' });
    }

    const totalAmount = lineItems.reduce((sum, item) => sum + (Number(item.quantity || 0) * Number(item.unit_price || 0)), 0);
    const isSameRequisition = Boolean(requisitionId && currentRequisitionId && Number(requisitionId) === currentRequisitionId);
    const { companyRecord, requisitionRow } = await resolvePurchaseOrderRequisitionContext(
      requisitionId,
      explicitCompanyId,
      { requireApproved: Boolean(requisitionId), allowOrdered: isSameRequisition }
    );
    const businessEntityId = await resolveBusinessEntityId(explicitBusinessEntityId || requisitionRow?.business_entity_id || null);
    if (Number(vendorRows[0].business_entity_id || 0) && Number(vendorRows[0].business_entity_id || 0) === Number(businessEntityId || 0)) {
      return res.status(400).json({ error: 'Select another vendor. The issuing company cannot be its own supplier on this PO.' });
    }
    const projectRecord = await resolvePurchaseOrderProjectContext(projectId, companyRecord?.id || explicitCompanyId || 0);
    const resolvedCompanyId = Number(companyRecord?.id || projectRecord?.company_id || 0) || null;
    await queryAsync(
      'UPDATE purchase_orders SET po_number = ?, requisition_id = ?, business_entity_id = ?, vendor_id = ?, company_id = ?, project_id = ?, po_date = ?, delivery_date = ?, payment_terms = ?, prepared_by = ?, approved_by = ?, total_amount = ?, status = ?, notes = ? WHERE id = ?',
      [poNumber, requisitionRow?.id || null, businessEntityId, vendorId, resolvedCompanyId, projectRecord?.id || null, poDate, deliveryDate, paymentTerms, preparedBy, approvedBy, totalAmount, status, notes, poId]
    );

    await queryAsync('DELETE FROM po_line_items WHERE po_id = ?', [poId]);
    for (const item of lineItems) {
      const lineTotal = Number(item.quantity || 0) * Number(item.unit_price || 0);
      await queryAsync(
        'INSERT INTO po_line_items (po_id, product_id, description, quantity, unit_price, line_total) VALUES (?, ?, ?, ?, ?, ?)',
        [poId, item.product_id || null, item.description, item.quantity, item.unit_price, lineTotal]
      );
    }
    if (requisitionRow?.id) {
      await markRequisitionOrdered(requisitionRow.id);
    }

    logAction(req, 'UPDATE_PURCHASE_ORDER', `Updated purchase order ${poNumber}`);
    res.json({ success: true, po_number: poNumber });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'PO number already exists.' });
    }
    const validationMessage = String(err?.message || '').toLowerCase();
    if (validationMessage.includes('required') || validationMessage.includes('must match') || validationMessage.includes('same company') || validationMessage.includes('not found') || validationMessage.includes('approved')) {
      return res.status(400).json({ error: err.message || 'Unable to update purchase order.' });
    }
    console.error('Update purchase order error:', err);
    res.status(500).json({ error: err.message || 'Unable to update purchase order.' });
  }
});

app.post('/api/procurement/purchase-orders/:id/submit', protectAdmin, async (req, res) => {
  const poId = Number(req.params.id || 0);
  if (!poId) return res.status(400).json({ error: 'Purchase order ID is required.' });

  try {
    const rows = await queryAsync('SELECT id, po_number, status FROM purchase_orders WHERE id = ? LIMIT 1', [poId]);
    if (!Array.isArray(rows) || !rows.length) return res.status(404).json({ error: 'Purchase order not found.' });

    assertStatusTransition(rows[0].status, 'pending', {
      draft: ['pending', 'cancelled'],
      pending: ['pending', 'approved', 'cancelled']
    }, 'Purchase order');

    await queryAsync("UPDATE purchase_orders SET status = 'pending' WHERE id = ?", [poId]);
    logAction(req, 'SUBMIT_PURCHASE_ORDER', `Submitted purchase order ${rows[0].po_number}`);
    res.json({ success: true, status: 'pending' });
  } catch (err) {
    const validationMessage = String(err?.message || '').toLowerCase();
    if (validationMessage.includes('cannot move')) return res.status(400).json({ error: err.message });
    console.error('Submit purchase order error:', err);
    res.status(500).json({ error: err.message || 'Unable to submit purchase order.' });
  }
});

app.post('/api/procurement/purchase-orders/:id/approve', protectAdminOnly, async (req, res) => {
  const poId = Number(req.params.id || 0);
  if (!poId) return res.status(400).json({ error: 'Purchase order ID is required.' });

  try {
    const rows = await queryAsync('SELECT id, po_number, status, approved_by FROM purchase_orders WHERE id = ? LIMIT 1', [poId]);
    if (!Array.isArray(rows) || !rows.length) return res.status(404).json({ error: 'Purchase order not found.' });

    assertStatusTransition(rows[0].status, 'approved', {
      draft: ['pending', 'approved', 'cancelled'],
      pending: ['approved', 'cancelled'],
      approved: ['approved']
    }, 'Purchase order');

    const approvedBy = String(rows[0].approved_by || '').trim() || getApprovalActorName(req);
    await queryAsync("UPDATE purchase_orders SET status = 'approved', approved_by = ? WHERE id = ?", [approvedBy, poId]);
    logAction(req, 'APPROVE_PURCHASE_ORDER', `Approved purchase order ${rows[0].po_number}`);
    res.json({ success: true, status: 'approved', approved_by: approvedBy });
  } catch (err) {
    const validationMessage = String(err?.message || '').toLowerCase();
    if (validationMessage.includes('cannot move')) return res.status(400).json({ error: err.message });
    console.error('Approve purchase order error:', err);
    res.status(500).json({ error: err.message || 'Unable to approve purchase order.' });
  }
});

app.post('/api/procurement/purchase-orders/:id/cancel', protectAdminOnly, async (req, res) => {
  const poId = Number(req.params.id || 0);
  if (!poId) return res.status(400).json({ error: 'Purchase order ID is required.' });

  try {
    const rows = await queryAsync('SELECT id, po_number, status FROM purchase_orders WHERE id = ? LIMIT 1', [poId]);
    if (!Array.isArray(rows) || !rows.length) return res.status(404).json({ error: 'Purchase order not found.' });

    assertStatusTransition(rows[0].status, 'cancelled', {
      draft: ['pending', 'approved', 'cancelled'],
      pending: ['approved', 'cancelled'],
      approved: ['cancelled'],
      cancelled: ['cancelled']
    }, 'Purchase order');

    await queryAsync("UPDATE purchase_orders SET status = 'cancelled' WHERE id = ?", [poId]);
    logAction(req, 'CANCEL_PURCHASE_ORDER', `Cancelled purchase order ${rows[0].po_number}`);
    res.json({ success: true, status: 'cancelled' });
  } catch (err) {
    const validationMessage = String(err?.message || '').toLowerCase();
    if (validationMessage.includes('cannot move')) return res.status(400).json({ error: err.message });
    console.error('Cancel purchase order error:', err);
    res.status(500).json({ error: err.message || 'Unable to cancel purchase order.' });
  }
});

app.delete('/api/procurement/purchase-orders/:id', protectAdmin, async (req, res) => {
  const poId = Number(req.params.id || 0);
  try {
    await queryAsync('DELETE FROM po_line_items WHERE po_id = ?', [poId]);
    const result = await queryAsync('DELETE FROM purchase_orders WHERE id = ?', [poId]);
    logAction(req, 'DELETE_PURCHASE_ORDER', `Deleted purchase order ID: ${req.params.id}`);
    res.json({ success: true, affectedRows: result.affectedRows || 0 });
  } catch (err) {
    console.error('Delete purchase order error:', err);
    res.status(500).json({ error: err.message || 'Unable to delete purchase order.' });
  }
});

app.get('/api/service-orders', protectAdmin, async (req, res) => {
  try {
    const includeArchived = String(req.query.include_archived || '').trim() === '1';
    const archiveWhere = includeArchived ? '' : 'WHERE COALESCE(so.is_archived, 0) = 0';
    const rows = await queryAsync(`
      SELECT
        so.*,
        be.company_name AS business_entity_name,
        be.entity_code AS business_entity_code,
        v.vendor_name,
        c.company_no,
        c.company_name,
        p.project_name,
        p.project_docno,
        tx.transaction_count,
        tx.transaction_docnos
      FROM service_orders so
      LEFT JOIN business_entities be ON be.id = so.business_entity_id
      LEFT JOIN vendors v ON v.id = so.vendor_id
      LEFT JOIN company_registry c ON c.id = so.company_id
      LEFT JOIN projects p ON p.id = so.project_id
      LEFT JOIN (
        SELECT
          service_order_id,
          COUNT(*) AS transaction_count,
          GROUP_CONCAT(docno ORDER BY date DESC, id DESC SEPARATOR ', ') AS transaction_docnos
        FROM transactions
        WHERE COALESCE(archived, 0) = 0
          AND COALESCE(service_order_id, 0) > 0
        GROUP BY service_order_id
      ) tx ON tx.service_order_id = so.id
      ${archiveWhere}
      ORDER BY so.service_date DESC, so.id DESC
    `);
    res.json(rows);
  } catch (err) {
    console.error('Service orders error:', err);
    res.status(500).json({ error: err.message || 'Unable to load service orders.' });
  }
});

app.get('/api/projects', protectAdmin, (req, res) => {
  runArchiveMaintenance((maintenanceErr) => {
    if (maintenanceErr) {
      console.error('Project maintenance warning:', maintenanceErr);
    }

    const includeArchived = String(req.query.include_archived || '0') === '1';
    const where = includeArchived ? '' : 'WHERE COALESCE(p.is_archived, 0) = 0';
    db.query(`
      SELECT p.*, be.company_name AS business_entity_name, be.entity_code AS business_entity_code
      FROM projects p
      LEFT JOIN business_entities be ON be.id = p.business_entity_id
      ${where}
      ORDER BY COALESCE(p.start_date, p.planned_start_date, p.created_at) DESC, p.id DESC
    `, (err, rows) => {
      if (err) {
        console.error('Projects API error:', err);
        return res.status(500).json({ error: err.message });
      }
      res.json(Array.isArray(rows) ? rows : []);
    });
  });
});

app.get('/api/service-orders/:id/pdf', protectAdmin, (req, res) => {
  sendServiceOrderPdf(req, res, req.params.id);
});

app.put('/api/service-orders/:id/archive', protectAdmin, (req, res) => {
  const serviceOrderId = Number(req.params.id || 0);
  if (!serviceOrderId) return res.status(400).json({ error: 'Invalid service order id' });

  db.query(
    'UPDATE service_orders SET is_archived = 1, archived_at = NOW() WHERE id = ?',
    [serviceOrderId],
    (err, result) => {
      if (err) return res.status(500).json({ error: err.message });
      if (result.affectedRows === 0) return res.status(404).json({ error: 'Service order not found' });
      logAction(req, 'ARCHIVE_SERVICE_ORDER', `Archived service order ID: ${serviceOrderId}`);
      res.json({ success: true });
    }
  );
});

app.put('/api/service-orders/:id/restore', protectAdmin, (req, res) => {
  const serviceOrderId = Number(req.params.id || 0);
  if (!serviceOrderId) return res.status(400).json({ error: 'Invalid service order id' });

  db.query(
    'UPDATE service_orders SET is_archived = 0, archived_at = NULL WHERE id = ?',
    [serviceOrderId],
    (err, result) => {
      if (err) return res.status(500).json({ error: err.message });
      if (result.affectedRows === 0) return res.status(404).json({ error: 'Service order not found' });
      logAction(req, 'RESTORE_SERVICE_ORDER', `Restored service order ID: ${serviceOrderId}`);
      res.json({ success: true });
    }
  );
});

app.put('/api/procurement/goods-receipts/:id', protectAdmin, async (req, res) => {
  const receiptId = Number(req.params.id || 0);
  const grnNumber = String(req.body.grn_number || '').trim() || generateCode('GRN');
  const poId = Number(req.body.po_id || 0);
  const receivedDate = req.body.received_date || new Date().toISOString().slice(0, 10);
  const receivedBy = String(req.body.received_by || '').trim() || null;
  const status = String(req.body.status || 'received').trim().toLowerCase();
  const notes = String(req.body.notes || '').trim() || null;

  if (!receiptId) {
    return res.status(400).json({ error: 'Goods receipt ID is required.' });
  }
  if (!poId) {
    return res.status(400).json({ error: 'Purchase order is required.' });
  }

  try {
    const receiptRows = await queryAsync('SELECT id FROM goods_receipts WHERE id = ? LIMIT 1', [receiptId]);
    if (!Array.isArray(receiptRows) || !receiptRows.length) {
      return res.status(404).json({ error: 'Goods receipt not found.' });
    }
    const poRows = await queryAsync('SELECT id FROM purchase_orders WHERE id = ? LIMIT 1', [poId]);
    if (!Array.isArray(poRows) || !poRows.length) {
      return res.status(404).json({ error: 'Purchase order not found.' });
    }

    await queryAsync(
      'UPDATE goods_receipts SET grn_number = ?, po_id = ?, received_date = ?, received_by = ?, status = ?, notes = ? WHERE id = ?',
      [grnNumber, poId, receivedDate, receivedBy, status, notes, receiptId]
    );
    if (status === 'received') {
      await markPurchaseOrderReceived(poId);
    }

    logAction(req, 'UPDATE_GOODS_RECEIPT', `Updated goods receipt ${grnNumber}`);
    res.json({ success: true, grn_number: grnNumber });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'GRN number already exists.' });
    }
    console.error('Update goods receipt error:', err);
    res.status(500).json({ error: err.message || 'Unable to update goods receipt.' });
  }
});

app.delete('/api/procurement/goods-receipts/:id', protectAdmin, async (req, res) => {
  try {
    const result = await queryAsync('DELETE FROM goods_receipts WHERE id = ?', [Number(req.params.id || 0)]);
    logAction(req, 'DELETE_GOODS_RECEIPT', `Deleted goods receipt ID: ${req.params.id}`);
    res.json({ success: true, affectedRows: result.affectedRows || 0 });
  } catch (err) {
    console.error('Delete goods receipt error:', err);
    res.status(500).json({ error: err.message || 'Unable to delete goods receipt.' });
  }
});

app.get('/api/hr/departments', protectAdmin, async (req, res) => {
  try {
    const rows = await queryAsync('SELECT * FROM departments ORDER BY department_name ASC');
    res.json(rows);
  } catch (err) {
    console.error('Departments error:', err);
    res.status(500).json({ error: err.message || 'Unable to load departments.' });
  }
});

app.post('/api/hr/departments', protectAdmin, async (req, res) => {
  try {
    const departmentName = String(req.body.department_name || '').trim();
    const description = String(req.body.description || '').trim() || null;
    if (!departmentName) {
      return res.status(400).json({ error: 'Department name is required.' });
    }
    const duplicateRows = await queryAsync(
      'SELECT id FROM departments WHERE department_name = ? LIMIT 1',
      [departmentName]
    );
    if (duplicateRows.length) {
      return res.status(409).json({ error: 'Department already exists.', field: 'department_name' });
    }
    const result = await queryAsync(
      'INSERT INTO departments (department_name, description) VALUES (?, ?)',
      [departmentName, description]
    );
    res.json({ id: result.insertId });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'Department already exists.' });
    }
    console.error('Create department error:', err);
    res.status(500).json({ error: err.message || 'Unable to create department.' });
  }
});

app.get('/api/hr/employees', protectAdmin, async (req, res) => {
  try {
    const rows = await queryAsync(`
      SELECT e.*, d.department_name
      FROM employees e
      LEFT JOIN departments d ON d.id = e.department_id
      ORDER BY e.full_name ASC
    `);
    res.json(rows);
  } catch (err) {
    console.error('Employees error:', err);
    res.status(500).json({ error: err.message || 'Unable to load employees.' });
  }
});

app.post('/api/hr/employees', protectAdmin, async (req, res) => {
  try {
    const employeeCode = String(req.body.employee_code || '').trim() || generateCode('EMP');
    const fullName = String(req.body.full_name || '').trim();
    const departmentId = req.body.department_id ? Number(req.body.department_id) : null;
    const jobTitle = String(req.body.job_title || '').trim() || null;
    const employmentType = String(req.body.employment_type || 'regular').trim().toLowerCase();
    const payFrequency = String(req.body.pay_frequency || 'monthly').trim().toLowerCase();
    const salaryRate = toNumber(req.body.salary_rate, 0);
    const email = String(req.body.email || '').trim() || null;
    const phone = normalizePhone(req.body.phone);
    const hireDate = req.body.hire_date || null;

    if (!fullName) {
      return res.status(400).json({ error: 'Employee name is required.' });
    }

    if (phone && !isValidPhone(phone)) {
      return res.status(400).json({ error: 'Employee phone number must be digits only, 7 to 15 digits.' });
    }

    const duplicateRows = await queryAsync(
      'SELECT id FROM employees WHERE employee_code = ? LIMIT 1',
      [employeeCode]
    );
    if (duplicateRows.length) {
      return res.status(409).json({ error: 'Employee code already exists.', field: 'employee_code' });
    }

    const result = await queryAsync(
      'INSERT INTO employees (employee_code, full_name, department_id, job_title, employment_type, pay_frequency, salary_rate, email, phone, hire_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [employeeCode, fullName, departmentId, jobTitle, employmentType, payFrequency, salaryRate, email, phone, hireDate]
    );
    res.json({ id: result.insertId, employee_code: employeeCode });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'Employee code already exists.' });
    }
    console.error('Create employee error:', err);
    res.status(500).json({ error: err.message || 'Unable to create employee.' });
  }
});

app.get('/api/hr/payroll-periods', protectAdmin, async (req, res) => {
  try {
    const rows = await queryAsync('SELECT * FROM payroll_periods ORDER BY start_date DESC, id DESC');
    res.json(rows);
  } catch (err) {
    console.error('Payroll periods error:', err);
    res.status(500).json({ error: err.message || 'Unable to load payroll periods.' });
  }
});

app.post('/api/hr/payroll-periods', protectAdmin, async (req, res) => {
  try {
    const periodName = String(req.body.period_name || '').trim() || generateCode('PAY');
    const startDate = req.body.start_date;
    const endDate = req.body.end_date;
    const payDate = req.body.pay_date || null;
    const status = String(req.body.status || 'open').trim().toLowerCase();

    if (!startDate || !endDate) {
      return res.status(400).json({ error: 'Start and end dates are required.' });
    }

    const duplicateRows = await queryAsync(
      'SELECT id FROM payroll_periods WHERE period_name = ? LIMIT 1',
      [periodName]
    );
    if (duplicateRows.length) {
      return res.status(409).json({ error: 'Payroll period already exists.', field: 'period_name' });
    }

    const result = await queryAsync(
      'INSERT INTO payroll_periods (period_name, start_date, end_date, pay_date, status) VALUES (?, ?, ?, ?, ?)',
      [periodName, startDate, endDate, payDate, status]
    );
    res.json({ id: result.insertId, period_name: periodName });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'Payroll period already exists.' });
    }
    console.error('Create payroll period error:', err);
    res.status(500).json({ error: err.message || 'Unable to create payroll period.' });
  }
});

app.get('/api/hr/payroll-runs', protectAdmin, async (req, res) => {
  try {
    const rows = await queryAsync(`
      SELECT pr.*, pp.period_name, e.employee_code, e.full_name
      FROM payroll_runs pr
      JOIN payroll_periods pp ON pp.id = pr.period_id
      JOIN employees e ON e.id = pr.employee_id
      ORDER BY pr.created_at DESC, pr.id DESC
    `);
    res.json(rows);
  } catch (err) {
    console.error('Payroll runs error:', err);
    res.status(500).json({ error: err.message || 'Unable to load payroll runs.' });
  }
});

app.post('/api/hr/payroll-runs', protectAdmin, async (req, res) => {
  try {
    const periodId = Number(req.body.period_id || 0);
    const employeeId = Number(req.body.employee_id || 0);
    const grossPay = toNumber(req.body.gross_pay, 0);
    const deductions = toNumber(req.body.deductions, 0);
    const notes = String(req.body.notes || '').trim() || null;

    if (!periodId || !employeeId) {
      return res.status(400).json({ error: 'Payroll period and employee are required.' });
    }

    const netPay = Math.max(0, grossPay - deductions);
    const result = await queryAsync(
      'INSERT INTO payroll_runs (period_id, employee_id, gross_pay, deductions, net_pay, status, notes) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [periodId, employeeId, grossPay, deductions, netPay, 'draft', notes]
    );

    await queryAsync(
      'INSERT INTO payroll_run_lines (payroll_run_id, line_type, amount) VALUES (?, ?, ?)',
      [result.insertId, 'gross_pay', grossPay]
    );
    await queryAsync(
      'INSERT INTO payroll_run_lines (payroll_run_id, line_type, amount) VALUES (?, ?, ?)',
      [result.insertId, 'deductions', deductions]
    );
    await queryAsync(
      'INSERT INTO payroll_run_lines (payroll_run_id, line_type, amount) VALUES (?, ?, ?)',
      [result.insertId, 'net_pay', netPay]
    );

    logAction(req, 'CREATE_PAYROLL_RUN', `Created payroll run for employee ID ${employeeId}`);
    res.json({ id: result.insertId, net_pay: netPay });
  } catch (err) {
    console.error('Create payroll run error:', err);
    res.status(500).json({ error: err.message || 'Unable to create payroll run.' });
  }
});

app.post('/api/gantt/import', protectAdmin, ganttImportUpload.single('file'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded.' });
    }

    const originalName = String(req.file.originalname || 'uploaded-file').toLowerCase();
    const isCsv = originalName.endsWith('.csv');
    const isXlsx = originalName.endsWith('.xlsx') || originalName.endsWith('.xls');
    const isPdf = originalName.endsWith('.pdf');
    let rows = [];

    if (isCsv) {
      const text = req.file.buffer.toString('utf8');
      rows = parseDelimitedRowsFromText(text);
    } else if (isXlsx) {
      if (originalName.endsWith('.xls')) {
        return res.status(415).json({ error: 'Legacy .xls files are not supported yet. Please save as .xlsx or CSV.' });
      }

      const tempFile = path.join(os.tmpdir(), `kinaadman-${Date.now()}-${Math.random().toString(16).slice(2)}.xlsx`);
      try {
        fs.writeFileSync(tempFile, req.file.buffer);
        rows = readXlsxSheetRows(tempFile);
      } finally {
        fs.rmSync(tempFile, { force: true });
      }
    } else if (isPdf) {
      const text = extractPdfTextFromBuffer(req.file.buffer);
      rows = parseDelimitedRowsFromText(text);
    } else {
      return res.status(415).json({ error: 'Unsupported file type. Please upload CSV, XLSX, or PDF.' });
    }

    res.json({
      fileName: req.file.originalname,
      rows
    });
  } catch (err) {
    console.error('Gantt import parse error:', err);
    res.status(500).json({ error: err.message || 'Unable to parse uploaded file.' });
  }
});

async function normalizePaymentPayload(body = {}) {
  const paymentType = normalizeProcurementWorkflowStatus(body.payment_type);
  const amount = Number(body.amount || 0);
  const paymentDate = String(body.payment_date || '').trim();
  const apId = Number(body.ap_id || 0) || 0;
  const arId = Number(body.ar_id || 0) || 0;

  if (!['ap', 'ar'].includes(paymentType)) {
    throw new Error('Payment type must be AP or AR.');
  }
  if (!paymentDate) {
    throw new Error('Payment date is required.');
  }
  if (!(amount > 0)) {
    throw new Error('Payment amount must be greater than zero.');
  }

  if (paymentType === 'ap') {
    if (!apId) throw new Error('Accounts payable bill is required for AP payments.');
    const rows = await queryAsync('SELECT id FROM accounts_payable WHERE id = ? LIMIT 1', [apId]);
    if (!rows.length) throw new Error('Selected accounts payable bill was not found.');
    return {
      payment_type: paymentType,
      ap_id: apId,
      ar_id: null,
      payment_date: paymentDate,
      amount,
      payment_method: body.payment_method || 'cash',
      reference_number: body.reference_number || null,
      notes: body.notes || null
    };
  }

  if (!arId) throw new Error('Accounts receivable invoice is required for AR payments.');
  const rows = await queryAsync('SELECT id FROM accounts_receivable WHERE id = ? LIMIT 1', [arId]);
  if (!rows.length) throw new Error('Selected accounts receivable invoice was not found.');
  return {
    payment_type: paymentType,
    ap_id: null,
    ar_id: arId,
    payment_date: paymentDate,
    amount,
    payment_method: body.payment_method || 'cash',
    reference_number: body.reference_number || null,
    notes: body.notes || null
  };
}

app.get('/api/payments', protectAdmin, (req, res) => {
  const type = req.query.type || 'ap';
  db.query(
    'SELECT * FROM payments WHERE payment_type = ? ORDER BY payment_date DESC LIMIT 100',
    [type],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(rows);
    }
  );
});

app.post('/api/payments', protectAdmin, async (req, res) => {
  try {
    const payment = await normalizePaymentPayload(req.body);
    const result = await queryAsync(
      'INSERT INTO payments (payment_type, ap_id, ar_id, payment_date, amount, payment_method, reference_number, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [payment.payment_type, payment.ap_id, payment.ar_id, payment.payment_date, payment.amount, payment.payment_method, payment.reference_number, payment.notes]
    );

    if (payment.payment_type === 'ap' && payment.ap_id) {
      await syncPayableBalance(payment.ap_id);
    } else if (payment.payment_type === 'ar' && payment.ar_id) {
      await syncReceivableBalance(payment.ar_id);
    }

    res.json({ id: result.insertId });
  } catch (err) {
    const validationMessage = String(err?.message || '').toLowerCase();
    if (validationMessage.includes('required') || validationMessage.includes('must') || validationMessage.includes('not found')) {
      return res.status(400).json({ error: err.message || 'Unable to save payment.' });
    }
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/payments/:id', protectAdmin, async (req, res) => {
  const paymentId = Number(req.params.id || 0);
  if (!paymentId) return res.status(400).json({ error: 'Invalid payment id' });

  try {
    const payment = await normalizePaymentPayload(req.body);
    const existingRows = await queryAsync('SELECT * FROM payments WHERE id = ? LIMIT 1', [paymentId]);
    if (!existingRows.length) {
      return res.status(404).json({ error: 'Payment not found' });
    }
    const existing = existingRows[0];

    await queryAsync(
      'UPDATE payments SET payment_type = ?, ap_id = ?, ar_id = ?, payment_date = ?, amount = ?, payment_method = ?, reference_number = ?, notes = ? WHERE id = ?',
      [payment.payment_type, payment.ap_id, payment.ar_id, payment.payment_date, payment.amount, payment.payment_method, payment.reference_number, payment.notes, paymentId]
    );

    const affectedApIds = new Set();
    const affectedArIds = new Set();
    if (Number(existing.ap_id || 0)) affectedApIds.add(Number(existing.ap_id));
    if (Number(existing.ar_id || 0)) affectedArIds.add(Number(existing.ar_id));
    if (payment.payment_type === 'ap' && Number(payment.ap_id || 0)) affectedApIds.add(Number(payment.ap_id));
    if (payment.payment_type === 'ar' && Number(payment.ar_id || 0)) affectedArIds.add(Number(payment.ar_id));

    await Promise.all([
      ...Array.from(affectedApIds).map((id) => syncPayableBalance(id)),
      ...Array.from(affectedArIds).map((id) => syncReceivableBalance(id))
    ]);

    res.json({ success: true });
  } catch (err) {
    const validationMessage = String(err?.message || '').toLowerCase();
    if (validationMessage.includes('required') || validationMessage.includes('must') || validationMessage.includes('not found')) {
      return res.status(400).json({ error: err.message || 'Unable to update payment.' });
    }
    console.error('Update payment error:', err);
    res.status(500).json({ error: err.message || 'Unable to update payment.' });
  }
});

app.delete('/api/payments/:id', protectAdmin, async (req, res) => {
  const paymentId = Number(req.params.id || 0);
  if (!paymentId) return res.status(400).json({ error: 'Invalid payment id' });

  try {
    const existingRows = await queryAsync('SELECT * FROM payments WHERE id = ? LIMIT 1', [paymentId]);
    if (!existingRows.length) {
      return res.status(404).json({ error: 'Payment not found' });
    }
    const existing = existingRows[0];

    await queryAsync('DELETE FROM payments WHERE id = ?', [paymentId]);

    if (Number(existing.ap_id || 0)) {
      await syncPayableBalance(existing.ap_id);
    }
    if (Number(existing.ar_id || 0)) {
      await syncReceivableBalance(existing.ar_id);
    }

    res.json({ success: true });
  } catch (err) {
    console.error('Delete payment error:', err);
    res.status(500).json({ error: err.message || 'Unable to delete payment.' });
  }
});

app.get('/api/notifications', protectAdmin, (req, res) => {
  runArchiveMaintenance((maintenanceErr) => {
    if (maintenanceErr) {
      console.error('Notifications maintenance warning:', maintenanceErr);
    }

    db.query(
      `SELECT id, project_name, project_manager, start_date, end_date, status, COALESCE(is_archived, 0) AS is_archived
       FROM projects
       ORDER BY end_date ASC, start_date ASC`,
      (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });

        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const soonMs = 7 * 24 * 60 * 60 * 1000;

        const items = (rows || [])
          .filter((project) => Number(project.is_archived || 0) === 0)
          .map((project) => {
            const status = String(project.status || '').toLowerCase();
            const endDate = project.end_date ? new Date(project.end_date) : null;
            const startDate = project.start_date ? new Date(project.start_date) : null;
            if (endDate) endDate.setHours(0, 0, 0, 0);
            if (startDate) startDate.setHours(0, 0, 0, 0);

            if (status === 'completed') {
              return {
                id: `project-${project.id}-completed`,
                level: 'success',
                type: 'completed',
                project_id: project.id,
                title: project.project_name || 'Untitled Project',
                message: 'Project completed successfully.',
                meta: `Managed by ${project.project_manager || 'Unknown'}`,
                date: project.end_date || project.start_date || null,
                source_docno: project.source_docno || '',
                transaction_id: project.transaction_id || null
              };
            }

            if (!['cancelled', 'on_hold'].includes(status) && endDate && endDate < today) {
              return {
                id: `project-${project.id}-expired`,
                level: 'danger',
                type: 'expired',
                project_id: project.id,
                title: project.project_name || 'Untitled Project',
                message: 'Deadline expired and the project is still open.',
                meta: `Ended on ${formatNotificationDate(project.end_date)}`,
                date: project.end_date,
                source_docno: project.source_docno || '',
                transaction_id: project.transaction_id || null
              };
            }

            if (!['cancelled', 'on_hold'].includes(status) && endDate && (endDate - today) <= soonMs) {
              return {
                id: `project-${project.id}-deadline`,
                level: 'warning',
                type: 'deadline',
                project_id: project.id,
                title: project.project_name || 'Untitled Project',
                message: 'Deadline is coming soon.',
                meta: `Due on ${formatNotificationDate(project.end_date)}`,
                date: project.end_date,
                source_docno: project.source_docno || '',
                transaction_id: project.transaction_id || null
              };
            }

            if (['planning', 'on_hold'].includes(status)) {
              return {
                id: `project-${project.id}-pending`,
                level: 'info',
                type: 'pending',
                project_id: project.id,
                title: project.project_name || 'Untitled Project',
                message: 'Project is pending action or start confirmation.',
                meta: `Status: ${capitalizeProjectStatus(project.status)}`,
                date: project.start_date || project.end_date || null,
                source_docno: project.source_docno || '',
                transaction_id: project.transaction_id || null
              };
            }

            if (status === 'active' && startDate && (startDate - today) <= soonMs && startDate >= today) {
              return {
                id: `project-${project.id}-upcoming`,
                level: 'info',
                type: 'pending',
                project_id: project.id,
                title: project.project_name || 'Untitled Project',
                message: 'Project is starting soon.',
                meta: `Starts on ${formatNotificationDate(project.start_date)}`,
                date: project.start_date,
                source_docno: project.source_docno || '',
                transaction_id: project.transaction_id || null
              };
            }

            return null;
          })
          .filter(Boolean)
          .slice(0, 12);

        res.json({
          count: items.length,
          items
        });
      }
    );
  });
});

app.get('/api/projects/stats', protectAdmin, (req, res) => {
  runArchiveMaintenance((maintenanceErr) => {
    if (maintenanceErr) {
      console.error('Project stats maintenance warning:', maintenanceErr);
    }

    const yearParam = Number.parseInt(req.query.year, 10);
    const statsYear = Number.isFinite(yearParam) ? yearParam : new Date().getFullYear();
    const companyParam = String(req.query.company || '').trim();
    const companyFilter = companyParam && companyParam.toLowerCase() !== 'all' ? companyParam.toLowerCase() : '';
    const businessEntityId = normalizeBusinessEntityId(req.query.business_entity_id);
    const params = [];
    const whereParts = ['1=1'];
    if (businessEntityId) {
      whereParts.push('p.business_entity_id = ?');
      params.push(businessEntityId);
    }
    if (companyFilter) {
      whereParts.push('LOWER(COALESCE(p.company_name, p.client_name, p.company_no, \'\')) = ?');
      params.push(companyFilter);
    }
    db.query(`
      SELECT
        SUM(
          CASE
            WHEN COALESCE(is_archived, 0) = 0 AND status <> 'cancelled' THEN 1
            ELSE 0
          END
        ) AS total_projects,
        SUM(
          CASE
            WHEN COALESCE(is_archived, 0) = 0
              AND CURDATE() >= COALESCE(actual_start_date, planned_start_date, start_date)
              AND CURDATE() <= COALESCE(actual_end_date, planned_end_date, end_date)
              AND status NOT IN ('completed', 'cancelled', 'on_hold') THEN 1
            ELSE 0
          END
        ) AS ongoing_projects,
        SUM(
          CASE
            WHEN COALESCE(is_archived, 0) = 0
              AND CURDATE() < COALESCE(actual_start_date, planned_start_date, start_date)
              AND status NOT IN ('completed', 'cancelled', 'on_hold') THEN 1
            ELSE 0
          END
        ) AS upcoming_projects,
        SUM(
          CASE
            WHEN COALESCE(is_archived, 0) = 0
              AND CURDATE() > COALESCE(actual_end_date, planned_end_date, end_date)
              AND status NOT IN ('completed', 'cancelled', 'on_hold') THEN 1
            ELSE 0
          END
        ) AS overdue_projects
      FROM projects p
      WHERE ${whereParts.join(' AND ')}
    `, params, (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      const stats = rows[0] || {};
      res.json({
        total_projects: Number(stats.total_projects || 0),
        ongoing_projects: Number(stats.ongoing_projects || 0),
        upcoming_projects: Number(stats.upcoming_projects || 0),
        overdue_projects: Number(stats.overdue_projects || 0),
        stats_year: statsYear
      });
    });
  });
});

app.post('/api/projects', protectAdmin, upload.single('pdf_file'), (req, res) => {
  const {
    project_name,
    business_entity_id,
    transaction_id,
    source_docno,
    company_id,
    company_no,
    company_name,
    client_name,
    description,
    checkno,
    pono,
    downpayment,
    qty,
    project_members,
    member_role,
    member_phone,
    project_members_2,
    member_role_2,
    member_phone_2,
    project_members_3,
    member_role_3,
    member_phone_3,
    start_date,
    end_date,
    planned_start_date,
    planned_end_date,
    actual_start_date,
    actual_end_date,
    status_reason,
    paused_at,
    cancelled_at,
    project_manager,
    budget,
    unit_cost,
    members,
    createDefaultTask
  } = req.body;
  const pdfFilename = req.file ? req.file.filename : String(req.body.pdfFilename || '').trim() || null;
  const resolvedBudget = toNumber(budget, 0);
  const resolvedDownpayment = toNumber(downpayment, 0);
  const resolvedQty = toNumber(qty, 0);
  const resolvedUnitCost = toNumber(unit_cost, 0);
  const normalizedMemberPhone = normalizePhone(member_phone);
  const normalizedMemberPhone2 = normalizePhone(member_phone_2);
  const normalizedMemberPhone3 = normalizePhone(member_phone_3);

  if (!project_name || !start_date || !end_date)
    return res.status(400).json({ error: 'Missing required fields' });

  if (normalizedMemberPhone && !isValidPhone(normalizedMemberPhone)) {
    return res.status(400).json({ error: 'Member phone number must be digits only, 7 to 15 digits.' });
  }

  if (normalizedMemberPhone2 && !isValidPhone(normalizedMemberPhone2)) {
    return res.status(400).json({ error: 'Member 2 phone number must be digits only, 7 to 15 digits.' });
  }

  if (normalizedMemberPhone3 && !isValidPhone(normalizedMemberPhone3)) {
    return res.status(400).json({ error: 'Member 3 phone number must be digits only, 7 to 15 digits.' });
  }

  const resolvedPlannedStart = planned_start_date || start_date;
  const resolvedPlannedEnd = planned_end_date || end_date;
  const projectMembersSummary = [
    project_members && member_role && normalizedMemberPhone ? `${project_members} (${member_role}) - ${normalizedMemberPhone}` : '',
    project_members_2 && member_role_2 && normalizedMemberPhone2 ? `${project_members_2} (${member_role_2}) - ${normalizedMemberPhone2}` : '',
    project_members_3 && member_role_3 && normalizedMemberPhone3 ? `${project_members_3} (${member_role_3}) - ${normalizedMemberPhone3}` : ''
  ].filter(Boolean).join(' | ') || null;
  resolveCompanyRegistryReference({ company_id, company_no, company_name, client_name }, async (companyErr, companyRecord) => {
    if (companyErr) return res.status(400).json({ error: companyErr.message });
    if (!companyRecord) return res.status(400).json({ error: 'Company is required' });

    const resolvedCompanyId = Number(companyRecord.id || 0) || null;
    const resolvedCompanyNo = String(companyRecord.company_no || '').trim() || null;
    const resolvedCompanyName = String(companyRecord.company_name || '').trim() || null;
    let resolvedBusinessEntityId = null;
    try {
      resolvedBusinessEntityId = await resolveBusinessEntityId(business_entity_id);
    } catch (entityErr) {
      return res.status(400).json({ error: entityErr.message || 'Selected operating company was not found.' });
    }

    let duplicateProject = null;
    try {
      duplicateProject = await findProjectDuplicateByIdentity({
        businessEntityId: resolvedBusinessEntityId,
        companyId: resolvedCompanyId,
        projectName: project_name,
        plannedStartDate: resolvedPlannedStart,
        plannedEndDate: resolvedPlannedEnd
      });
    } catch (dupErr) {
      return res.status(500).json({ error: dupErr.message || 'Unable to check duplicate project.' });
    }
    if (duplicateProject) {
      return sendProjectDuplicateResponse(res, duplicateProject);
    }

    const insertProject = (finalProjectDocno) => {
      const projectArInvoiceNo = getProjectInvoiceNumber(finalProjectDocno);
      const projectApBillNo = getProjectBillNumber(finalProjectDocno);
      db.query(
        `INSERT INTO projects
          (project_docno, project_name, business_entity_id, transaction_id, company_id, source_docno, company_no, company_name, client_name, project_ar_invoice_no, project_ap_bill_no, description, checkno, pono, downpayment, qty,
           project_members, member_role, member_phone,
           project_members_2, member_role_2, member_phone_2,
           project_members_3, member_role_3, member_phone_3,
           start_date, end_date, planned_start_date, planned_end_date,
           actual_start_date, actual_end_date, status_reason, paused_at, cancelled_at,
           project_manager, pdfFilename, budget, unit_cost, members)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)` ,
        [
          finalProjectDocno || null,
          project_name,
          resolvedBusinessEntityId,
          transaction_id || null,
          resolvedCompanyId,
          source_docno || null,
          resolvedCompanyNo,
          resolvedCompanyName,
          resolvedCompanyName,
          projectArInvoiceNo,
          projectApBillNo,
          description || null,
          checkno || null,
          pono || null,
          resolvedDownpayment,
          resolvedQty,
          project_members || null,
          member_role || null,
          normalizedMemberPhone || null,
          project_members_2 || null,
          member_role_2 || null,
          normalizedMemberPhone2 || null,
          project_members_3 || null,
          member_role_3 || null,
          normalizedMemberPhone3 || null,
          start_date,
          end_date,
          resolvedPlannedStart,
          resolvedPlannedEnd,
          actual_start_date || null,
          actual_end_date || null,
          status_reason || null,
          paused_at || null,
          cancelled_at || null,
          project_manager || null,
          pdfFilename,
          resolvedBudget,
          resolvedUnitCost,
          members || projectMembersSummary
        ],
        (err, result) => {
          if (err) {
            if (err.code === 'ER_DUP_ENTRY') {
              return res.status(409).json({ error: 'Project No. already exists.' });
            }
            return res.status(500).json({ error: err.message });
          }

          const projectId = result.insertId;
          const projectForSync = {
            id: projectId,
            project_docno: finalProjectDocno,
            business_entity_id: resolvedBusinessEntityId,
            company_id: resolvedCompanyId,
            company_no: resolvedCompanyNo,
            company_name: resolvedCompanyName,
            project_name,
            client_name: resolvedCompanyName,
            description,
            transaction_id: transaction_id || null,
            budget: resolvedBudget,
            downpayment: resolvedDownpayment,
            start_date,
            end_date,
            planned_start_date: resolvedPlannedStart,
            planned_end_date: resolvedPlannedEnd
          };

          ensureCompanyRegistryForProject(projectForSync, (registryErr) => {
            if (registryErr) {
              console.error('Company registry sync warning:', registryErr);
            }

            const respond = (taskErr, created) => {
              if (taskErr) {
                console.error('Default task creation failed:', taskErr);
              }
              logAction(req, 'CREATE_PROJECT', `Project Doc No: ${finalProjectDocno} | Company ID: ${resolvedCompanyId} | Company No: ${resolvedCompanyNo} | Company Name: ${resolvedCompanyName}`);
              res.json({
                id: projectId,
                project_docno: finalProjectDocno || null,
                receivableSynced: false,
                defaultTasksCreated: !taskErr && !!created
              });
            };

            const finalizeProjectSave = async () => {
              if (transaction_id) {
                try {
                  await syncTransactionProjectLink(transaction_id, projectId);
                } catch (linkErr) {
                  console.error('Project transaction link warning:', linkErr);
                }
              }

              if (createDefaultTask) {
                ensureDefaultProjectTasks(projectId, start_date, end_date, respond);
              } else {
                respond(null, false);
              }
            };

            finalizeProjectSave().catch((finalizeErr) => {
              console.error('Project save finalization error:', finalizeErr);
              res.status(500).json({ error: finalizeErr.message || 'Unable to finalize project save.' });
            });
          });
        }
      );
    };

    generateNextProjectDocno((docErr, nextProjectDocno) => {
      if (docErr) return res.status(500).json({ error: docErr.message });
      insertProject(nextProjectDocno);
    }, resolvedBusinessEntityId);
  });
});

app.put('/api/projects/:id', protectAdmin, upload.single('pdf_file'), (req, res) => {
  const {
    project_name,
    business_entity_id,
    transaction_id,
    source_docno,
    company_id,
    company_no,
    company_name,
    client_name,
    description,
    checkno,
    pono,
    downpayment,
    qty,
    project_members,
    member_role,
    member_phone,
    project_members_2,
    member_role_2,
    member_phone_2,
    project_members_3,
    member_role_3,
    member_phone_3,
    start_date,
    end_date,
    planned_start_date,
    planned_end_date,
    actual_start_date,
    actual_end_date,
    status_reason,
    paused_at,
    cancelled_at,
    project_manager,
    budget,
    unit_cost,
    members,
    status,
    priority,
    remove_pdf,
    createDefaultTask
  } = req.body;
  const incomingPdfFilename = req.file ? req.file.filename : String(req.body.pdfFilename || '').trim() || null;
  const normalizedMemberPhone = normalizePhone(member_phone);
  const normalizedMemberPhone2 = normalizePhone(member_phone_2);
  const normalizedMemberPhone3 = normalizePhone(member_phone_3);

  if (!project_name || !start_date || !end_date)
    return res.status(400).json({ error: 'Missing required fields' });

  if (normalizedMemberPhone && !isValidPhone(normalizedMemberPhone)) {
    return res.status(400).json({ error: 'Member phone number must be digits only, 7 to 15 digits.' });
  }

  if (normalizedMemberPhone2 && !isValidPhone(normalizedMemberPhone2)) {
    return res.status(400).json({ error: 'Member 2 phone number must be digits only, 7 to 15 digits.' });
  }

  if (normalizedMemberPhone3 && !isValidPhone(normalizedMemberPhone3)) {
    return res.status(400).json({ error: 'Member 3 phone number must be digits only, 7 to 15 digits.' });
  }

  const resolvedPlannedStart = planned_start_date || start_date;
  const resolvedPlannedEnd = planned_end_date || end_date;
  const projectMembersSummary = [
    project_members && member_role && normalizedMemberPhone ? `${project_members} (${member_role}) - ${normalizedMemberPhone}` : '',
    project_members_2 && member_role_2 && normalizedMemberPhone2 ? `${project_members_2} (${member_role_2}) - ${normalizedMemberPhone2}` : '',
    project_members_3 && member_role_3 && normalizedMemberPhone3 ? `${project_members_3} (${member_role_3}) - ${normalizedMemberPhone3}` : ''
  ].filter(Boolean).join(' | ') || null;

    db.query('SELECT project_docno, pdfFilename, budget, downpayment, qty, unit_cost FROM projects WHERE id = ?', [req.params.id], (findErr, rows) => {
    if (findErr) return res.status(500).json({ error: findErr.message });
    if (!rows || !rows.length) return res.status(404).json({ error: 'Project not found' });

    const finalProjectDocno = String(rows[0].project_docno || '').trim();
    const currentPdfFilename = String(rows[0].pdfFilename || '').trim() || null;
    const removePdfRequested = String(remove_pdf || '').trim() === '1';
    if (currentPdfFilename) {
      const currentPdfPath = path.join(UPLOAD_DIR, path.basename(currentPdfFilename));
      if ((removePdfRequested || req.file) && fs.existsSync(currentPdfPath)) {
        try {
          fs.unlinkSync(currentPdfPath);
        } catch (unlinkErr) {
          console.error('Project PDF cleanup warning:', unlinkErr);
        }
      }
    }
    const finalPdfFilename = req.file
      ? req.file.filename
      : (removePdfRequested ? null : (incomingPdfFilename || currentPdfFilename));
    const resolvedBudget = toNumber(budget, rows[0].budget || 0);
    const resolvedDownpayment = toNumber(downpayment, rows[0].downpayment || 0);
    const resolvedQty = toNumber(qty, rows[0].qty || 0);
    const resolvedUnitCost = toNumber(unit_cost, rows[0].unit_cost || 0);
    resolveCompanyRegistryReference({ company_id, company_no, company_name, client_name }, async (companyErr, companyRecord) => {
      if (companyErr) return res.status(400).json({ error: companyErr.message });
      if (!companyRecord) return res.status(400).json({ error: 'Company is required' });

      const resolvedCompanyId = Number(companyRecord.id || 0) || null;
      const resolvedCompanyNo = String(companyRecord.company_no || '').trim() || null;
      const resolvedCompanyName = String(companyRecord.company_name || '').trim() || null;
      let resolvedBusinessEntityId = null;
      try {
        resolvedBusinessEntityId = await resolveBusinessEntityId(business_entity_id);
      } catch (entityErr) {
        return res.status(400).json({ error: entityErr.message || 'Selected operating company was not found.' });
      }

      let duplicateProject = null;
      try {
        duplicateProject = await findProjectDuplicateByIdentity({
          businessEntityId: resolvedBusinessEntityId,
          companyId: resolvedCompanyId,
          projectName: project_name,
          plannedStartDate: resolvedPlannedStart,
          plannedEndDate: resolvedPlannedEnd,
          excludeProjectId: req.params.id
        });
      } catch (dupErr) {
        return res.status(500).json({ error: dupErr.message || 'Unable to check duplicate project.' });
      }
      if (duplicateProject) {
        return sendProjectDuplicateResponse(res, duplicateProject);
      }

      const ensureDocnoAndUpdate = (resolvedProjectDocno) => {
        const projectArInvoiceNo = getProjectInvoiceNumber(resolvedProjectDocno);
        const projectApBillNo = getProjectBillNumber(resolvedProjectDocno);
        db.query(
          `UPDATE projects
           SET project_docno = ?, project_name = ?, business_entity_id = ?, transaction_id = COALESCE(?, transaction_id), company_id = ?, source_docno = COALESCE(?, source_docno), company_no = ?, company_name = ?, client_name = ?,
               project_ar_invoice_no = ?, project_ap_bill_no = ?,
               description = ?, checkno = ?, pono = ?, downpayment = ?,
               project_members = ?, member_role = ?, member_phone = ?,
               project_members_2 = ?, member_role_2 = ?, member_phone_2 = ?,
               project_members_3 = ?, member_role_3 = ?, member_phone_3 = ?,
               start_date = ?, end_date = ?, planned_start_date = ?, planned_end_date = ?,
               actual_start_date = COALESCE(?, actual_start_date), actual_end_date = COALESCE(?, actual_end_date),
               status_reason = COALESCE(?, status_reason), paused_at = COALESCE(?, paused_at), cancelled_at = COALESCE(?, cancelled_at),
               project_manager = ?, pdfFilename = ?, budget = ?, qty = ?, unit_cost = ?, members = ?,
               status = COALESCE(?, status), priority = COALESCE(?, priority),
               is_archived = 0, archived_auto = 0
           WHERE id = ?`,
          [
            resolvedProjectDocno || null,
            project_name,
            resolvedBusinessEntityId,
            transaction_id || null,
            resolvedCompanyId,
            source_docno || null,
            resolvedCompanyNo,
            resolvedCompanyName,
            resolvedCompanyName,
            projectArInvoiceNo,
            projectApBillNo,
            description || null,
            checkno || null,
            pono || null,
            resolvedDownpayment,
            project_members || null,
            member_role || null,
            normalizedMemberPhone || null,
            project_members_2 || null,
            member_role_2 || null,
            normalizedMemberPhone2 || null,
            project_members_3 || null,
            member_role_3 || null,
            normalizedMemberPhone3 || null,
            start_date,
            end_date,
            resolvedPlannedStart,
            resolvedPlannedEnd,
            actual_start_date || null,
            actual_end_date || null,
            status_reason || null,
            paused_at || null,
            cancelled_at || null,
            project_manager || null,
            finalPdfFilename,
            resolvedBudget,
            resolvedQty,
            resolvedUnitCost,
            members || projectMembersSummary,
            status || null,
            priority || null,
            req.params.id
          ],
          (err, result) => {
            if (err) {
              if (err.code === 'ER_DUP_ENTRY') {
                return res.status(409).json({ error: 'Project No. already exists.' });
              }
              return res.status(500).json({ error: err.message });
            }
            if (result.affectedRows === 0) return res.status(404).json({ error: 'Project not found' });
            const projectForSync = {
              id: Number(req.params.id),
              project_docno: resolvedProjectDocno || finalProjectDocno,
              business_entity_id: resolvedBusinessEntityId,
              company_id: resolvedCompanyId,
              company_no: resolvedCompanyNo,
              company_name: resolvedCompanyName,
              project_name,
              client_name: resolvedCompanyName,
              description,
              transaction_id: transaction_id || null,
              budget: resolvedBudget,
              downpayment: resolvedDownpayment,
              start_date,
              end_date,
              planned_start_date: resolvedPlannedStart,
              planned_end_date: resolvedPlannedEnd
            };
            ensureCompanyRegistryForProject(projectForSync, (registryErr) => {
              if (registryErr) {
                console.error('Company registry sync warning:', registryErr);
              }

              const respond = (taskErr, created) => {
                if (taskErr) {
                  console.error('Default task ensure failed:', taskErr);
                }
                logAction(req, 'UPDATE_PROJECT', `Project Doc No: ${resolvedProjectDocno || finalProjectDocno} | Company ID: ${resolvedCompanyId} | Company No: ${resolvedCompanyNo} | Company Name: ${resolvedCompanyName}`);
                res.json({
                  success: true,
                  defaultTasksCreated: !taskErr && !!created,
                  project_docno: resolvedProjectDocno || null,
                  receivableSynced: false
                });
              };

              const finalizeProjectSave = async () => {
                if (transaction_id) {
                  try {
                    await syncTransactionProjectLink(transaction_id, Number(req.params.id));
                  } catch (linkErr) {
                    console.error('Project transaction link warning:', linkErr);
                  }
                }

                if (createDefaultTask) {
                  ensureDefaultProjectTasks(req.params.id, start_date, end_date, respond);
                } else {
                  respond(null, false);
                }
              };

              finalizeProjectSave().catch((finalizeErr) => {
                console.error('Project save finalization error:', finalizeErr);
                res.status(500).json({ error: finalizeErr.message || 'Unable to finalize project save.' });
              });
            });
          }
        );
      };

      if (finalProjectDocno) return ensureDocnoAndUpdate(finalProjectDocno);

      generateNextProjectDocno((docErr, nextProjectDocno) => {
        if (docErr) return res.status(500).json({ error: docErr.message });
        ensureDocnoAndUpdate(nextProjectDocno);
      }, resolvedBusinessEntityId);
    });
  });
});

app.get('/api/projects/:id/pdf', protectAdmin, (req, res) => {
  sendProjectPdf(req, res, req.params.id);
});

app.put('/api/projects/:id/archive', protectAdmin, (req, res) => {
  const projectId = Number(req.params.id || 0);
  if (!projectId) return res.status(400).json({ error: 'Invalid project id' });

  db.query('UPDATE projects SET is_archived = 1, archived_auto = 0 WHERE id = ?', [projectId], (err, result) => {
    if (err) return res.status(500).json({ error: err.message });
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Project not found' });
    logAction(req, 'ARCHIVE_PROJECT', `Archived project ID: ${projectId}`);
    res.json({ success: true });
  });
});

app.put('/api/projects/:id/restore', protectAdmin, (req, res) => {
  const projectId = Number(req.params.id || 0);
  if (!projectId) return res.status(400).json({ error: 'Invalid project id' });

  db.query('UPDATE projects SET is_archived = 0, archived_auto = 0 WHERE id = ?', [projectId], (err, result) => {
    if (err) return res.status(500).json({ error: err.message });
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Project not found' });
    logAction(req, 'RESTORE_PROJECT', `Restored project ID: ${projectId}`);
    res.json({ success: true });
  });
});

app.get('/api/projects/:projectId/tasks', protectAdmin, (req, res) => {
  db.query('SELECT * FROM tasks WHERE project_id = ? ORDER BY start_date ASC',
    [req.params.projectId], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

app.post('/api/tasks', protectAdmin, (req, res) => {
  const { project_id, task_name, start_date, end_date, assigned_to, plan_cost } = req.body;
  if (!project_id || !task_name || !start_date || !end_date)
    return res.status(400).json({ error: 'Missing required fields' });

  const duration = Math.ceil((new Date(end_date) - new Date(start_date)) / (1000 * 60 * 60 * 24));
  db.query(
    'INSERT INTO tasks (project_id, task_name, start_date, end_date, duration, assigned_to, plan_cost) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [project_id, task_name, start_date, end_date, duration, assigned_to || null, plan_cost || 0],
    (err, result) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ id: result.insertId });
    }
  );
});

app.put('/api/projects/:projectId/tasks', protectAdmin, (req, res) => {
  const projectId = Number(req.params.projectId);
  const tasks = Array.isArray(req.body.tasks) ? req.body.tasks : [];

  if (!projectId) {
    return res.status(400).json({ error: 'Invalid project id' });
  }

  db.query('SELECT id FROM projects WHERE id = ?', [projectId], (projectErr, rows) => {
    if (projectErr) return res.status(500).json({ error: projectErr.message });
    if (!rows || !rows.length) return res.status(404).json({ error: 'Project not found' });

    db.getConnection((connErr, connection) => {
      if (connErr) return res.status(500).json({ error: connErr.message });

      const finish = (statusCode, payload) => {
        connection.release();
        return res.status(statusCode).json(payload);
      };

      connection.beginTransaction((txErr) => {
        if (txErr) {
          connection.release();
          return res.status(500).json({ error: txErr.message });
        }

        connection.query('DELETE FROM tasks WHERE project_id = ?', [projectId], (deleteErr) => {
          if (deleteErr) {
            return connection.rollback(() => finish(500, { error: deleteErr.message }));
          }

          const normalizedTasks = tasks.map((task, index) => {
            const taskName = String(task?.task_name || task?.taskName || '').trim();
            const startDate = String(task?.start_date || task?.startDate || '').trim();
            const endDate = String(task?.end_date || task?.endDate || '').trim();
            const assignee = String(task?.assigned_to || task?.assignee || '').trim();
            const status = String(task?.status || 'not_started').trim();
            const progress = Number(task?.progress || 0);
            const planCost = Number(task?.plan_cost || 0);
            const actualCost = Number(task?.actual_cost || 0);
            const safeStart = startDate || null;
            const safeEnd = endDate || null;
            const start = safeStart ? new Date(safeStart) : null;
            const end = safeEnd ? new Date(safeEnd) : null;
            const duration = (start && end && !Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime()))
              ? Math.max(1, Math.round((end - start) / 86400000) + 1)
              : 1;

            return {
              taskName: taskName || `Task ${index + 1}`,
              startDate: safeStart,
              endDate: safeEnd,
              duration,
              assignee: assignee || null,
              status: ['not_started', 'in_progress', 'on_hold', 'completed', 'cancelled'].includes(status) ? status : 'not_started',
              progress: Number.isFinite(progress) ? Math.max(0, Math.min(100, progress)) : 0,
              planCost: Number.isFinite(planCost) ? planCost : 0,
              actualCost: Number.isFinite(actualCost) ? actualCost : 0
            };
          });

          if (!normalizedTasks.length) {
            return connection.commit((commitErr) => {
              if (commitErr) {
                return connection.rollback(() => finish(500, { error: commitErr.message }));
              }
              finish(200, { success: true, totalTasks: 0 });
            });
          }

          let index = 0;
          const insertNext = () => {
            if (index >= normalizedTasks.length) {
              return connection.commit((commitErr) => {
                if (commitErr) {
                  return connection.rollback(() => finish(500, { error: commitErr.message }));
                }
                finish(200, { success: true, totalTasks: normalizedTasks.length });
              });
            }

            const task = normalizedTasks[index++];
            connection.query(
              `INSERT INTO tasks
                (project_id, task_name, start_date, end_date, duration, progress, assigned_to, status, plan_cost, actual_cost)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [
                projectId,
                task.taskName,
                task.startDate,
                task.endDate,
                task.duration,
                task.progress,
                task.assignee,
                task.status,
                task.planCost,
                task.actualCost
              ],
              (insertErr) => {
                if (insertErr) {
                  return connection.rollback(() => finish(500, { error: insertErr.message }));
                }
                insertNext();
              }
            );
          };

          insertNext();
        });
      });
    });
  });
});

app.put('/api/tasks/:taskId', protectAdmin, (req, res) => {
  const { progress, actual_cost, status } = req.body;
  db.query(
    'UPDATE tasks SET progress = ?, actual_cost = ?, status = ? WHERE id = ?',
    [progress || 0, actual_cost || 0, status || 'in_progress', req.params.taskId],
    (err, result) => {
      if (err) return res.status(500).json({ error: err.message });
      if (result.affectedRows === 0) return res.status(404).json({ error: 'Task not found' });
      res.json({ success: true });
    }
  );
});

app.get('/api/projects/:projectId/costs', protectAdmin, (req, res) => {
  db.query('SELECT * FROM project_costs WHERE project_id = ? ORDER BY cost_date DESC',
    [req.params.projectId], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

app.post('/api/project-costs', protectAdmin, (req, res) => {
  const { project_id, task_id, cost_category, plan_amount, actual_amount, cost_date, notes } = req.body;
  if (!project_id || !cost_category || !plan_amount)
    return res.status(400).json({ error: 'Missing required fields' });

  const variance = (actual_amount || 0) - plan_amount;
  db.query(
    'INSERT INTO project_costs (project_id, task_id, cost_category, plan_amount, actual_amount, variance, cost_date, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [project_id, task_id || null, cost_category, plan_amount, actual_amount || 0, variance, cost_date || new Date().toISOString().slice(0, 10), notes || null],
    (err, result) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ id: result.insertId });
    }
  );
});

app.get('/api/projects/:projectId/summary', protectAdmin, (req, res) => {
  db.query(`
    SELECT 
      p.*,
      COUNT(DISTINCT t.id) AS total_tasks,
      SUM(IF(t.status = 'completed', 1, 0)) AS completed_tasks,
      AVG(t.progress) AS avg_progress,
      SUM(t.plan_cost) AS total_plan_cost,
      SUM(t.actual_cost) AS total_actual_cost,
      (SUM(t.actual_cost) - SUM(t.plan_cost)) AS cost_variance
    FROM projects p
    LEFT JOIN tasks t ON p.id = t.project_id
    WHERE p.id = ?
    GROUP BY p.id
  `, [req.params.projectId], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows[0] || {});
  });
});

// ==================== USER MANAGEMENT (ADMIN ONLY) ====================
app.get('/api/admin/users', protectAdminOnly, (req, res) => {
  if (req.session.user.role !== 'admin') return res.status(403).json({ error: 'Access denied' });
  db.query('SELECT id, username, fullname, email, role, active, last_login, created_at FROM users', (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

app.post('/api/admin/users', protectAdminOnly, async (req, res) => {
  if (req.session.user.role !== 'admin') return res.status(403).json({ error: 'Access denied' });
  const { name, username, email, password, role, active } = req.body;
  const normalizedUsername = String(username || '').trim();
  const normalizedEmail = String(email || '').trim().toLowerCase();
  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const nextActive = Number(active);
  const isActive = Number.isNaN(nextActive) ? 1 : (nextActive ? 1 : 0);
  
  if (!name || !normalizedUsername || !normalizedEmail || !password) {
    return res.status(400).json({ error: 'Lahat ng fields ay kailangan.' });
  }
  if (String(password).length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  }
  if (!emailPattern.test(normalizedEmail)) {
    return res.status(400).json({ error: 'Invalid email format.' });
  }

  try {
    const duplicateRows = await queryAsync(
      'SELECT id, username, email FROM users WHERE username = ? OR email = ? LIMIT 1',
      [normalizedUsername, normalizedEmail]
    );
    if (duplicateRows.length) {
      const duplicate = duplicateRows[0];
      if (normalizeUniqueTextForCompare(duplicate.username) === normalizeUniqueTextForCompare(normalizedUsername)) {
        return res.status(409).json({ error: 'Username already exists.', field: 'username' });
      }
      return res.status(409).json({ error: 'Email already exists.', field: 'email' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    db.query(
      'INSERT INTO users (fullname, username, email, password, role, active) VALUES (?, ?, ?, ?, ?, ?)',
      [name, normalizedUsername, normalizedEmail, hashedPassword, role || 'user', isActive],
      (err) => {
        if (err) {
          if (err.code === 'ER_DUP_ENTRY') {
            const sqlMessage = String(err.sqlMessage || err.message || '').toLowerCase();
            if (sqlMessage.includes('email')) {
              return res.status(409).json({ error: 'Email already exists.', field: 'email' });
            }
            return res.status(409).json({ error: 'Username already exists.', field: 'username' });
          }
          console.error('Insert User Error:', err);
          return res.status(500).json({ error: 'Username o Email ay ginagamit na.' });
        }
        logAction(req, 'CREATE_USER', `Created new account: ${normalizedUsername} (${role})`);
        res.json({ success: true });
      }
    );
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.patch('/api/admin/users/:id', protectAdminOnly, async (req, res) => {
  if (req.session.user.role !== 'admin') return res.status(403).json({ error: 'Access denied' });

  const userId = Number(req.params.id || 0);
  const { name, username, email, password, role, active } = req.body;
  const normalizedUsername = String(username || '').trim();
  const normalizedEmail = String(email || '').trim().toLowerCase();
  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const safeRole = ['admin', 'staff', 'user'].includes(String(role || '').trim()) ? String(role || '').trim() : null;
  const nextActive = Number(active);

  if (!userId) {
    return res.status(400).json({ error: 'Invalid user id.' });
  }
  if (!name || !normalizedUsername || !normalizedEmail) {
    return res.status(400).json({ error: 'Lahat ng fields ay kailangan.' });
  }
  if (!emailPattern.test(normalizedEmail)) {
    return res.status(400).json({ error: 'Invalid email format.' });
  }

  try {
    const existing = await queryAsync('SELECT id, role, active FROM users WHERE id = ?', [userId]);
    if (!existing.length) {
      return res.status(404).json({ error: 'User not found.' });
    }

    const target = existing[0];
    const isSelf = Number(req.session.user.id || 0) === userId;
    const updateRole = isSelf ? target.role : (safeRole || target.role);
    const updateActive = isSelf ? Number(target.active || 1) : (Number.isNaN(nextActive) ? Number(target.active || 1) : (nextActive ? 1 : 0));

    if (!isSelf && updateRole === 'admin' && updateActive === 0) {
      const adminCountRows = await queryAsync(
        'SELECT COUNT(*) AS total FROM users WHERE role = ? AND active = 1 AND id <> ?',
        ['admin', userId]
      );
      const activeAdminCount = Number(adminCountRows[0]?.total || 0);
      if (activeAdminCount === 0) {
        return res.status(400).json({ error: 'Hindi puwedeng i-disable ang huling active admin.' });
      }
    }

    const duplicateRows = await queryAsync(
      'SELECT id, username, email FROM users WHERE (username = ? OR email = ?) AND id <> ? LIMIT 1',
      [normalizedUsername, normalizedEmail, userId]
    );
    if (duplicateRows.length) {
      const duplicate = duplicateRows[0];
      if (normalizeUniqueTextForCompare(duplicate.username) === normalizeUniqueTextForCompare(normalizedUsername)) {
        return res.status(409).json({ error: 'Username already exists.', field: 'username' });
      }
      return res.status(409).json({ error: 'Email already exists.', field: 'email' });
    }

    const fields = ['fullname = ?', 'username = ?', 'email = ?', 'role = ?', 'active = ?'];
    const values = [name, normalizedUsername, normalizedEmail, updateRole, updateActive];

    if (String(password || '').trim()) {
      const hashedPassword = await bcrypt.hash(String(password).trim(), 10);
      fields.push('password = ?');
      values.push(hashedPassword);
    }

    values.push(userId);

    db.query(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`, values, (err) => {
      if (err) {
        if (err.code === 'ER_DUP_ENTRY') {
          const sqlMessage = String(err.sqlMessage || err.message || '').toLowerCase();
          if (sqlMessage.includes('email')) {
            return res.status(409).json({ error: 'Email already exists.', field: 'email' });
          }
          return res.status(409).json({ error: 'Username already exists.', field: 'username' });
        }
        console.error('Update User Error:', err);
        return res.status(500).json({ error: 'Hindi ma-update ang user.' });
      }
      logAction(req, 'UPDATE_USER', `Updated account: ${normalizedUsername} (${updateRole})`);
      res.json({ success: true });
    });
  } catch (e) {
    console.error('Update User Route Error:', e);
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/admin/logs', protectAdminOnly, (req, res) => {
  if (req.session.user.role !== 'admin') {
    return res.status(403).json({ error: 'Access denied' });
  }

  db.query(`
    SELECT
      l.id,
      l.module,
      l.action,
      l.details,
      l.ip_address,
      l.created_at,
      u.fullname,
      u.username
    FROM system_logs l
    LEFT JOIN users u ON u.id = l.user_id
    ORDER BY l.created_at DESC, l.id DESC
    LIMIT 200
  `, (err, rows) => {
    if (err) {
      console.error('Load logs error:', err);
      return res.status(500).json({ error: err.message });
    }
    res.json(rows);
  });
});

app.get('/api/admin/logs/export', protectAdminOnly, async (req, res) => {
  if (req.session.user.role !== 'admin') {
    return res.status(403).json({ error: 'Access denied' });
  }

  try {
    const format = String(req.query.format || 'csv').toLowerCase();
    const search = String(req.query.q || '').trim().toLowerCase();
    const action = String(req.query.action || '').trim();
    const rows = await queryAsync(`
      SELECT
        l.module,
        COALESCE(u.fullname, u.username, 'System') AS user_name,
        l.action,
        l.details,
        DATE_FORMAT(l.created_at, '%Y-%m-%d %H:%i:%s') AS created_at,
        COALESCE(l.ip_address, '') AS ip_address
      FROM system_logs l
      LEFT JOIN users u ON u.id = l.user_id
      ORDER BY l.created_at DESC, l.id DESC
      LIMIT 500
    `);

    const filtered = rows.filter((row) => {
      const haystack = [
        row.module || '',
        row.user_name || '',
        row.action || '',
        row.details || '',
        row.ip_address || ''
      ].join(' ').toLowerCase();
      const tokens = search ? search.split(/\s+/).filter(Boolean) : [];
      const searchMatch = !tokens.length || tokens.every((token) => haystack.includes(token));
      const actionMatch = !action || String(row.action || '') === action;
      return searchMatch && actionMatch;
    });

    const filenameBase = `system-logs-${new Date().toISOString().slice(0, 10)}`;
    logAction(req, 'EXPORT_SYSTEM_LOGS', `Exported system logs as ${format.toUpperCase()} | Filters: ${search || 'none'} | Action: ${action || 'all'}`, 'audit');

    const exportRows = filtered.map((row) => ({
      created_at: row.created_at,
      module: row.module || '',
      user_name: row.user_name,
      action: row.action,
      details: row.details,
      ip_address: row.ip_address || ''
    }));
    const headers = ['created_at', 'module', 'user_name', 'action', 'details', 'ip_address'];

    if (format === 'pdf') {
      return sendPdfTableResponse(
        res,
        `${filenameBase}.pdf`,
        'System Logs',
        headers,
        exportRows,
        `Generated at ${new Date().toLocaleString('en-PH')}`
      );
    }

    if (format === 'xls' || format === 'xlsx' || format === 'excel') {
      return sendHtmlSpreadsheetResponse(
        res,
        `${filenameBase}.xls`,
        'System Logs',
        headers,
        exportRows
      );
    }

    return sendCsvResponse(
      res,
      `${filenameBase}.csv`,
      headers,
      exportRows
    );
  } catch (err) {
    console.error('Logs export error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/transactions/export', protectAdmin, (req, res) => {
  const archived = String(req.query.archived || '0') === '1';
  const format = String(req.query.format || 'csv').toLowerCase();
  const search = String(req.query.q || '').trim().toLowerCase();
  const whereClause = archived ? 'WHERE archived = 1' : 'WHERE archived = 0';

  db.query(`
    SELECT docno, type, client, description, amount, downpayment, checkno, pono,
           DATE_FORMAT(date, '%Y-%m-%d') AS date,
           DATE_FORMAT(project_start_date, '%Y-%m-%d') AS project_start_date,
           DATE_FORMAT(project_end_date, '%Y-%m-%d') AS project_end_date,
           status
    FROM transactions
    ${whereClause}
    ORDER BY id DESC
  `, (err, rows) => {
    if (err) {
      console.error('Transactions export error:', err);
      return res.status(500).json({ error: err.message });
    }

    const filtered = rows.filter((row) => {
      const haystack = [
        row.docno || '',
        row.type || '',
        row.client || '',
        row.description || '',
        row.checkno || '',
        row.pono || '',
        row.status || '',
        row.date || '',
        row.project_start_date || '',
        row.project_end_date || ''
      ].join(' ').toLowerCase();
      const tokens = search ? search.split(/\s+/).filter(Boolean) : [];
      return !tokens.length || tokens.every((token) => haystack.includes(token));
    });

    const filenameBase = `${archived ? 'archived-records' : 'transactions'}-${new Date().toISOString().slice(0, 10)}`;
    logAction(req, 'EXPORT_TRANSACTIONS', `Exported ${archived ? 'archived records' : 'transactions'} as ${format.toUpperCase()} | Search: ${search || 'none'}`, 'audit');

    const headers = ['docno', 'type', 'client', 'description', 'amount', 'downpayment', 'checkno', 'pono', 'date', 'project_start_date', 'project_end_date', 'status'];
    if (format === 'pdf') {
      return sendPdfTableResponse(
        res,
        `${filenameBase}.pdf`,
        archived ? 'Archived Records' : 'Transactions',
        headers,
        filtered,
        `Generated at ${new Date().toLocaleString('en-PH')}`
      );
    }

    if (format === 'xls' || format === 'xlsx' || format === 'excel') {
      return sendHtmlSpreadsheetResponse(
        res,
        `${filenameBase}.xls`,
        archived ? 'Archived Records' : 'Transactions',
        headers,
        filtered
      );
    }

    sendCsvResponse(
      res,
      `${filenameBase}.csv`,
      headers,
      filtered
    );
  });
});

app.patch('/api/admin/users/:id/toggle', protectAdminOnly, (req, res) => {
  if (req.session.user.role !== 'admin') return res.status(403).json({ error: 'Access denied' });

  const userId = Number(req.params.id);
  if (!Number.isInteger(userId) || userId <= 0) {
    return res.status(400).json({ error: 'Invalid user ID.' });
  }
  if (userId === Number(req.session.user.id || 0)) {
    return res.status(400).json({ error: 'Hindi puwedeng baguhin ang sarili mong account status.' });
  }

  db.query('SELECT id, username, role, active FROM users WHERE id = ?', [userId], (findErr, rows) => {
    if (findErr) return res.status(500).json({ error: findErr.message });
    if (!rows.length) return res.status(404).json({ error: 'User not found.' });

    const target = rows[0];
    const applyToggle = () => {
      db.query('UPDATE users SET active = NOT active WHERE id = ?', [userId], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        logAction(req, 'TOGGLE_USER_STATUS', `Toggled account status: ${target.username} (${target.role})`);
        res.json({ success: true });
      });
    };

    if (target.role !== 'admin' || Number(target.active || 0) === 0) {
      applyToggle();
      return;
    }

    db.query(
      'SELECT COUNT(*) AS total FROM users WHERE role = ? AND active = 1 AND id <> ?',
      ['admin', userId],
      (countErr, countRows) => {
        if (countErr) return res.status(500).json({ error: countErr.message });
        if ((countRows[0]?.total || 0) < 1) {
          return res.status(400).json({ error: 'Hindi puwedeng i-disable ang huling active admin.' });
        }
        applyToggle();
      }
    );
  });
});

app.delete('/api/admin/users/:id', protectAdminOnly, (req, res) => {
  if (req.session.user.role !== 'admin') return res.status(403).json({ error: 'Access denied' });

  const userId = Number(req.params.id);
  if (!Number.isInteger(userId) || userId <= 0) {
    return res.status(400).json({ error: 'Invalid user ID.' });
  }
  if (userId === Number(req.session.user.id || 0)) {
    return res.status(400).json({ error: 'Hindi puwedeng i-delete ang sarili mong account.' });
  }

  db.query('SELECT id, username, role FROM users WHERE id = ?', [userId], (findErr, rows) => {
    if (findErr) return res.status(500).json({ error: findErr.message });
    if (!rows.length) return res.status(404).json({ error: 'User not found.' });

    const target = rows[0];
    const deleteTarget = () => {
      db.query('DELETE FROM users WHERE id = ?', [userId], (deleteErr, result) => {
        if (deleteErr) return res.status(500).json({ error: deleteErr.message });
        if (result.affectedRows === 0) return res.status(404).json({ error: 'User not found.' });

        logAction(req, 'DELETE_USER', `Deleted account: ${target.username} (${target.role})`);
        res.json({ success: true });
      });
    };

    if (target.role !== 'admin') {
      deleteTarget();
      return;
    }

    db.query(
      'SELECT COUNT(*) AS total FROM users WHERE role = ? AND id <> ?',
      ['admin', userId],
      (countErr, countRows) => {
        if (countErr) return res.status(500).json({ error: countErr.message });
        if ((countRows[0]?.total || 0) < 1) {
          return res.status(400).json({ error: 'Hindi puwedeng i-delete ang huling admin account.' });
        }
        deleteTarget();
      }
    );
  });
});

app.patch('/api/admin/users/:id/reset-password', protectAdminOnly, async (req, res) => {
  if (req.session.user.role !== 'admin') return res.status(403).json({ error: 'Access denied' });

  const userId = Number(req.params.id);
  const password = String(req.body?.password || '').trim();

  if (!Number.isInteger(userId) || userId <= 0) {
    return res.status(400).json({ error: 'Invalid user ID.' });
  }

  if (userId === Number(req.session.user.id || 0)) {
    return res.status(400).json({ error: 'Hindi puwedeng i-reset ang sarili mong password mula dito.' });
  }

  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  }

  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    db.query('SELECT username, role FROM users WHERE id = ?', [userId], (findErr, rows) => {
      if (findErr) return res.status(500).json({ error: findErr.message });
      if (!rows.length) return res.status(404).json({ error: 'User not found.' });

      const target = rows[0];
      db.query('UPDATE users SET password = ? WHERE id = ?', [hashedPassword, userId], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        logAction(req, 'RESET_USER_PASSWORD', `Reset password for ${target.username} (${target.role})`);
        res.json({ success: true });
      });
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// ==================== START ====================
app.listen(PORT, () => {
  console.log(`\nâœ… Server running at http://localhost:${PORT}`);
  console.log(`   â†’ Login Page  : http://localhost:${PORT}/`);
  console.log(`   â†’ Admin Panel : http://localhost:${PORT}/admin`);
  console.log(`   â†’ Public View : http://localhost:${PORT}/status\n`);
});
