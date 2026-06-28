﻿// server.js - Updated with Session, CRUD, Double Login Fix, and Connection Pool
// Load .env first so DATABASE_URL etc. are available no matter how the app is started (node or
// PM2) — the DB pool is built from process.env when src/database is required below.
require('dotenv').config();
const express = require('express');
const path    = require('path');

// ── Global safety net ─────────────────────────────────────────────────────────────────────
// Without these, ONE stray unhandled promise rejection or exception anywhere in an async route
// can take down the whole server (and it stays down with no auto-restart). We log loudly so the
// issue is still visible (PM2 captures these to its log files).
process.on('unhandledRejection', (reason) => {
  // A rejected promise in a route — often after a response was already sent — should NOT crash
  // the app. Log it and keep serving everyone else.
  console.error('[unhandledRejection]', reason && reason.stack ? reason.stack : reason);
});
process.on('uncaughtException', (err) => {
  // After an uncaught exception the process state is unknown, so exit and let the process
  // manager (PM2) start a clean instance. Without PM2 this behaves like before (the process
  // stops) — but now it's logged, and under PM2 it auto-recovers in ~1s.
  console.error('[uncaughtException]', err && err.stack ? err.stack : err);
  process.exit(1);
});
// ───────────────────────────────────────────────────────────────────────────────────────────
// Database layer (pool + queryAsync + pg error helpers) lives in src/database now.
const {
  db,
  queryAsync,
  isPostgresUniqueViolation,
  isPostgresUndefinedTable,
  isPostgresUndefinedColumn,
  isPostgresDuplicateObject,
} = require('./src/database');
const {
  normalizePhone,
  normalizeTin,
  formatTin,
  isValidPhone,
  isValidCompanyRegistryPhone,
  isValidEmail,
} = require('./src/shared/validation');
const { formatPdfMoney, formatPdfDate } = require('./src/shared/format');
const {
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
} = require('./src/middleware/auth');
const { createPostgresSessionStore } = require('./lib/db/postgres-session-store');
const session = require('express-session');
const bcrypt  = require('bcrypt');
const multer  = require('multer');
const fs      = require('fs');
const crypto  = require('crypto');
const os      = require('os');
const { execFileSync } = require('child_process');
const dns = require('dns');
const nodemailer = require('nodemailer');
const zlib = require('zlib');
const {
  buildSessionOptions,
  getRolePermissions,
  isCsrfProtectedMethod,
  isCsrfExemptPath,
  isPublicApiPath,
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

if (typeof dns.setDefaultResultOrder === 'function') {
  dns.setDefaultResultOrder('ipv4first');
}

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
const sessionCookieSecure = process.env.SESSION_COOKIE_SECURE === undefined
  ? isProduction
  : String(process.env.SESSION_COOKIE_SECURE || '').toLowerCase() === 'true';
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
const SMTP_HOST = process.env.SMTP_HOST || '';
const SMTP_PORT = Number(process.env.SMTP_PORT || 587);
const SMTP_SECURE = String(process.env.SMTP_SECURE || 'false').toLowerCase() === 'true';
const SMTP_USER = process.env.SMTP_USER || '';
const SMTP_PASS = process.env.SMTP_PASS || '';
const SMTP_FROM = process.env.SMTP_FROM || SMTP_USER || 'no-reply@kinaadman.local';
const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const RESEND_FROM = process.env.RESEND_FROM || SMTP_FROM;
const allowPublicRegistration = String(process.env.ALLOW_PUBLIC_REGISTRATION || 'true').toLowerCase() !== 'false';

const hasEmailConfig = Boolean(SMTP_HOST && SMTP_USER && SMTP_PASS);
const hasAnyEmailConfig = Boolean(RESEND_API_KEY || hasEmailConfig);
const forceSmtpIpv4 = String(process.env.SMTP_FORCE_IPV4 || 'true').toLowerCase() !== 'false';
let cachedSmtpIpv4Host = '';
const APPROVAL_NOTIFY_EMAILS = process.env.APPROVAL_NOTIFY_EMAILS || process.env.ADMIN_EMAIL || '';

async function resolveSmtpHost() {
  if (!forceSmtpIpv4 || !SMTP_HOST) return SMTP_HOST;
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(SMTP_HOST)) return SMTP_HOST;
  if (cachedSmtpIpv4Host) return cachedSmtpIpv4Host;

  try {
    const addresses = await dns.promises.resolve4(SMTP_HOST);
    cachedSmtpIpv4Host = addresses[0] || SMTP_HOST;
    return cachedSmtpIpv4Host;
  } catch (err) {
    console.warn(`SMTP IPv4 lookup failed for ${SMTP_HOST}; using hostname fallback.`, err?.code || err?.message || err);
    return SMTP_HOST;
  }
}

async function createSmtpTransporter() {
  if (!hasEmailConfig) return null;
  const host = await resolveSmtpHost();
  return nodemailer.createTransport({
    host,
    port: SMTP_PORT,
    secure: SMTP_SECURE,
    family: 4,
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 20000,
    auth: {
      user: SMTP_USER,
      pass: SMTP_PASS
    },
    tls: host !== SMTP_HOST ? { servername: SMTP_HOST } : undefined
  });
}

function normalizeEmailRecipients(value) {
  if (Array.isArray(value)) {
    return value
      .flatMap((entry) => normalizeEmailRecipients(entry))
      .filter(Boolean);
  }
  return String(value || '')
    .split(/[,;]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

async function sendResendEmail(mailOptions) {
  if (!RESEND_API_KEY) return { sent: false, reason: 'resend-not-configured' };

  const recipients = normalizeEmailRecipients(mailOptions?.to);
  if (!recipients.length) return { sent: false, reason: 'no-recipient' };
  const attachments = await normalizeResendAttachments(mailOptions?.attachments);

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: mailOptions?.from || RESEND_FROM,
      to: recipients,
      subject: mailOptions?.subject || 'ERP Notification',
      html: mailOptions?.html || String(mailOptions?.text || ''),
      text: mailOptions?.text,
      ...(attachments.length ? { attachments } : {})
    })
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = payload?.message || payload?.error?.message || `Resend API failed with ${response.status}`;
    throw new Error(message);
  }
  return { sent: true, provider: 'resend', id: payload?.id || '' };
}

function parseEmailList(value) {
  return String(value || '')
    .split(/[,;\s]+/)
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(entry));
}

function dedupeEmailList(emails = []) {
  return [...new Set((Array.isArray(emails) ? emails : []).filter(Boolean))];
}

async function normalizeResendAttachments(attachments = []) {
  const source = Array.isArray(attachments) ? attachments : [];
  const normalized = [];

  for (const attachment of source) {
    const filename = String(attachment?.filename || '').trim() || 'attachment.pdf';
    try {
      let contentBuffer = null;
      if (Buffer.isBuffer(attachment?.content)) {
        contentBuffer = attachment.content;
      } else if (typeof attachment?.content === 'string' && attachment.content) {
        contentBuffer = Buffer.from(attachment.content);
      } else if (attachment?.path) {
        contentBuffer = await fs.promises.readFile(attachment.path);
      }

      if (!contentBuffer) continue;
      normalized.push({
        filename,
        content: contentBuffer.toString('base64'),
        content_type: attachment?.contentType || attachment?.content_type || 'application/pdf'
      });
    } catch (err) {
      console.error(`Email attachment read error (${filename}):`, err);
    }
  }

  return normalized;
}

function getRequestBaseUrl(req) {
  const host = String(req?.get?.('host') || req?.headers?.host || '').trim();
  if (!host) return '';
  const forwardedProto = String(req?.get?.('x-forwarded-proto') || '').split(',')[0].trim();
  const protocol = forwardedProto || req?.protocol || 'http';
  return `${protocol}://${host}`.replace(/\/+$/, '');
}

function buildAppUrl(pathname = '/', baseOverride = '') {
  const rawPath = String(pathname || '/').trim() || '/';
  if (/^https?:\/\//i.test(rawPath)) return rawPath;
  const configuredBase = String(APP_BASE_URL || '').trim();
  const safeOverride = String(baseOverride || '').trim();
  const shouldPreferOverride = safeOverride && (
    !configuredBase
    || (isProduction && /\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?(?:\/|$)/i.test(configuredBase))
  );
  const base = (shouldPreferOverride ? safeOverride : configuredBase || `http://localhost:${PORT}`).replace(/\/+$/, '');
  const pathPart = rawPath.startsWith('/') ? rawPath : `/${rawPath}`;
  return `${base}${pathPart}`;
}

async function getApprovalNotificationRecipients() {
  const configuredRecipients = parseEmailList(APPROVAL_NOTIFY_EMAILS);
  const adminRecipients = [];

  try {
    const rows = await queryAsync(`
      SELECT email
      FROM users
      WHERE LOWER(TRIM(COALESCE(role, ''))) IN ('super_admin', 'admin')
        AND LOWER(TRIM(CAST(active AS TEXT))) IN ('true', '1', 'yes', 't')
        AND email IS NOT NULL
        AND TRIM(email) <> ''
      ORDER BY CASE LOWER(TRIM(COALESCE(role, ''))) WHEN 'super_admin' THEN 0 ELSE 1 END, id ASC
    `);
    adminRecipients.push(...parseEmailList((rows || []).map((row) => row.email).join(',')));
  } catch (err) {
    console.error('Approval recipient lookup error:', err);
  }

  return dedupeEmailList([...configuredRecipients, ...adminRecipients]);
}

function toSafeAttachmentFilename(value, fallback = 'approval-summary') {
  const text = String(value || fallback)
    .trim()
    .replace(/[^a-z0-9._-]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 90);
  return text || fallback;
}

function buildApprovalSummaryPdfAttachment({ title = 'Approval Request', recordNo = '', submittedBy = '', details = [] } = {}) {
  const cleanDetails = (details || [])
    .map(([label, value]) => [String(label || '').trim(), String(value || '').trim()])
    .filter(([label, value]) => label && value);
  const detailRows = cleanDetails.map(([label, value]) => ({
    Field: label,
    Value: value
  }));
  const leftRows = [
    ['Request Type', title],
    ['Reference No.', recordNo],
    ['Submitted By', submittedBy],
    ['Submitted At', formatPdfDate(new Date())],
    ['Status', 'Pending Approval']
  ];
  const rightRows = cleanDetails.slice(0, 7);

  return {
    filename: `${toSafeAttachmentFilename(`${title}-${recordNo || Date.now()}`)}.pdf`,
    content: buildProfessionalSummaryPdf({
      title: 'APPROVAL REQUEST',
      documentNo: recordNo || 'Pending',
      status: 'pending',
      leftTitle: 'REQUEST DETAILS',
      leftRows,
      rightTitle: 'RECORD SUMMARY',
      rightRows,
      tableTitle: detailRows.length ? 'APPROVAL DATA' : '',
      tableHeaders: detailRows.length ? ['Field', 'Value'] : [],
      tableRows: detailRows,
      notes: `Please review and approve/reject this ${title} in the ERP approval center.`,
      totalLabel: '',
      totalValue: null
    }),
    contentType: 'application/pdf'
  };
}

async function sendSystemEmail(mailOptions) {
  if (RESEND_API_KEY) {
    try {
      const info = await sendResendEmail(mailOptions);
      console.log(`Email sent via Resend: ${mailOptions?.subject || 'No subject'} -> ${mailOptions?.to || 'No recipient'} (${info.id || 'no-message-id'})`);
      return { sent: true };
    } catch (err) {
      console.error('Resend email error:', err);
      return { sent: false, reason: err.message || 'resend-send-failed' };
    }
  }

  if (!hasEmailConfig) {
    console.warn(`SMTP is not configured. Email not sent: ${mailOptions?.subject || 'No subject'}`);
    return { sent: false, reason: 'smtp-not-configured' };
  }

  try {
    const transporter = await createSmtpTransporter();
    const info = await transporter.sendMail(mailOptions);
    console.log(`Email sent: ${mailOptions?.subject || 'No subject'} -> ${mailOptions?.to || 'No recipient'} (${info.messageId || 'no-message-id'})`);
    return { sent: true };
  } catch (err) {
    console.error('Email send error:', err);
    return { sent: false, reason: err.message || 'send-failed' };
  }
}

async function notifyApprovalRequest(req, options = {}) {
  const recipients = await getApprovalNotificationRecipients();
  const recordNo = String(options.recordNo || '').trim();
  const title = String(options.title || 'Approval Request').trim();
  const submittedBy = String(options.submittedBy || getApprovalActorLabel(req)).trim();
  const reviewUrl = buildAppUrl(options.reviewPath || '/admin');
  const detailEntries = Object.entries(options.details || {})
    .filter(([, value]) => value !== undefined && value !== null && String(value).trim() !== '');
  const detailRows = Object.entries(options.details || {})
    .filter(([, value]) => value !== undefined && value !== null && String(value).trim() !== '')
    .map(([label, value]) => `
      <tr>
        <td style="padding:6px 10px;border:1px solid #d9e2ec;font-weight:600;">${htmlEscape(label)}</td>
        <td style="padding:6px 10px;border:1px solid #d9e2ec;">${htmlEscape(value)}</td>
      </tr>
    `)
    .join('');

  if (!recipients.length) {
    console.warn(`No admin/super admin approval email recipient configured for ${title}${recordNo ? ` ${recordNo}` : ''}.`);
    return { sent: false, reason: 'no-recipients' };
  }

  const providedAttachments = Array.isArray(options.attachments) ? options.attachments.filter(Boolean) : [];
  const attachments = providedAttachments.length
    ? providedAttachments
    : [buildApprovalSummaryPdfAttachment({
      title,
      recordNo,
      submittedBy,
      details: detailEntries
    })];

  return sendSystemEmail({
    from: `Kinaadman ERP <${SMTP_FROM}>`,
    to: recipients.join(','),
    subject: `Approval needed: ${title}${recordNo ? ` ${recordNo}` : ''}`,
    attachments,
    text: [
      `Approval needed: ${title}${recordNo ? ` ${recordNo}` : ''}`,
      `Submitted by: ${submittedBy}`,
      `Review link: ${reviewUrl}`
    ].join('\n'),
    html: `
      <div style="font-family:Arial,sans-serif;color:#1f2937;line-height:1.5;">
        <h2 style="margin:0 0 12px;">Approval Needed</h2>
        <p style="margin:0 0 12px;">May bagong request na kailangan i-review sa Kinaadman ERP.</p>
        <table style="border-collapse:collapse;margin:12px 0;">
          <tr>
            <td style="padding:6px 10px;border:1px solid #d9e2ec;font-weight:600;">Type</td>
            <td style="padding:6px 10px;border:1px solid #d9e2ec;">${htmlEscape(title)}</td>
          </tr>
          ${recordNo ? `
          <tr>
            <td style="padding:6px 10px;border:1px solid #d9e2ec;font-weight:600;">Reference No.</td>
            <td style="padding:6px 10px;border:1px solid #d9e2ec;">${htmlEscape(recordNo)}</td>
          </tr>` : ''}
          <tr>
            <td style="padding:6px 10px;border:1px solid #d9e2ec;font-weight:600;">Submitted By</td>
            <td style="padding:6px 10px;border:1px solid #d9e2ec;">${htmlEscape(submittedBy)}</td>
          </tr>
          ${detailRows}
        </table>
        <p style="margin:16px 0;">
          <a href="${htmlEscape(reviewUrl)}" style="background:#14532d;color:#ffffff;text-decoration:none;padding:10px 14px;border-radius:6px;display:inline-block;">Review in ERP</a>
        </p>
        <p style="font-size:12px;color:#6b7280;margin-top:16px;">For security, approval/rejection must be completed after logging in to the system.</p>
      </div>
    `
  });
}

async function notifyUserAccountDecision(userRow = {}, decision = 'approved', role = 'user', options = {}) {
  const email = String(userRow.email || '').trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { sent: false, reason: 'no-user-email' };
  }

  const approved = String(decision || '').toLowerCase() === 'approved';
  const loginUrl = buildAppUrl('/', options.baseUrl || '');
  const name = String(userRow.fullname || userRow.username || 'User').trim();
  const decidedBy = String(options.decidedBy || options.approvedBy || '').trim();
  const decisionLine = decidedBy
    ? `${approved ? 'Approved' : 'Reviewed'} by: ${decidedBy}`
    : '';

  return sendSystemEmail({
    from: `Kinaadman ERP <${SMTP_FROM}>`,
    to: email,
    subject: approved ? 'Your Kinaadman ERP account is approved' : 'Kinaadman ERP account request update',
    text: approved
      ? [`Hello ${name}, your account has been approved.`, decisionLine, `You can now sign in at ${loginUrl}.`].filter(Boolean).join('\n')
      : [`Hello ${name}, your account registration was not approved.`, decisionLine, 'Please contact the administrator for details.'].filter(Boolean).join('\n'),
    html: `
      <div style="font-family:Arial,sans-serif;color:#1f2937;line-height:1.5;">
        <h2 style="margin:0 0 12px;">${approved ? 'Account Approved' : 'Account Request Update'}</h2>
        <p style="margin:0 0 12px;">Hello ${htmlEscape(name)},</p>
        ${approved
          ? `<p style="margin:0 0 12px;">Your Kinaadman ERP account has been approved as <strong>${htmlEscape(formatAccessRoleLabel(role))}</strong>. You can now sign in using your email and password.</p>
             ${decidedBy ? `<p style="margin:0 0 12px;"><strong>Approved By:</strong> ${htmlEscape(decidedBy)}</p>` : ''}
             <p style="margin:16px 0;"><a href="${htmlEscape(loginUrl)}" style="background:#14532d;color:#ffffff;text-decoration:none;padding:10px 14px;border-radius:6px;display:inline-block;">Sign In</a></p>`
          : `<p style="margin:0 0 12px;">Your registration request was not approved. Please contact the administrator for details.</p>
             ${decidedBy ? `<p style="margin:0 0 12px;"><strong>Reviewed By:</strong> ${htmlEscape(decidedBy)}</p>` : ''}`}
      </div>
    `
  });
}

async function getAuthenticatedUserEmail(req) {
  const user = getAuthenticatedUser(req);
  const directEmail = String(user?.email || '').trim().toLowerCase();
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(directEmail)) return directEmail;

  const userId = Number(user?.id || 0) || 0;
  if (!userId) return '';
  try {
    const rows = await queryAsync('SELECT email FROM users WHERE id = ? LIMIT 1', [userId]);
    const email = String(rows?.[0]?.email || '').trim().toLowerCase();
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : '';
  } catch (err) {
    console.error('Authenticated user email lookup error:', err);
    return '';
  }
}

async function notifyPurchaseRequisitionRequester(req, requisitionId, decision = 'approved', options = {}) {
  const rows = await queryAsync(`
    SELECT
      pr.pr_number,
      pr.request_date,
      pr.needed_by,
      pr.requested_by,
      pr.requested_by_email,
      pr.approved_by,
      pr.approved_at,
      pr.cancelled_by,
      pr.cancelled_at,
      pr.cancel_reason,
      c.company_name,
      p.project_name
    FROM purchase_requisitions pr
    LEFT JOIN company_registry c ON c.id = pr.company_id
    LEFT JOIN projects p ON p.id = pr.project_id
    WHERE pr.id = ?
    LIMIT 1
  `, [requisitionId]);
  const row = rows?.[0] || null;
  if (!row) return { sent: false, reason: 'not-found' };

  let email = String(row.requested_by_email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    const requestedByLookup = String(row.requested_by || '').trim().toLowerCase();
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(requestedByLookup)) {
      email = requestedByLookup;
    } else if (requestedByLookup) {
      try {
        const userRows = await queryAsync(
          'SELECT email FROM users WHERE LOWER(username) = ? OR LOWER(fullname) = ? LIMIT 1',
          [requestedByLookup, requestedByLookup]
        );
        email = String(userRows?.[0]?.email || '').trim().toLowerCase();
      } catch (err) {
        console.error('PR requester email fallback lookup error:', err);
      }
    }
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    console.warn(`No requester email configured for purchase requisition ${row.pr_number || requisitionId}.`);
    return { sent: false, reason: 'no-requester-email' };
  }

  const decisionText = String(decision || '').toLowerCase();
  const rejected = ['rejected', 'needs_revision'].includes(decisionText);
  const cancelled = decisionText === 'cancelled';
  const approved = !cancelled && !rejected;
  const statusText = rejected ? 'Rejected' : approved ? 'Approved' : 'Cancelled';
  const actor = String(options.decidedBy || (approved ? options.approvedBy : options.cancelledBy) || (approved ? row.approved_by : row.cancelled_by) || '').trim();
  const decidedAt = approved ? row.approved_at : row.cancelled_at;
  const reviewUrl = buildAppUrl('/procurement?tab=requisitions');
  const reason = String(options.reason || row.cancel_reason || '').trim();
  const requesterName = String(row.requested_by || 'Requester').trim();

  const detailRows = [
    ['PR No.', row.pr_number],
    ['Status', statusText],
    ['Company', row.company_name],
    ['Project', row.project_name],
    ['Request Date', row.request_date],
    ['Needed By', row.needed_by],
    [approved ? 'Approved By' : rejected ? 'Rejected By' : 'Cancelled By', actor],
    [approved ? 'Approved At' : rejected ? 'Rejected At' : 'Cancelled At', decidedAt],
    (cancelled || rejected) ? ['Reason', reason] : null
  ].filter(Boolean)
    .filter(([, value]) => value !== undefined && value !== null && String(value).trim() !== '')
    .map(([label, value]) => `
      <tr>
        <td style="padding:6px 10px;border:1px solid #d9e2ec;font-weight:600;">${htmlEscape(label)}</td>
        <td style="padding:6px 10px;border:1px solid #d9e2ec;">${htmlEscape(value)}</td>
      </tr>
    `)
    .join('');

  const attachments = [];
  try {
    attachments.push(await buildPurchaseRequisitionEmailAttachment(requisitionId));
  } catch (pdfErr) {
    console.error('PR requester PDF attachment warning:', pdfErr);
  }

  return sendSystemEmail({
    from: `Kinaadman ERP <${SMTP_FROM}>`,
    to: email,
    subject: `Purchase Requisition ${statusText}: ${row.pr_number || requisitionId}`,
    attachments: attachments.length ? attachments : undefined,
    text: [
      `Hello ${requesterName},`,
      `Your purchase requisition ${row.pr_number || requisitionId} has been ${statusText.toLowerCase()}.`,
      cancelled && reason ? `Reason: ${reason}` : '',
      `View: ${reviewUrl}`
    ].filter(Boolean).join('\n'),
    html: `
      <div style="font-family:Arial,sans-serif;color:#1f2937;line-height:1.5;">
        <h2 style="margin:0 0 12px;">Purchase Requisition ${htmlEscape(statusText)}</h2>
        <p style="margin:0 0 12px;">Hello ${htmlEscape(requesterName)}, your purchase requisition has been <strong>${htmlEscape(statusText.toLowerCase())}</strong>.</p>
        <table style="border-collapse:collapse;margin:12px 0;">${detailRows}</table>
        <p style="margin:16px 0;">
          <a href="${htmlEscape(reviewUrl)}" style="background:#14532d;color:#ffffff;text-decoration:none;padding:10px 14px;border-radius:6px;display:inline-block;">View in ERP</a>
        </p>
      </div>
    `
  });
}

async function resolveUserEmailsByText(values = []) {
  const candidates = [...new Set((Array.isArray(values) ? values : [values])
    .map((value) => String(value || '').trim())
    .filter(Boolean))];
  const emails = [];
  for (const candidate of candidates) {
    const normalized = candidate.toLowerCase();
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
      emails.push(normalized);
      continue;
    }
    try {
      const rows = await queryAsync(
        'SELECT email FROM users WHERE LOWER(username) = ? OR LOWER(fullname) = ? LIMIT 1',
        [normalized, normalized]
      );
      const email = String(rows?.[0]?.email || '').trim().toLowerCase();
      if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) emails.push(email);
    } catch (err) {
      console.error('User email lookup error:', err);
    }
  }
  return dedupeEmailList(emails);
}

async function notifyPurchaseOrderRequester(req, poId, decision = 'approved', options = {}) {
  const rows = await queryAsync(`
    SELECT
      po.po_number,
      po.po_date,
      po.delivery_date,
      po.total_amount,
      po.prepared_by,
      po.approved_by,
      po.approved_at,
      po.cancelled_by,
      po.cancelled_at,
      po.cancel_reason,
      pr.requested_by,
      pr.requested_by_email,
      pr.pr_number,
      c.company_name,
      p.project_name,
      v.vendor_name
    FROM purchase_orders po
    LEFT JOIN purchase_requisitions pr ON pr.id = po.requisition_id
    LEFT JOIN company_registry c ON c.id = po.company_id
    LEFT JOIN projects p ON p.id = po.project_id
    LEFT JOIN vendors v ON v.id = po.vendor_id
    WHERE po.id = ?
    LIMIT 1
  `, [poId]);
  const row = rows?.[0] || null;
  if (!row) return { sent: false, reason: 'not-found' };

  const recipients = dedupeEmailList([
    ...parseEmailList(row.requested_by_email || ''),
    ...await resolveUserEmailsByText([row.prepared_by, row.requested_by])
  ]);
  if (!recipients.length) {
    console.warn(`No requester/preparer email configured for purchase order ${row.po_number || poId}.`);
    return { sent: false, reason: 'no-recipients' };
  }

  const decisionText = String(decision || '').toLowerCase();
  const rejected = decisionText === 'rejected';
  const cancelled = decisionText === 'cancelled';
  const statusText = rejected ? 'Rejected' : cancelled ? 'Cancelled' : 'Approved';
  const actor = String(options.decidedBy || ((cancelled || rejected) ? options.cancelledBy : options.approvedBy) || ((cancelled || rejected) ? row.cancelled_by : row.approved_by) || '').trim();
  const decidedAt = (cancelled || rejected) ? row.cancelled_at : row.approved_at;
  const reason = String(options.reason || row.cancel_reason || '').trim();
  const reviewUrl = buildAppUrl('/procurement?tab=purchase-orders');
  const detailRows = [
    ['PO No.', row.po_number],
    ['PR No.', row.pr_number],
    ['Status', statusText],
    ['Company', row.company_name],
    ['Project', row.project_name],
    ['Vendor', row.vendor_name],
    ['PO Date', row.po_date],
    ['Delivery Date', row.delivery_date],
    ['Amount', formatPdfMoney(row.total_amount)],
    [(cancelled || rejected) ? `${statusText} By` : 'Approved By', actor],
    [(cancelled || rejected) ? `${statusText} At` : 'Approved At', decidedAt],
    (cancelled || rejected) ? ['Reason', reason] : null
  ].filter(Boolean)
    .filter(([, value]) => value !== undefined && value !== null && String(value).trim() !== '')
    .map(([label, value]) => `
      <tr>
        <td style="padding:6px 10px;border:1px solid #d9e2ec;font-weight:600;">${htmlEscape(label)}</td>
        <td style="padding:6px 10px;border:1px solid #d9e2ec;">${htmlEscape(value)}</td>
      </tr>
    `)
    .join('');

  const attachments = [];
  try {
    attachments.push(await buildPurchaseOrderPdfAttachment(poId, {
      status: options.statusOverride || (rejected ? 'rejected' : cancelled ? 'cancelled' : '')
    }));
  } catch (pdfErr) {
    console.error('PO requester PDF attachment warning:', pdfErr);
  }

  return sendSystemEmail({
    from: `Kinaadman ERP <${SMTP_FROM}>`,
    to: recipients.join(','),
    subject: `Purchase Order ${statusText}: ${row.po_number || poId}`,
    attachments: attachments.length ? attachments : undefined,
    text: `Purchase order ${row.po_number || poId} has been ${statusText.toLowerCase()}. View: ${reviewUrl}`,
    html: `
      <div style="font-family:Arial,sans-serif;color:#1f2937;line-height:1.5;">
        <h2 style="margin:0 0 12px;">Purchase Order ${htmlEscape(statusText)}</h2>
        <p style="margin:0 0 12px;">Purchase order <strong>${htmlEscape(row.po_number || poId)}</strong> has been ${htmlEscape(statusText.toLowerCase())}.</p>
        <table style="border-collapse:collapse;margin:12px 0;">${detailRows}</table>
        <p style="margin:16px 0;"><a href="${htmlEscape(reviewUrl)}" style="background:#14532d;color:#ffffff;text-decoration:none;padding:10px 14px;border-radius:6px;display:inline-block;">View in ERP</a></p>
      </div>
    `
  });
}

async function notifyPurchaseOrderVendor(req, poId) {
  const rows = await queryAsync(`
    SELECT
      po.po_number,
      po.po_date,
      po.delivery_date,
      po.total_amount,
      po.payment_terms,
      c.company_name,
      p.project_name,
      pr.pr_number,
      v.vendor_name,
      v.contact_person,
      v.email AS vendor_email,
      be.company_name AS business_entity_name
    FROM purchase_orders po
    LEFT JOIN business_entities be ON be.id = po.business_entity_id
    LEFT JOIN purchase_requisitions pr ON pr.id = po.requisition_id
    LEFT JOIN company_registry c ON c.id = po.company_id
    LEFT JOIN projects p ON p.id = po.project_id
    LEFT JOIN vendors v ON v.id = po.vendor_id
    WHERE po.id = ?
    LIMIT 1
  `, [poId]);
  const row = rows?.[0] || null;
  if (!row) return { sent: false, reason: 'not-found' };

  const recipients = dedupeEmailList(parseEmailList(row.vendor_email || ''));
  if (!recipients.length) {
    console.warn(`No vendor email configured for purchase order ${row.po_number || poId}.`);
    return { sent: false, reason: 'no-vendor-email' };
  }

  const attachments = [];
  try {
    attachments.push(await buildPurchaseOrderPdfAttachment(poId, { status: 'approved' }));
  } catch (pdfErr) {
    console.error('PO vendor PDF attachment warning:', pdfErr);
  }

  const detailRows = [
    ['PO No.', row.po_number],
    ['PR No.', row.pr_number],
    ['Company', row.company_name],
    ['Project', row.project_name],
    ['PO Date', row.po_date],
    ['Delivery Date', row.delivery_date],
    ['Payment Terms', row.payment_terms],
    ['Amount', formatPdfMoney(row.total_amount)]
  ].filter(([, value]) => value !== undefined && value !== null && String(value).trim() !== '')
    .map(([label, value]) => `
      <tr>
        <td style="padding:6px 10px;border:1px solid #d9e2ec;font-weight:600;">${htmlEscape(label)}</td>
        <td style="padding:6px 10px;border:1px solid #d9e2ec;">${htmlEscape(value)}</td>
      </tr>
    `)
    .join('');

  const vendorName = row.contact_person || row.vendor_name || 'Vendor';
  const buyerName = row.business_entity_name || 'Kinaadman ERP';
  return sendSystemEmail({
    from: `Kinaadman ERP <${SMTP_FROM}>`,
    to: recipients.join(','),
    subject: `Purchase Order: ${row.po_number || poId}`,
    attachments: attachments.length ? attachments : undefined,
    text: [
      `Dear ${vendorName},`,
      `Please find attached purchase order ${row.po_number || poId}.`,
      `Delivery date: ${row.delivery_date || 'To be coordinated'}`,
      `Total: ${formatPdfMoney(row.total_amount)}`,
      'Thank you.'
    ].join('\n'),
    html: `
      <div style="font-family:Arial,sans-serif;color:#1f2937;line-height:1.5;">
        <h2 style="margin:0 0 12px;">Purchase Order</h2>
        <p style="margin:0 0 12px;">Dear ${htmlEscape(vendorName)},</p>
        <p style="margin:0 0 12px;">Please find attached purchase order <strong>${htmlEscape(row.po_number || poId)}</strong>.</p>
        <table style="border-collapse:collapse;margin:12px 0;">${detailRows}</table>
        <p style="margin:16px 0 0;">Thank you,<br>${htmlEscape(buyerName)}</p>
      </div>
    `
  });
}

async function notifyRfqAwardedRequester(req, quotationId) {
  const rows = await queryAsync(`
    SELECT
      q.quote_number,
      q.quoted_total,
      q.delivery_days,
      q.payment_terms,
      pr.id AS requisition_id,
      pr.pr_number,
      pr.requested_by,
      pr.requested_by_email,
      c.company_name,
      p.project_name,
      v.vendor_name
    FROM procurement_quotations q
    JOIN purchase_requisitions pr ON pr.id = q.requisition_id
    LEFT JOIN company_registry c ON c.id = pr.company_id
    LEFT JOIN projects p ON p.id = pr.project_id
    LEFT JOIN vendors v ON v.id = q.vendor_id
    WHERE q.id = ?
    LIMIT 1
  `, [quotationId]);
  const row = rows?.[0] || null;
  if (!row) return { sent: false, reason: 'not-found' };

  const recipients = dedupeEmailList([
    ...parseEmailList(row.requested_by_email || ''),
    ...await resolveUserEmailsByText(row.requested_by)
  ]);
  if (!recipients.length) {
    console.warn(`No requester email configured for RFQ ${row.quote_number || quotationId}.`);
    return { sent: false, reason: 'no-recipients' };
  }

  const reviewUrl = buildAppUrl('/procurement?tab=quotations');
  const detailRows = [
    ['RFQ No.', row.quote_number],
    ['PR No.', row.pr_number],
    ['Awarded Vendor', row.vendor_name],
    ['Quoted Total', formatPdfMoney(row.quoted_total)],
    ['Delivery Days', row.delivery_days],
    ['Payment Terms', row.payment_terms],
    ['Company', row.company_name],
    ['Project', row.project_name]
  ].filter(([, value]) => value !== undefined && value !== null && String(value).trim() !== '')
    .map(([label, value]) => `
      <tr>
        <td style="padding:6px 10px;border:1px solid #d9e2ec;font-weight:600;">${htmlEscape(label)}</td>
        <td style="padding:6px 10px;border:1px solid #d9e2ec;">${htmlEscape(value)}</td>
      </tr>
    `)
    .join('');

  return sendSystemEmail({
    from: `Kinaadman ERP <${SMTP_FROM}>`,
    to: recipients.join(','),
    subject: `RFQ Awarded: ${row.quote_number || quotationId}`,
    text: `RFQ ${row.quote_number || quotationId} has been awarded to ${row.vendor_name || 'the selected vendor'}. View: ${reviewUrl}`,
    html: `
      <div style="font-family:Arial,sans-serif;color:#1f2937;line-height:1.5;">
        <h2 style="margin:0 0 12px;">RFQ Awarded</h2>
        <p style="margin:0 0 12px;">The winning RFQ for PR <strong>${htmlEscape(row.pr_number || '')}</strong> has been selected.</p>
        <table style="border-collapse:collapse;margin:12px 0;">${detailRows}</table>
        <p style="margin:16px 0;"><a href="${htmlEscape(reviewUrl)}" style="background:#14532d;color:#ffffff;text-decoration:none;padding:10px 14px;border-radius:6px;display:inline-block;">View in ERP</a></p>
      </div>
    `
  });
}

async function notifyRfqAwardedVendor(req, quotationId) {
  const rows = await queryAsync(`
    SELECT
      q.quote_number,
      q.quoted_total,
      q.delivery_days,
      q.payment_terms,
      q.warranty_terms,
      pr.pr_number,
      pr.needed_by,
      c.company_name,
      p.project_name,
      v.vendor_name,
      v.contact_person,
      v.email AS vendor_email,
      be.company_name AS business_entity_name
    FROM procurement_quotations q
    JOIN purchase_requisitions pr ON pr.id = q.requisition_id
    LEFT JOIN business_entities be ON be.id = pr.business_entity_id
    LEFT JOIN company_registry c ON c.id = pr.company_id
    LEFT JOIN projects p ON p.id = pr.project_id
    LEFT JOIN vendors v ON v.id = q.vendor_id
    WHERE q.id = ?
    LIMIT 1
  `, [quotationId]);
  const row = rows?.[0] || null;
  if (!row) return { sent: false, reason: 'not-found' };

  const recipients = dedupeEmailList(parseEmailList(row.vendor_email || ''));
  if (!recipients.length) {
    console.warn(`No vendor email configured for awarded RFQ ${row.quote_number || quotationId}.`);
    return { sent: false, reason: 'no-vendor-email' };
  }

  const attachments = [];
  try {
    attachments.push(await buildQuotationPdfAttachment(quotationId));
  } catch (pdfErr) {
    console.error('Awarded vendor quotation PDF attachment warning:', pdfErr);
  }

  const detailRows = [
    ['RFQ No.', row.quote_number],
    ['PR No.', row.pr_number],
    ['Company', row.company_name],
    ['Project', row.project_name],
    ['Needed By', row.needed_by],
    ['Quoted Total', formatPdfMoney(row.quoted_total)],
    ['Delivery Days', Number(row.delivery_days || 0) ? `${Number(row.delivery_days)} days` : ''],
    ['Payment Terms', row.payment_terms],
    ['Warranty', row.warranty_terms]
  ].filter(([, value]) => value !== undefined && value !== null && String(value).trim() !== '')
    .map(([label, value]) => `
      <tr>
        <td style="padding:6px 10px;border:1px solid #d9e2ec;font-weight:600;">${htmlEscape(label)}</td>
        <td style="padding:6px 10px;border:1px solid #d9e2ec;">${htmlEscape(value)}</td>
      </tr>
    `)
    .join('');

  const vendorName = row.contact_person || row.vendor_name || 'Vendor';
  const buyerName = row.business_entity_name || 'Kinaadman ERP';

  return sendSystemEmail({
    from: `Kinaadman ERP <${SMTP_FROM}>`,
    to: recipients.join(','),
    subject: `RFQ Award Notice: ${row.quote_number || quotationId}`,
    attachments: attachments.length ? attachments : undefined,
    text: [
      `Dear ${vendorName},`,
      `Your quotation ${row.quote_number || quotationId} for PR ${row.pr_number || ''} has been approved.`,
      `${buyerName} selected your company as the supplier for this purchase. Our team will coordinate the purchase order and next steps.`,
      `Quoted total: ${formatPdfMoney(row.quoted_total)}`,
      'Thank you.'
    ].join('\n'),
    html: `
      <div style="font-family:Arial,sans-serif;color:#1f2937;line-height:1.5;">
        <h2 style="margin:0 0 12px;">RFQ Award Notice</h2>
        <p style="margin:0 0 12px;">Dear ${htmlEscape(vendorName)},</p>
        <p style="margin:0 0 12px;">Your quotation for PR <strong>${htmlEscape(row.pr_number || '')}</strong> has been <strong>approved</strong>.</p>
        <p style="margin:0 0 12px;"><strong>${htmlEscape(buyerName)}</strong> selected your company as the supplier for this purchase. Our team will coordinate the purchase order and next steps.</p>
        <table style="border-collapse:collapse;margin:12px 0;">${detailRows}</table>
        <p style="margin:16px 0 0;">Thank you,<br>${htmlEscape(buyerName)}</p>
      </div>
    `
  });
}

async function notifyFinanceApproval(req, type = 'bill', recordId = 0, options = {}) {
  const isPayment = String(type || '').toLowerCase() === 'payment';
  const rejected = String(options.decision || '').toLowerCase() === 'rejected';
  const rows = await queryAsync(isPayment ? `
    SELECT
      pay.id,
      pay.payment_type,
      pay.payment_date,
      pay.amount,
      pay.payment_method,
      pay.reference_number,
      pay.approved_by,
      pay.approved_at,
      ap.bill_number,
      ar.invoice_number
    FROM payments pay
    LEFT JOIN accounts_payable ap ON ap.id = pay.ap_id
    LEFT JOIN accounts_receivable ar ON ar.id = pay.ar_id
    WHERE pay.id = ?
    LIMIT 1
  ` : `
    SELECT
      ap.id,
      ap.bill_number,
      ap.bill_date,
      ap.due_date,
      ap.total_amount,
      ap.approved_by,
      ap.approved_at,
      v.vendor_name,
      po.po_number
    FROM accounts_payable ap
    LEFT JOIN vendors v ON v.id = ap.vendor_id
    LEFT JOIN purchase_orders po ON po.id = ap.po_id
    WHERE ap.id = ?
    LIMIT 1
  `, [recordId]);
  const row = rows?.[0] || null;
  if (!row) return { sent: false, reason: 'not-found' };

  const recipients = await getApprovalNotificationRecipients();
  if (!recipients.length) return { sent: false, reason: 'no-recipients' };
  const title = isPayment
    ? (rejected ? 'Payment Rejected' : 'Payment Approved')
    : (rejected ? 'AP Bill Rejected' : 'AP Bill Approved');
  const recordNo = isPayment
    ? (row.reference_number || `Payment #${recordId}`)
    : (row.bill_number || `Bill #${recordId}`);
  const reviewUrl = buildAppUrl(isPayment ? '/accounts-payable?tab=payments' : '/accounts-payable?tab=bills');
  const approvedBy = String(options.approvedBy || options.rejectedBy || row.approved_by || '').trim();
  const detailRows = (isPayment ? [
    ['Payment Type', row.payment_type],
    ['Reference No.', row.reference_number],
    ['Linked Bill/Invoice', row.bill_number || row.invoice_number],
    ['Payment Date', row.payment_date],
    ['Amount', formatPdfMoney(row.amount)],
    ['Method', row.payment_method],
    [rejected ? 'Rejected By' : 'Approved By', approvedBy],
    [rejected ? 'Rejected At' : 'Approved At', row.approved_at],
    rejected ? ['Reason', options.reason] : null
  ] : [
    ['Bill No.', row.bill_number],
    ['PO No.', row.po_number],
    ['Vendor', row.vendor_name],
    ['Bill Date', row.bill_date],
    ['Due Date', row.due_date],
    ['Amount', formatPdfMoney(row.total_amount)],
    [rejected ? 'Rejected By' : 'Approved By', approvedBy],
    [rejected ? 'Rejected At' : 'Approved At', row.approved_at],
    rejected ? ['Reason', options.reason] : null
  ]).filter(Boolean)
    .filter(([, value]) => value !== undefined && value !== null && String(value).trim() !== '')
    .map(([label, value]) => `
      <tr>
        <td style="padding:6px 10px;border:1px solid #d9e2ec;font-weight:600;">${htmlEscape(label)}</td>
        <td style="padding:6px 10px;border:1px solid #d9e2ec;">${htmlEscape(value)}</td>
      </tr>
    `)
    .join('');

  const attachments = [];
  try {
    attachments.push(isPayment
      ? await buildPaymentVoucherPdfAttachment(recordId)
      : await buildBillSummaryEmailAttachment(recordId));
  } catch (pdfErr) {
    console.error('Finance approval PDF attachment warning:', pdfErr);
  }

  return sendSystemEmail({
    from: `Kinaadman ERP <${SMTP_FROM}>`,
    to: recipients.join(','),
    subject: `${title}: ${recordNo}`,
    attachments: attachments.length ? attachments : undefined,
    text: `${title}: ${recordNo}. View: ${reviewUrl}`,
    html: `
      <div style="font-family:Arial,sans-serif;color:#1f2937;line-height:1.5;">
        <h2 style="margin:0 0 12px;">${htmlEscape(title)}</h2>
        <table style="border-collapse:collapse;margin:12px 0;">${detailRows}</table>
        <p style="margin:16px 0;"><a href="${htmlEscape(reviewUrl)}" style="background:#14532d;color:#ffffff;text-decoration:none;padding:10px 14px;border-radius:6px;display:inline-block;">View in ERP</a></p>
      </div>
    `
  });
}

async function notifyBillApprovalRequest(req, billId) {
  const rows = await queryAsync(`
    SELECT
      ap.id,
      ap.bill_number,
      ap.bill_date,
      ap.due_date,
      ap.total_amount,
      ap.notes,
      ap.pdfFilename,
      v.vendor_name,
      po.po_number,
      p.project_name,
      be.company_name
    FROM accounts_payable ap
    LEFT JOIN vendors v ON v.id = ap.vendor_id
    LEFT JOIN purchase_orders po ON po.id = ap.po_id
    LEFT JOIN projects p ON p.id = ap.project_id
    LEFT JOIN business_entities be ON be.id = ap.business_entity_id
    WHERE ap.id = ?
    LIMIT 1
  `, [billId]);
  const row = rows?.[0] || null;
  if (!row) return { sent: false, reason: 'not-found' };

  const attachments = [];
  try {
    const generated = await generateBillPdfFile(billId);
    attachments.push({
      filename: generated.filename,
      path: generated.filePath,
      contentType: 'application/pdf'
    });
  } catch (pdfErr) {
    console.error('AP bill approval PDF generation warning:', pdfErr);
  }

  return notifyApprovalRequest(req, {
    title: 'AP Bill',
    recordNo: row.bill_number || `Bill #${billId}`,
    submittedBy: getApprovalActorLabel(req),
    reviewPath: '/accounts-payable?tab=bills',
    details: {
      Company: row.company_name,
      Vendor: row.vendor_name,
      Project: row.project_name,
      'PO No.': row.po_number,
      'Bill Date': row.bill_date,
      'Due Date': row.due_date,
      Amount: row.total_amount,
      Notes: row.notes
    },
    attachments: attachments.length ? attachments : undefined
  });
}

async function notifyPaymentApprovalRequest(req, paymentId) {
  const rows = await queryAsync(`
    SELECT
      pay.id,
      pay.payment_type,
      pay.payment_date,
      pay.amount,
      pay.payment_method,
      pay.reference_number,
      pay.notes,
      ap.bill_number,
      v.vendor_name
    FROM payments pay
    LEFT JOIN accounts_payable ap ON ap.id = pay.ap_id
    LEFT JOIN vendors v ON v.id = ap.vendor_id
    WHERE pay.id = ?
    LIMIT 1
  `, [paymentId]);
  const row = rows?.[0] || null;
  if (!row) return { sent: false, reason: 'not-found' };
  if (String(row.payment_type || '').toLowerCase() !== 'ap') {
    return { sent: false, reason: 'not-ap-payment' };
  }

  const attachments = [];
  try {
    attachments.push(await buildPaymentVoucherPdfAttachment(paymentId));
  } catch (pdfErr) {
    console.error('Payment approval request PDF attachment warning:', pdfErr);
  }

  return notifyApprovalRequest(req, {
    title: 'AP Payment',
    recordNo: row.reference_number || `Payment #${paymentId}`,
    submittedBy: getApprovalActorLabel(req),
    reviewPath: '/accounts-payable?tab=payments',
    details: {
      Vendor: row.vendor_name,
      'Bill No.': row.bill_number,
      'Payment Date': row.payment_date,
      Amount: row.amount,
      Method: row.payment_method,
      Notes: row.notes
    },
    attachments: attachments.length ? attachments : undefined
  });
}

async function notifyProjectApprovalRequest(req, projectId) {
  const rows = await queryAsync(`
    SELECT
      p.id,
      p.project_docno,
      p.project_name,
      p.project_manager,
      p.start_date,
      p.end_date,
      p.budget,
      p.priority,
      p.created_by,
      c.company_name
    FROM projects p
    LEFT JOIN company_registry c ON c.id = p.company_id
    WHERE p.id = ?
    LIMIT 1
  `, [projectId]);
  const row = rows?.[0] || null;
  if (!row) return { sent: false, reason: 'not-found' };
  const attachments = [];
  try {
    const generated = await generateProjectPdfFile(projectId);
    attachments.push({
      filename: generated.filename,
      path: generated.filePath,
      contentType: 'application/pdf'
    });
  } catch (pdfErr) {
    console.error('Project approval PDF generation warning:', pdfErr);
  }

  return notifyApprovalRequest(req, {
    title: 'Project Approval',
    recordNo: row.project_docno || `Project #${projectId}`,
    submittedBy: getApprovalActorLabel(req),
    reviewPath: '/admin?panel=project-records&tab=projects',
    details: {
      Company: row.company_name,
      Project: row.project_name,
      Manager: row.project_manager,
      'Start Date': row.start_date,
      'End Date': row.end_date,
      Budget: row.budget,
      Priority: row.priority
    },
    attachments: attachments.length ? attachments : undefined
  });
}

async function notifyProjectRequester(req, projectId, decision = 'approved', options = {}) {
  const rows = await queryAsync(`
    SELECT
      p.id,
      p.project_docno,
      p.draft_docno,
      p.project_name,
      p.project_manager,
      p.start_date,
      p.end_date,
      p.budget,
      p.priority,
      p.status,
      p.approved_by,
      p.approved_at,
      p.created_by,
      p.assigned_to,
      c.company_name,
      creator.email AS created_by_email,
      creator.fullname AS created_by_name,
      creator.username AS created_by_username,
      assignee.email AS assigned_to_email,
      assignee.fullname AS assigned_to_name,
      assignee.username AS assigned_to_username
    FROM projects p
    LEFT JOIN company_registry c ON c.id = p.company_id
    LEFT JOIN users creator ON creator.id = p.created_by
    LEFT JOIN users assignee ON assignee.id = p.assigned_to
    WHERE p.id = ?
    LIMIT 1
  `, [projectId]);
  const row = rows?.[0] || null;
  if (!row) return { sent: false, reason: 'not-found' };

  const recipients = dedupeEmailList([
    ...parseEmailList(row.created_by_email || ''),
    ...parseEmailList(row.assigned_to_email || ''),
    ...await resolveUserEmailsByText([
      row.project_manager,
      row.created_by_username,
      row.created_by_name,
      row.assigned_to_username,
      row.assigned_to_name
    ])
  ]);

  const recordNo = row.project_docno || row.draft_docno || `Project #${projectId}`;
  if (!recipients.length) {
    console.warn(`No staff/requester email configured for project ${recordNo}.`);
    return { sent: false, reason: 'no-recipients' };
  }

  const rejected = String(decision || '').toLowerCase() === 'rejected';
  const statusText = rejected ? 'Rejected' : 'Approved';
  const actor = String(options.decidedBy || (rejected ? options.rejectedBy : options.approvedBy) || row.approved_by || getApprovalActorLabel(req) || '').trim();
  const reason = String(options.reason || '').trim();
  const reviewUrl = buildAppUrl(`/staff?panel=project-records&tab=${rejected ? 'requests' : 'projects'}&search=${encodeURIComponent(recordNo)}`, getRequestBaseUrl(req));
  const attachments = [];

  if (!rejected) {
    try {
      const generated = await generateProjectPdfFile(projectId);
      attachments.push({
        filename: generated.filename,
        path: generated.filePath,
        contentType: 'application/pdf'
      });
    } catch (pdfErr) {
      console.error('Project approved PDF attachment warning:', pdfErr);
    }
  }

  const detailRows = [
    ['Project No.', recordNo],
    ['Status', statusText],
    ['Company', row.company_name],
    ['Project', row.project_name],
    ['Manager', row.project_manager],
    ['Start Date', row.start_date],
    ['End Date', row.end_date],
    ['Budget', formatPdfMoney(row.budget)],
    ['Priority', row.priority],
    [rejected ? 'Rejected By' : 'Approved By', actor],
    [rejected ? 'Rejected At' : 'Approved At', row.approved_at],
    rejected ? ['Reason', reason] : null
  ].filter(Boolean)
    .filter(([, value]) => value !== undefined && value !== null && String(value).trim() !== '')
    .map(([label, value]) => `
      <tr>
        <td style="padding:6px 10px;border:1px solid #d9e2ec;font-weight:600;">${htmlEscape(label)}</td>
        <td style="padding:6px 10px;border:1px solid #d9e2ec;">${htmlEscape(value)}</td>
      </tr>
    `)
    .join('');

  return sendSystemEmail({
    from: `Kinaadman ERP <${SMTP_FROM}>`,
    to: recipients.join(','),
    subject: `Project ${statusText}: ${recordNo}`,
    attachments: attachments.length ? attachments : undefined,
    text: [
      `Hello,`,
      `Your project ${recordNo} has been ${statusText.toLowerCase()}.`,
      row.project_name ? `Project: ${row.project_name}` : '',
      rejected && reason ? `Reason: ${reason}` : '',
      `View: ${reviewUrl}`
    ].filter(Boolean).join('\n'),
    html: `
      <div style="font-family:Arial,sans-serif;color:#1f2937;line-height:1.5;">
        <h2 style="margin:0 0 12px;">Project ${htmlEscape(statusText)}</h2>
        <p style="margin:0 0 12px;">Your project <strong>${htmlEscape(recordNo)}</strong> has been ${htmlEscape(statusText.toLowerCase())}.</p>
        <table style="border-collapse:collapse;margin:12px 0;">${detailRows}</table>
        ${!rejected && attachments.length ? '<p style="margin:0 0 12px;">The approved project PDF is attached to this email.</p>' : ''}
        <p style="margin:16px 0;">
          <a href="${htmlEscape(reviewUrl)}" style="background:#14532d;color:#ffffff;text-decoration:none;padding:10px 14px;border-radius:6px;display:inline-block;">View in ERP</a>
        </p>
      </div>
    `
  });
}

function sendBackgroundNotification(task, label = 'notification') {
  Promise.resolve()
    .then(task)
    .then((result) => {
      if (result && result.sent === false) {
        console.warn(`Background ${label} not sent: ${result.reason || 'unknown reason'}`);
      }
    })
    .catch((err) => {
      console.error(`Background ${label} error:`, err);
    });
}

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

// Business-entity logos are public images shown in app headers, so they live under
// public/ (served by express.static) instead of the auth-gated PDF upload dir.
const LOGO_UPLOAD_DIR = path.join(__dirname, 'public', 'uploads', 'entity-logos');
if (!fs.existsSync(LOGO_UPLOAD_DIR)) {
  fs.mkdirSync(LOGO_UPLOAD_DIR, { recursive: true });
}
const LOGO_ALLOWED_EXT = ['.png', '.jpg', '.jpeg', '.webp', '.svg', '.gif'];
const LOGO_ALLOWED_MIME = new Set([
  'image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/svg+xml', 'image/gif'
]);
const logoStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, LOGO_UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = String(path.extname(file.originalname || '')).toLowerCase();
    const safeExt = LOGO_ALLOWED_EXT.includes(ext) ? ext : '.png';
    cb(null, `entity-${Date.now()}-${Math.round(Math.random() * 1e9)}${safeExt}`);
  }
});
const logoUpload = multer({
  storage: logoStorage,
  limits: { fileSize: 2 * 1024 * 1024 }, // 2MB
  fileFilter: (req, file, cb) => {
    if (LOGO_ALLOWED_MIME.has(String(file.mimetype || '').toLowerCase())) {
      cb(null, true);
    } else {
      cb(new Error('Only PNG, JPG, WEBP, SVG, or GIF images are allowed.'), false);
    }
  }
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
      fullname: String(payload.fullname || ''),
      email: String(payload.email || '')
    };
    req.authType = 'bearer';
  }

  next();
}

// Auth/role helpers + route guards now live in src/middleware/auth (imported at top).

function getActorIdentityTerms(actor = {}) {
  return [actor.fullname, actor.username, actor.email]
    .map(value => String(value || '').trim().toLowerCase())
    .filter(value => value.length >= 3);
}

function valueMatchesActorIdentity(value, terms = []) {
  const text = String(value || '').trim().toLowerCase();
  if (!text || !terms.length) return false;
  return terms.some(term => text === term || text.includes(term));
}

function projectRowMatchesStaffActor(row = {}, actor = {}) {
  const actorId = Number(actor.id || 0) || 0;
  if (actorId) {
    const assignedTo = Number(row.assigned_to || row.assigned_to_id || 0) || 0;
    if (assignedTo) return assignedTo === actorId;
    if (Number(row.created_by || 0) === actorId) return true;
  }

  const terms = getActorIdentityTerms(actor);
  return [
    row.project_manager,
    row.members,
    row.project_members,
    row.project_members_2,
    row.project_members_3,
    row.created_by_name,
    row.created_by_username,
    row.created_by_email
  ].some(value => valueMatchesActorIdentity(value, terms));
}

function requisitionRowMatchesStaffActor(row = {}, actor = {}) {
  if (projectRowMatchesStaffActor(row, actor)) return true;
  const terms = getActorIdentityTerms(actor);
  return [
    row.requested_by,
    row.requested_by_email,
    row.submitted_by,
    row.department
  ].some(value => valueMatchesActorIdentity(value, terms));
}

function sendStaffRecordAccessDenied(res, label = 'record') {
  return res.status(404).json({ error: `${label} not found.` });
}

async function resolveProjectAssignedStaffId(req, requestedAssignedTo = null) {
  const actor = getAuthenticatedUser(req) || {};
  if (isStaffRole(actor.role)) return Number(actor.id || 0) || null;

  const assignedTo = Number(requestedAssignedTo || 0) || 0;
  if (!assignedTo) {
    const err = new Error('Assigned staff is required for admin-created projects.');
    err.statusCode = 400;
    throw err;
  }

  const rows = await queryAsync(
    `SELECT id, role, active, COALESCE(NULLIF(approval_status, ''), 'approved') AS approval_status
     FROM users
     WHERE id = ?
     LIMIT 1`,
    [assignedTo]
  );
  const user = rows?.[0];
  if (!user || !isStaffRole(user.role) || Number(user.active || 0) !== 1 || String(user.approval_status || 'approved').toLowerCase() !== 'approved') {
    const err = new Error('Assigned staff must be an active approved staff user.');
    err.statusCode = 400;
    throw err;
  }
  return assignedTo;
}

// Derives the operational project status from its dates:
//   planning  -> today is before the planned start date
//   active    -> planned start reached, but no actual start recorded yet
//   ongoing   -> an actual start date is recorded (work has begun)
//   completed -> an actual end date is recorded
//   overdue   -> past the planned end date but not yet completed
// Workflow statuses (draft/needs_revision/submitted/on_hold/cancelled) are kept as-is.
function normalizeProjectStatusForSave(status, actualStartDate = null, actualEndDate = null, plannedEndDate = null, plannedStartDate = null) {
  const requestedStatus = String(status || '').trim().toLowerCase();
  const allowedProjectStatuses = new Set(['draft', 'needs_revision', 'submitted', 'planning', 'active', 'ongoing', 'on_hold', 'completed', 'cancelled', 'overdue']);
  const safeStatus = allowedProjectStatuses.has(requestedStatus) ? requestedStatus : 'planning';

  if (safeStatus === 'draft' || safeStatus === 'needs_revision' || safeStatus === 'submitted' || safeStatus === 'cancelled' || safeStatus === 'on_hold') return safeStatus;

  const parseDate = (value) => {
    const d = new Date(String(value || '').slice(0, 10));
    if (Number.isNaN(d.getTime())) return null;
    d.setHours(0, 0, 0, 0);
    return d;
  };
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const actualStart = parseDate(actualStartDate);
  const actualEnd = parseDate(actualEndDate);
  const plannedStart = parseDate(plannedStartDate);
  const plannedEnd = parseDate(plannedEndDate);

  if (actualEnd) return 'completed';
  if (plannedEnd && today > plannedEnd) return 'overdue';
  if (actualStart && today >= actualStart) return 'ongoing';
  if (plannedStart) return today >= plannedStart ? 'active' : 'planning';
  return actualStart ? 'ongoing' : 'planning';
}

function computeProjectPriority(plannedEndDate = null, actualEndDate = null, status = '') {
  const safeStatus = String(status || '').trim().toLowerCase();
  if (safeStatus === 'draft' || safeStatus === 'needs_revision' || safeStatus === 'submitted' || safeStatus === 'completed' || safeStatus === 'cancelled' || actualEndDate) return 'low';

  const end = new Date(String(plannedEndDate || '').slice(0, 10));
  if (Number.isNaN(end.getTime())) return 'medium';
  end.setHours(0, 0, 0, 0);

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const daysLeft = Math.ceil((end.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

  if (daysLeft < 0) return 'urgent';
  if (daysLeft <= 3) return 'urgent';
  if (daysLeft <= 7) return 'high';
  if (daysLeft <= 14) return 'medium';
  return 'low';
}

function isProjectAwaitingApprovalStatus(status = '') {
  return ['draft', 'needs_revision', 'submitted'].includes(String(status || '').trim().toLowerCase());
}

function getProjectAwaitingApprovalMessage(activity = 'creating new activity') {
  return `Selected project is not yet approved. Save it as draft, submit it for approval, then Admin or Super Admin must approve it before ${activity}.`;
}

function canManageSuperAdmin(req) {
  return isSuperAdminRole(getAuthenticatedUser(req)?.role);
}

function canManagePrivilegedUsers(req) {
  return isSuperAdminRole(getAuthenticatedUser(req)?.role);
}

function isPrivilegedUserRoleValue(role) {
  return ['super_admin', 'admin'].includes(normalizeAccessRole(role));
}

function assertCanManageUserTarget(req, targetRole, action = 'manage') {
  if (canManagePrivilegedUsers(req)) return;
  if (isPrivilegedUserRoleValue(targetRole)) {
    const err = new Error(`Only Super Admin can ${action} admin or super admin accounts.`);
    err.statusCode = 403;
    throw err;
  }
}

function hashResetToken(token) {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex');
}

function normalizeRegistrationVerificationCode(value) {
  return String(value || '').replace(/\D/g, '').slice(0, 6);
}

function hashRegistrationVerificationCode(email, code) {
  return crypto
    .createHash('sha256')
    .update(`${String(email || '').trim().toLowerCase()}:${normalizeRegistrationVerificationCode(code)}`)
    .digest('hex');
}

function buildUsernameBaseFromEmail(email) {
  const localPart = String(email || '').split('@')[0] || 'user';
  const cleaned = localPart
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '_')
    .replace(/^[_\W]+|[_\W]+$/g, '')
    .slice(0, 42);
  return cleaned || 'user';
}

async function generateUniqueUsernameFromEmail(email) {
  const base = buildUsernameBaseFromEmail(email);
  let candidate = base;
  for (let i = 0; i < 25; i += 1) {
    const rows = await queryAsync('SELECT id FROM users WHERE username = ? LIMIT 1', [candidate]);
    if (!rows.length) return candidate;
    const suffix = `_${i + 2}`;
    candidate = `${base.slice(0, Math.max(1, 50 - suffix.length))}${suffix}`;
  }
  return `user_${crypto.randomBytes(8).toString('hex')}`.slice(0, 50);
}

async function validateRegistrationVerificationCode(email, code) {
  const safeEmail = String(email || '').trim().toLowerCase();
  const safeCode = normalizeRegistrationVerificationCode(code);
  if (!safeEmail || safeCode.length !== 6) {
    throw new Error('Enter the 6-digit email verification code.');
  }

  const rows = await queryAsync(
    'SELECT email, code_hash, expires_at, attempts, verified_at FROM registration_email_verifications WHERE email = ? LIMIT 1',
    [safeEmail]
  );
  if (!rows.length) {
    throw new Error('Send a verification code to this email first.');
  }

  const record = rows[0];
  if (Number(record.attempts || 0) >= 5) {
    throw new Error('Too many incorrect verification attempts. Send a new code.');
  }
  const expiresAt = new Date(record.expires_at);
  if (!record.expires_at || Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() <= Date.now()) {
    throw new Error('Verification code expired. Send a new code.');
  }

  const expectedHash = String(record.code_hash || '');
  const submittedHash = hashRegistrationVerificationCode(safeEmail, safeCode);
  if (!timingSafeStringEqual(expectedHash, submittedHash)) {
    await queryAsync(
      'UPDATE registration_email_verifications SET attempts = attempts + 1 WHERE email = ?',
      [safeEmail]
    );
    throw new Error('Incorrect verification code.');
  }

  await queryAsync('UPDATE registration_email_verifications SET verified_at = NOW() WHERE email = ?', [safeEmail]);
  return true;
}

async function verifyUserPassword(userRow, password) {
  const rawPassword = String(password || '');
  const storedPassword = String(userRow?.password || '');
  if (!rawPassword || !storedPassword) return false;

  if (storedPassword.startsWith('$2b$') || storedPassword.startsWith('$2a$')) {
    return bcrypt.compare(rawPassword, storedPassword);
  }

  return allowLegacyPlaintextPasswords && rawPassword === storedPassword;
}

async function verifyCurrentAdminPassword(req, password) {
  const adminId = Number(getAuthenticatedUser(req)?.id || 0);
  if (!adminId) return false;

  const rows = await queryAsync('SELECT id, password, role, active FROM users WHERE id = ? LIMIT 1', [adminId]);
  const admin = rows[0];
  if (!admin || !isAdminRole(admin.role) || Number(admin.active || 0) !== 1) return false;
  return verifyUserPassword(admin, password);
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
        message: message || 'Too many requests. Please try again later.',
        retryAfter
      });
    }

    next();
  };
}

const loginAttemptState = new Map();
const LOGIN_FAILURE_LIMIT = 3;
const LOGIN_ACCOUNT_FAILURE_LIMIT = 5;
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

function getLoginAccountThrottleKey(username) {
  const safeUsername = String(username || '').trim().toLowerCase() || 'unknown';
  return `login-account:${safeUsername}`;
}

function getLoginThrottleEntryByKey(key) {
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

function getLoginThrottleEntry(req, username) {
  return getLoginThrottleEntryByKey(getLoginThrottleKey(req, username));
}

function getLoginCooldownRemaining(req, username) {
  const throttleStates = [
    getLoginThrottleEntryByKey(getLoginAccountThrottleKey(username)),
    getLoginThrottleEntry(req, username)
  ];
  return throttleStates.reduce((maxRemaining, { entry, now }) => {
    if (!entry.lockUntil || entry.lockUntil <= now) return maxRemaining;
    return Math.max(maxRemaining, Math.ceil((entry.lockUntil - now) / 1000));
  }, 0);
}

function registerLoginFailureForKey(key, failureLimit) {
  const { entry, now } = getLoginThrottleEntryByKey(key);
  entry.failures += 1;
  entry.updatedAt = now;

  if (entry.failures < failureLimit) {
    loginAttemptState.set(key, entry);
    return {
      locked: false,
      retryAfter: 0,
      attemptsRemaining: Math.max(0, failureLimit - entry.failures)
    };
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
    retryAfter: Math.max(1, Math.ceil(cooldownMs / 1000)),
    attemptsRemaining: 0
  };
}

function registerLoginFailure(req, username) {
  const accountState = registerLoginFailureForKey(getLoginAccountThrottleKey(username), LOGIN_ACCOUNT_FAILURE_LIMIT);
  const ipState = registerLoginFailureForKey(getLoginThrottleKey(req, username), LOGIN_FAILURE_LIMIT);

  return [accountState, ipState].reduce((current, next) => {
    if (!next.locked) return current;
    if (!current.locked || next.retryAfter > current.retryAfter) return next;
    return current;
  }, {
    locked: false,
    retryAfter: 0,
    attemptsRemaining: Math.min(
      Number(accountState.attemptsRemaining || 0),
      Number(ipState.attemptsRemaining || 0)
    )
  });
}

function clearLoginThrottle(req, username) {
  loginAttemptState.delete(getLoginThrottleKey(req, username));
  loginAttemptState.delete(getLoginAccountThrottleKey(username));
}

const loginRateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 10,
  keyPrefix: 'login',
  keyGenerator: (req) => {
    const username = String(req.body?.username || req.body?.email || '').trim().toLowerCase();
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

const forgotPasswordCooldowns = new Map();
const FORGOT_PASSWORD_RESEND_COOLDOWN_MS = 60 * 1000;

function getForgotPasswordCooldownKey(req, email) {
  return `${getClientIp(req).toLowerCase()}:${String(email || '').trim().toLowerCase() || 'unknown'}`;
}

function getForgotPasswordRetryAfter(req, email) {
  const key = getForgotPasswordCooldownKey(req, email);
  const until = Number(forgotPasswordCooldowns.get(key) || 0);
  const remaining = Math.max(0, Math.ceil((until - Date.now()) / 1000));
  if (remaining <= 0 && until) {
    forgotPasswordCooldowns.delete(key);
  }
  return remaining;
}

function startForgotPasswordCooldown(req, email) {
  forgotPasswordCooldowns.set(
    getForgotPasswordCooldownKey(req, email),
    Date.now() + FORGOT_PASSWORD_RESEND_COOLDOWN_MS
  );
}

const registerVerificationRateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 5,
  keyPrefix: 'register-verification',
  keyGenerator: (req) => `${getClientIp(req)}:${String(req.body?.email || '').trim().toLowerCase() || 'unknown'}`,
  message: 'Masyadong maraming verification code requests. Subukan ulit mamaya.'
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
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
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

function createSessionStore(cookieMaxAgeMs) {
  try {
    const store = createPostgresSessionStore({ ttlMs: cookieMaxAgeMs });
    store.ready
      .then(() => console.log('PostgreSQL session store ready'))
      .catch((err) => console.error('PostgreSQL session store error:', err));
    return store;
  } catch (err) {
    if (isProduction) {
      throw err;
    }
    console.error('Session store fallback to memory:', err.message);
    return null;
  }
}


// SESSION SETUP
const defaultSessionInactivityTimeoutMs = 15 * 60 * 1000;
const configuredSessionInactivityTimeoutMs = Number(
  process.env.SESSION_INACTIVITY_TIMEOUT_MS ||
  process.env.SESSION_MAX_AGE_MS ||
  defaultSessionInactivityTimeoutMs
);
const sessionMaxAgeMs = Number.isFinite(configuredSessionInactivityTimeoutMs) && configuredSessionInactivityTimeoutMs > 0
  ? configuredSessionInactivityTimeoutMs
  : defaultSessionInactivityTimeoutMs;
const sessionStore = createSessionStore(sessionMaxAgeMs);
app.use(session(buildSessionOptions({
  isProduction,
  sessionSecret,
  cookieMaxAgeMs: sessionMaxAgeMs,
  store: sessionStore,
  cookieSecure: sessionCookieSecure
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

const publicStaticHtmlPaths = new Set([
  '/login/index.html',
  '/reset-password/index.html'
]);

const protectedStaticHtmlPaths = new Map([
  ['/admin/index.html', protectAdminOnly],
  ['/staff/index.html', protectStaffOnly],
  ['/accounts-payable/index.html', protectAdmin],
  ['/accounts-receivable/index.html', protectAdmin],
  ['/sales-management/index.html', protectAdmin],
  ['/inventory/index.html', protectAdmin],
  ['/notifications/index.html', protectAdmin],
  ['/reports/index.html', protectAdminOnly],
  ['/gantt-chart/index.html', protectAdminOnly],
  ['/business-entities/index.html', protectSuperAdmin],
  ['/user-management/index.html', protectAdminOnly],
  ['/user-index/index.html', protectAuthenticated]
]);

function normalizeStaticRequestPath(req) {
  try {
    return decodeURIComponent(req.path || '').replace(/\\/g, '/').toLowerCase();
  } catch (_) {
    return String(req.path || '').replace(/\\/g, '/').toLowerCase();
  }
}

app.use((req, res, next) => {
  if (!['GET', 'HEAD'].includes(String(req.method || '').toUpperCase())) {
    return next();
  }

  const requestPath = normalizeStaticRequestPath(req);
  if (!requestPath.endsWith('.html')) {
    return next();
  }

  if (publicStaticHtmlPaths.has(requestPath)) {
    noCache(res);
    return next();
  }

  const guard = protectedStaticHtmlPaths.get(requestPath);
  if (guard) {
    noCache(res);
    return guard(req, res, () => {
      if (requestPath === '/admin/index.html') {
        return sendAdminWorkspacePage(req, res);
      }
      if (requestPath === '/staff/index.html') {
        return sendStaffPage(req, res);
      }
      next();
    });
  }

  return res.status(404).send('Not found');
});

function redirectAccountsPayableProcurementTab(req, res, tab) {
  const procurementTabs = new Set(['requests', 'requisitions', 'rfq', 'quotations', 'bid-evaluation', 'purchase-orders', 'goods-receipts']);
  if (!procurementTabs.has(tab)) return false;
  const targetTab = tab === 'bid-evaluation' ? 'quotations' : tab;
  const redirectUrl = new URL('/procurement', `${req.protocol}://${req.get('host')}`);
  Object.entries(req.query || {}).forEach(([key, value]) => {
    if (key === 'tab') return;
    if (Array.isArray(value)) {
      value.forEach((item) => redirectUrl.searchParams.append(key, item));
    } else if (value !== undefined) {
      redirectUrl.searchParams.set(key, value);
    }
  });
  redirectUrl.searchParams.set('tab', targetTab);
  res.redirect(`${redirectUrl.pathname}${redirectUrl.search}`);
  return true;
}

function handleAccountsPayablePage(req, res) {
  noCache(res);
  const tab = String(req.query?.tab || '').trim().toLowerCase();
  if (tab === 'vendors') {
    return res.redirect('/master-data?tab=vendors');
  }
  if (redirectAccountsPayableProcurementTab(req, res, tab)) return;
  res.sendFile(path.join(__dirname, 'public', 'accounts-payable', 'index.html'));
}

function handleProcurementPage(req, res) {
  noCache(res);
  const tab = String(req.query?.tab || '').trim().toLowerCase();
  if (tab === 'vendors') {
    return res.redirect('/master-data?tab=vendors');
  }
  res.sendFile(path.join(__dirname, 'public', 'accounts-payable', 'index.html'));
}

function handleMasterDataPage(req, res) {
  noCache(res);
  const tab = String(req.query?.tab || '').trim().toLowerCase();
  if (!tab) {
    return res.redirect('/master-data?tab=companies');
  }
  // Migrated to React (Companies + Vendors + Requests tabs). Serve the React build when present;
  // fall back to the classic accounts-payable shell if the bundle is missing. Revert this branch
  // to roll back the cut-over. See [[react-migration]].
  const reactIndex = path.join(__dirname, 'public', 'react', 'index.html');
  if (fs.existsSync(reactIndex)) return res.sendFile(reactIndex);
  res.sendFile(path.join(__dirname, 'public', 'accounts-payable', 'index.html'));
}

app.get(['/accounts-payable', '/accounts-payable/'], protectAdmin, handleAccountsPayablePage);
app.get(['/procurement', '/procurement/'], protectAdmin, handleProcurementPage);
app.get(['/master-data', '/master-data/'], protectAdmin, handleMasterDataPage);
app.get(['/sales-management', '/sales-management/'], protectAdmin, (req, res) => {
  noCache(res);
  res.sendFile(path.join(__dirname, 'public', 'sales-management', 'index.html'));
});
app.get(['/notifications', '/notifications/'], protectAdmin, (req, res) => {
  noCache(res);
  res.sendFile(path.join(__dirname, 'public', 'notifications', 'index.html'));
});

app.use(express.static('public', {
  index: false,
  etag: true,
  lastModified: true,
  setHeaders: (res, filePath) => {
    const normalizedPath = String(filePath || '').toLowerCase();
    if (/\.(html|css|js)$/.test(normalizedPath)) {
      // Cache but ALWAYS revalidate against the file's ETag/Last-Modified on every load. The
      // browser sends a conditional GET: it gets a tiny 304 when the file is unchanged, and a
      // fresh 200 the moment the file is edited. This is more reliable for picking up edits than
      // `no-store`, and removes the need to manually bump `?v=` cache-busters — a normal refresh
      // always serves the latest JS/CSS. (Sensitive API/page responses keep `no-store` via
      // noCache().) See [[react-migration]] / cache strategy.
      res.setHeader('Cache-Control', 'no-cache');
    }
  }
}));

// ==================== Database Bootstrap ====================
// db, queryAsync, and the pg error helpers now live in src/database (imported at top).
initApp();

function initApp() {
  console.log('PostgreSQL connection pool ready');

  function addIndexIfMissing(sql, label) {
    db.query(sql, (err) => {
      if (!err) {
        console.log(`âœ… ${label} ready`);
        return;
      }
      if (isPostgresDuplicateObject(err)) {
        return;
      }
      console.error(`${label} index error:`, err);
    });
  }

  function quotePgIdentifier(value) {
    return `"${String(value || '').replace(/"/g, '""')}"`;
  }

  function addForeignKeyIfMissing(sql, label) {
    db.query(sql, (err) => {
      if (err && !isPostgresDuplicateObject(err)) {
        console.error(`${label} migration error:`, err);
      }
    });
  }

  function addRelationshipIntegrityConstraints() {
    db.query('ALTER TABLE purchase_requisitions DROP CONSTRAINT IF EXISTS purchase_requisitions_company_id_fkey', (err) => {
      if (err) console.error('Purchase requisitions duplicate company FK cleanup error:', err);
    });

    addForeignKeyIfMissing(`
      ALTER TABLE company_registry
      ADD CONSTRAINT fk_company_registry_business_entity_id
      FOREIGN KEY (business_entity_id) REFERENCES business_entities(id)
      ON UPDATE CASCADE
      ON DELETE SET NULL
    `, 'Company registry business entity FK');
    addForeignKeyIfMissing(`
      ALTER TABLE vendors
      ADD CONSTRAINT fk_vendors_company_id
      FOREIGN KEY (company_id) REFERENCES company_registry(id)
      ON UPDATE CASCADE
      ON DELETE SET NULL
    `, 'Vendors company FK');
    addForeignKeyIfMissing(`
      ALTER TABLE vendors
      ADD CONSTRAINT fk_vendors_business_entity_id
      FOREIGN KEY (business_entity_id) REFERENCES business_entities(id)
      ON UPDATE CASCADE
      ON DELETE SET NULL
    `, 'Vendors business entity FK');
    addForeignKeyIfMissing(`
      ALTER TABLE projects
      ADD CONSTRAINT fk_projects_business_entity_id
      FOREIGN KEY (business_entity_id) REFERENCES business_entities(id)
      ON UPDATE CASCADE
      ON DELETE SET NULL
    `, 'Projects business entity FK');
    addForeignKeyIfMissing(`
      ALTER TABLE purchase_requisitions
      ADD CONSTRAINT fk_purchase_requisitions_business_entity_id
      FOREIGN KEY (business_entity_id) REFERENCES business_entities(id)
      ON UPDATE CASCADE
      ON DELETE SET NULL
    `, 'Purchase requisitions business entity FK');
    addForeignKeyIfMissing(`
      ALTER TABLE purchase_orders
      ADD CONSTRAINT fk_purchase_orders_business_entity_id
      FOREIGN KEY (business_entity_id) REFERENCES business_entities(id)
      ON UPDATE CASCADE
      ON DELETE SET NULL
    `, 'Purchase orders business entity FK');
    addForeignKeyIfMissing(`
      ALTER TABLE purchase_orders
      ADD CONSTRAINT fk_purchase_orders_project_id
      FOREIGN KEY (project_id) REFERENCES projects(id)
      ON UPDATE CASCADE
      ON DELETE SET NULL
    `, 'Purchase orders project FK');
    addForeignKeyIfMissing(`
      ALTER TABLE accounts_payable
      ADD CONSTRAINT fk_accounts_payable_business_entity_id
      FOREIGN KEY (business_entity_id) REFERENCES business_entities(id)
      ON UPDATE CASCADE
      ON DELETE SET NULL
    `, 'Accounts payable business entity FK');
    addForeignKeyIfMissing(`
      ALTER TABLE accounts_receivable
      ADD CONSTRAINT fk_accounts_receivable_business_entity_id
      FOREIGN KEY (business_entity_id) REFERENCES business_entities(id)
      ON UPDATE CASCADE
      ON DELETE SET NULL
    `, 'Accounts receivable business entity FK');
    addForeignKeyIfMissing(`
      ALTER TABLE users
      ADD CONSTRAINT fk_users_approved_by
      FOREIGN KEY (approved_by) REFERENCES users(id)
      ON UPDATE CASCADE
      ON DELETE SET NULL
    `, 'Users approver FK');
    addForeignKeyIfMissing(`
      ALTER TABLE payments
      ADD CONSTRAINT chk_payments_single_ledger_link
      CHECK (
        (payment_type = 'ap' AND ap_id IS NOT NULL AND ar_id IS NULL)
        OR (payment_type = 'ar' AND ar_id IS NOT NULL AND ap_id IS NULL)
      )
    `, 'Payments ledger link check');
    addForeignKeyIfMissing(`
      ALTER TABLE journal_lines
      ADD CONSTRAINT chk_journal_lines_single_side_amount
      CHECK (
        debit >= 0
        AND credit >= 0
        AND (
          (debit > 0 AND credit = 0)
          OR (credit > 0 AND debit = 0)
        )
      )
    `, 'Journal lines single-side amount check');
  }

  function backfillProjectTimelineFields() {
  db.query(`
      UPDATE projects
      SET
        planned_start_date = COALESCE(planned_start_date, start_date),
        planned_end_date = COALESCE(planned_end_date, end_date)
    `, (err) => {
      if (err) console.error('Project timeline backfill error:', err);
    });
  }

  // Create tables
  db.query(`
    CREATE TABLE IF NOT EXISTS business_entities (
      id          integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
      entity_code VARCHAR(20)   NOT NULL UNIQUE,
      company_name VARCHAR(255) NOT NULL UNIQUE,
      address     TEXT,
      contact_person VARCHAR(255),
      phone       VARCHAR(50),
      email       VARCHAR(255),
      tin         VARCHAR(50),
      status      text NOT NULL DEFAULT 'active',
      is_default  boolean NOT NULL DEFAULT false,
      created_at  TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `, (err) => {
    if (err) console.error('Business entities table error:', err);
    else {
      console.log('✅ Table "business_entities" ready');
      db.query(`
        INSERT INTO business_entities (entity_code, company_name, status, is_default)
        VALUES
          ('ENT-001', 'KVSK CCTV & IT Solution', 'active', true),
          ('ENT-002', 'KITSI', 'active', false)
        ON CONFLICT DO NOTHING
      `, (seedErr) => {
        if (seedErr) console.error('Default business entity seed error:', seedErr);
        db.query(`
          UPDATE business_entities
          SET is_default = CASE WHEN entity_code = 'ENT-001' THEN true ELSE is_default END
          WHERE entity_code = 'ENT-001' OR is_default = TRUE
        `, (defaultErr) => {
          if (defaultErr) console.error('Default business entity flag error:', defaultErr);
        });
      });
    }
  });

  db.query(`ALTER TABLE business_entities ADD COLUMN IF NOT EXISTS logo_path TEXT`, (err) => {
    if (err) console.error('Business entities logo_path column error:', err);
  });
  // Per-entity brand color (hex, e.g. #7a1f1f) — drives PDF accent + app header tint per workspace.
  db.query(`ALTER TABLE business_entities ADD COLUMN IF NOT EXISTS brand_color VARCHAR(7)`, (err) => {
    if (err) console.error('Business entities brand_color column error:', err);
  });

  db.query(`
    CREATE TABLE IF NOT EXISTS users (
      id          integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
      username    VARCHAR(50)   NOT NULL UNIQUE,
      password    VARCHAR(255)  NOT NULL,
      email       VARCHAR(100)  NOT NULL UNIQUE,
      fullname    VARCHAR(100)  NOT NULL,
      role        text NOT NULL DEFAULT 'staff',
      last_login  timestamp      NULL,
      reset_token VARCHAR(255)  NULL,
      reset_token_expiry bigint NULL,
      approval_status text NOT NULL DEFAULT 'approved',
      approved_by integer NULL,
      approved_at timestamp NULL,
      created_at  TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
      active      boolean NOT NULL DEFAULT false
    )
  `, (err) => {
    if (err) console.error('Users table error:', err);
    else {
      console.log('âœ… Table "users" ready');
    }
  });

  db.query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS last_login timestamp NULL,
    ADD COLUMN IF NOT EXISTS reset_token VARCHAR(255) NULL,
    ADD COLUMN IF NOT EXISTS reset_token_expiry bigint NULL,
    ADD COLUMN IF NOT EXISTS approval_status text NOT NULL DEFAULT 'approved',
    ADD COLUMN IF NOT EXISTS approved_by integer NULL,
    ADD COLUMN IF NOT EXISTS approved_at timestamp NULL
  `, (err) => {
    if (err) console.error('Users reset token migration error:', err);
    else console.log('âœ… Users reset token columns are ready');
  });
  db.query(`
    UPDATE users
    SET approval_status = 'approved',
        approved_at = COALESCE(approved_at, created_at)
    WHERE approval_status IS NULL OR approval_status = ''
  `, (err) => {
    if (err) console.error('Users approval backfill error:', err);
  });
  db.query(`ALTER TABLE users ALTER COLUMN role SET DEFAULT 'staff'`, (err) => {
    if (err) console.error('Users role default migration error:', err);
  });
  db.query(`
    UPDATE users
    SET role = 'staff'
    WHERE LOWER(COALESCE(role, '')) = 'user'
       OR COALESCE(role, '') = ''
  `, (err) => {
    if (err) console.error('Users user-role removal migration error:', err);
  });

  db.query(`
    CREATE TABLE IF NOT EXISTS registration_email_verifications (
      email       VARCHAR(100) PRIMARY KEY,
      code_hash   VARCHAR(255) NOT NULL,
      requested_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      expires_at  TIMESTAMP NOT NULL,
      attempts    integer NOT NULL DEFAULT 0,
      verified_at TIMESTAMP NULL
    )
  `, (err) => {
    if (err) console.error('Registration email verifications table error:', err);
    else console.log('âœ… Table "registration_email_verifications" ready');
  });

  db.query(`
    CREATE TABLE IF NOT EXISTS vendors (
      id          integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
      company_id  integer           NULL,
      business_entity_id integer    NULL,
      vendor_no   VARCHAR(20)   NULL UNIQUE,
      vendor_name VARCHAR(255)  NOT NULL,
      contact_person VARCHAR(100),
      email       VARCHAR(100),
      phone       VARCHAR(20),
      address     TEXT,
      tin         VARCHAR(20),
      is_active   boolean       DEFAULT true,
      created_at  TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `, (err) => {
    if (err) console.error('Vendors table error:', err);
    else     console.log('âœ… Table "vendors" ready');
  });
  db.query(`ALTER TABLE vendors ADD COLUMN IF NOT EXISTS vendor_no VARCHAR(20) NULL`, (err) => {
    if (err) console.error('Vendors vendor_no migration error:', err);
  });
  db.query(`ALTER TABLE vendors ADD COLUMN IF NOT EXISTS company_id integer NULL`, (err) => {
    if (err) console.error('Vendors company_id migration error:', err);
  });
  db.query(`ALTER TABLE vendors ADD COLUMN IF NOT EXISTS business_entity_id integer NULL`, (err) => {
    if (err) console.error('Vendors business_entity_id migration error:', err);
  });

  db.query(`
    CREATE TABLE IF NOT EXISTS company_registry (
      id          integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
      company_no  VARCHAR(20)   NOT NULL UNIQUE,
      business_entity_id integer    NULL,
      company_name VARCHAR(255) NOT NULL UNIQUE,
      address     TEXT,
      contact_person VARCHAR(255),
      phone       VARCHAR(50),
      email       VARCHAR(255),
      tin         VARCHAR(50),
      industry    VARCHAR(100),
      status      text NOT NULL DEFAULT 'active',
      archived    boolean NOT NULL DEFAULT false,
      archived_at TIMESTAMP NULL DEFAULT NULL,
      notes       TEXT,
      created_at  TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `, (err) => {
    if (err) console.error('Company registry table error:', err);
    else     console.log('âœ… Table "company_registry" ready');
  });

  db.query(`ALTER TABLE company_registry ADD COLUMN IF NOT EXISTS archived boolean NOT NULL DEFAULT false`, (err) => {
    if (err) console.error('Company registry archived migration error:', err);
  });
  db.query(`ALTER TABLE company_registry ADD COLUMN IF NOT EXISTS archived_at TIMESTAMP NULL DEFAULT NULL`, (err) => {
    if (err) console.error('Company registry archived_at migration error:', err);
  });
  db.query(`ALTER TABLE company_registry ADD COLUMN IF NOT EXISTS business_entity_id integer NULL`, (err) => {
    if (err) console.error('Company registry business_entity_id migration error:', err);
  });
  db.query(`ALTER TABLE company_registry ADD COLUMN IF NOT EXISTS branch_code VARCHAR(10) NOT NULL DEFAULT '000'`, (err) => {
    if (err) console.error('Company registry branch_code migration error:', err);
  });

  db.query(`
    CREATE TABLE IF NOT EXISTS company_registry_requests (
      id integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
      request_no VARCHAR(50) NOT NULL UNIQUE,
      payload TEXT NOT NULL,
      status VARCHAR(30) NOT NULL DEFAULT 'submitted',
      requested_by VARCHAR(255),
      requested_by_email VARCHAR(255),
      submitted_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
      approved_by VARCHAR(255),
      approved_at TIMESTAMP NULL DEFAULT NULL,
      reject_reason TEXT,
      approval_comment TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `, (err) => {
    if (err) console.error('Company registry requests table error:', err);
    else console.log('âœ… Table "company_registry_requests" ready');
  });
  db.query(`ALTER TABLE company_registry_requests ADD COLUMN IF NOT EXISTS approval_comment TEXT`, (err) => {
    if (err) console.error('Company registry requests approval_comment migration error:', err);
  });

  db.query(`
    CREATE TABLE IF NOT EXISTS vendor_registry_requests (
      id integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
      request_no VARCHAR(50) NOT NULL UNIQUE,
      payload TEXT NOT NULL,
      status VARCHAR(30) NOT NULL DEFAULT 'submitted',
      requested_by VARCHAR(255),
      requested_by_email VARCHAR(255),
      submitted_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
      approved_by VARCHAR(255),
      approved_at TIMESTAMP NULL DEFAULT NULL,
      reject_reason TEXT,
      approval_comment TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `, (err) => {
    if (err) console.error('Vendor registry requests table error:', err);
    else console.log('âœ… Table "vendor_registry_requests" ready');
  });
  db.query(`ALTER TABLE vendor_registry_requests ADD COLUMN IF NOT EXISTS approval_comment TEXT`, (err) => {
    if (err) console.error('Vendor registry requests approval_comment migration error:', err);
  });

  db.query(`
    CREATE TABLE IF NOT EXISTS purchase_orders (
      id          integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
      po_number   VARCHAR(50)   NOT NULL UNIQUE,
      requisition_id integer        NULL,
      quotation_id integer          NULL,
      business_entity_id integer    NULL,
      vendor_id   integer           NOT NULL,
      company_id  integer           NULL,
      project_id  integer           NULL,
      po_date     DATE          NOT NULL,
      delivery_date DATE,
      payment_terms VARCHAR(100),
      prepared_by VARCHAR(255),
      approved_by VARCHAR(255),
      total_amount DECIMAL(12,2) NOT NULL,
      status      text DEFAULT 'draft',
      notes       TEXT,
      approval_comment TEXT,
      created_at  TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (vendor_id) REFERENCES vendors(id),
      FOREIGN KEY (company_id) REFERENCES company_registry(id)
    )
  `, (err) => {
    if (err) console.error('Purchase orders table error:', err);
    else     console.log('âœ… Table "purchase_orders" ready');
  });
  db.query(`ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS company_id integer NULL`, (err) => {
    if (err) console.error('Purchase orders company_id migration error:', err);
  });
  db.query(`ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS business_entity_id integer NULL`, (err) => {
    if (err) console.error('Purchase orders business_entity_id migration error:', err);
  });
  db.query(`ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS project_id integer NULL`, (err) => {
    if (err) console.error('Purchase orders project_id migration error:', err);
  });
  db.query(`ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS payment_terms VARCHAR(100) NULL`, (err) => {
    if (err) console.error('Purchase orders payment_terms migration error:', err);
  });
  db.query(`ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS prepared_by VARCHAR(255) NULL`, (err) => {
    if (err) console.error('Purchase orders prepared_by migration error:', err);
  });
  db.query(`ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS approved_by VARCHAR(255) NULL`, (err) => {
    if (err) console.error('Purchase orders approved_by migration error:', err);
  });
  db.query(`ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS draft_po_number VARCHAR(50) NULL`, (err) => {
    if (err) console.error('Purchase orders draft_po_number migration error:', err);
  });
  db.query(`ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS submitted_by VARCHAR(255) NULL`, (err) => {
    if (err) console.error('Purchase orders submitted_by migration error:', err);
  });
  db.query(`ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMP NULL`, (err) => {
    if (err) console.error('Purchase orders submitted_at migration error:', err);
  });
  db.query(`ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS approved_at TIMESTAMP NULL`, (err) => {
    if (err) console.error('Purchase orders approved_at migration error:', err);
  });
  db.query(`ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS archived boolean NOT NULL DEFAULT false`, (err) => {
    if (err) console.error('Purchase orders archived migration error:', err);
  });
  db.query(`ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS archived_at TIMESTAMP NULL`, (err) => {
    if (err) console.error('Purchase orders archived_at migration error:', err);
  });
  db.query(`ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS cancelled_by VARCHAR(255) NULL`, (err) => {
    if (err) console.error('Purchase orders cancelled_by migration error:', err);
  });
  db.query(`ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMP NULL`, (err) => {
    if (err) console.error('Purchase orders cancelled_at migration error:', err);
  });
  db.query(`ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS cancel_reason TEXT NULL`, (err) => {
    if (err) console.error('Purchase orders cancel_reason migration error:', err);
  });
  db.query(`ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS approval_comment TEXT`, (err) => {
    if (err) console.error('Purchase orders approval_comment migration error:', err);
  });
  addForeignKeyIfMissing(`
    ALTER TABLE purchase_orders
    ADD CONSTRAINT fk_purchase_orders_company_id
    FOREIGN KEY (company_id) REFERENCES company_registry(id)
    ON UPDATE CASCADE
    ON DELETE SET NULL
  `, 'Purchase orders company FK');

  db.query(`
    CREATE TABLE IF NOT EXISTS po_line_items (
      id          integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
      po_id       integer           NOT NULL,
      description TEXT,
      quantity    integer           NOT NULL,
      unit_price  DECIMAL(12,2) NOT NULL,
      line_total  DECIMAL(12,2) NOT NULL,
      received_qty integer          DEFAULT 0,
      created_at  TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (po_id) REFERENCES purchase_orders(id)
    )
  `, (err) => {
    if (err) console.error('PO line items table error:', err);
    else     console.log('âœ… Table "po_line_items" ready');
  });

  db.query(`ALTER TABLE po_line_items ADD COLUMN IF NOT EXISTS description TEXT`, (err) => {
    if (err) console.error('PO line items description migration error:', err);
  });
  db.query(`ALTER TABLE po_line_items ADD COLUMN IF NOT EXISTS product_id integer NULL`, (err) => {
    if (err) console.error('PO line items product_id migration error:', err);
  });
  function createInventoryTables() {
    db.query(`
      CREATE TABLE IF NOT EXISTS products (
        id integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
        business_entity_id integer NULL,
        sku VARCHAR(80) NOT NULL,
        product_name VARCHAR(255) NOT NULL,
        category VARCHAR(120),
        unit VARCHAR(40) DEFAULT 'pcs',
        reorder_level DECIMAL(12,2) DEFAULT 0,
        unit_cost DECIMAL(12,2) DEFAULT 0,
        selling_price DECIMAL(12,2) DEFAULT 0,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `, (productErr) => {
      if (productErr) {
        console.error('Products table error:', productErr);
        return;
      }
      console.log('âœ… Table "products" ready');
      db.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS selling_price DECIMAL(12,2) DEFAULT 0`, (err) => {
        if (err) console.error('Products selling_price migration error:', err);
      });

      db.query(`
        CREATE TABLE IF NOT EXISTS warehouses (
          id integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
          business_entity_id integer NULL,
          warehouse_code VARCHAR(80) NOT NULL,
          warehouse_name VARCHAR(255) NOT NULL,
          location TEXT,
          is_active BOOLEAN NOT NULL DEFAULT TRUE,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `, (warehouseErr) => {
        if (warehouseErr) {
          console.error('Warehouses table error:', warehouseErr);
          return;
        }
        console.log('âœ… Table "warehouses" ready');

        db.query(`
          CREATE TABLE IF NOT EXISTS stock (
            id integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
            business_entity_id integer NULL,
            product_id integer NOT NULL,
            warehouse_id integer NOT NULL,
            quantity_on_hand DECIMAL(12,2) NOT NULL DEFAULT 0,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (product_id) REFERENCES products(id),
            FOREIGN KEY (warehouse_id) REFERENCES warehouses(id)
          )
        `, (stockErr) => {
          if (stockErr) {
            console.error('Stock table error:', stockErr);
            return;
          }
          console.log('âœ… Table "stock" ready');

          db.query(`
            CREATE TABLE IF NOT EXISTS stock_movements (
              id integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
              business_entity_id integer NULL,
              product_id integer NOT NULL,
              warehouse_id integer NOT NULL,
              movement_type VARCHAR(20) NOT NULL,
              quantity DECIMAL(12,2) NOT NULL,
              reference_type VARCHAR(80),
              reference_no VARCHAR(120),
              project_id integer NULL,
              notes TEXT,
              movement_date DATE NOT NULL DEFAULT CURRENT_DATE,
              created_by VARCHAR(255),
              created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
              FOREIGN KEY (product_id) REFERENCES products(id),
              FOREIGN KEY (warehouse_id) REFERENCES warehouses(id)
            )
          `, (movementErr) => {
            if (movementErr) {
              console.error('Stock movements table error:', movementErr);
              return;
            }
            console.log('âœ… Table "stock_movements" ready');
            db.query(`ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS project_id integer NULL`, (err) => {
              if (err) console.error('Stock movements project_id migration error:', err);
            });
            addIndexIfMissing('CREATE UNIQUE INDEX IF NOT EXISTS uniq_products_entity_sku ON products (business_entity_id, sku)', 'products entity sku');
            addIndexIfMissing('CREATE UNIQUE INDEX IF NOT EXISTS uniq_warehouses_entity_code ON warehouses (business_entity_id, warehouse_code)', 'warehouses entity code');
            addIndexIfMissing('CREATE UNIQUE INDEX IF NOT EXISTS uniq_stock_product_warehouse ON stock (product_id, warehouse_id)', 'stock product warehouse');

            // Per-unit serial tracking: one row per physical item, so each serial
            // carries its own status, warranty window, and customer/project history
            // for warranty and RMA lookups.
            db.query(`
              CREATE TABLE IF NOT EXISTS product_units (
                id integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
                business_entity_id integer NULL,
                product_id integer NOT NULL,
                warehouse_id integer NULL,
                serial_number VARCHAR(120) NOT NULL,
                status VARCHAR(30) NOT NULL DEFAULT 'in_stock',
                customer_name VARCHAR(255),
                project_id integer NULL,
                source_po_id integer NULL,
                sales_record_id integer NULL,
                warranty_start DATE NULL,
                warranty_end DATE NULL,
                notes TEXT,
                created_by VARCHAR(255),
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (product_id) REFERENCES products(id),
                FOREIGN KEY (warehouse_id) REFERENCES warehouses(id)
              )
            `, (unitErr) => {
              if (unitErr) {
                console.error('Product units table error:', unitErr);
                return;
              }
              console.log('âœ… Table "product_units" ready');
              // Origin trace: which purchase order this physical unit was bought
              // under, so warranty/RMA can be traced back to the supplier.
              db.query(`ALTER TABLE product_units ADD COLUMN IF NOT EXISTS source_po_id integer NULL`, (alterErr) => {
                if (alterErr) console.error('Product units source_po_id migration error:', alterErr);
              });
              // Exit trace: which Delivery Receipt (sales record) sent this unit out,
              // so its status auto-flips to sold when the DR is delivered.
              db.query(`ALTER TABLE product_units ADD COLUMN IF NOT EXISTS sales_record_id integer NULL`, (alterErr) => {
                if (alterErr) console.error('Product units sales_record_id migration error:', alterErr);
              });
              // RMA lifecycle (return/warranty) on the latest claim per unit. Full
              // history lives in the audit trail; these columns track the open RMA so
              // the Inventory → RMA tab can list and resolve it. rma_resolution NULL = open.
              db.query(`ALTER TABLE product_units ADD COLUMN IF NOT EXISTS rma_reason TEXT`, (alterErr) => {
                if (alterErr) console.error('Product units rma_reason migration error:', alterErr);
              });
              db.query(`ALTER TABLE product_units ADD COLUMN IF NOT EXISTS rma_logged_at TIMESTAMP NULL`, (alterErr) => {
                if (alterErr) console.error('Product units rma_logged_at migration error:', alterErr);
              });
              db.query(`ALTER TABLE product_units ADD COLUMN IF NOT EXISTS rma_resolution VARCHAR(40) NULL`, (alterErr) => {
                if (alterErr) console.error('Product units rma_resolution migration error:', alterErr);
              });
              db.query(`ALTER TABLE product_units ADD COLUMN IF NOT EXISTS rma_resolved_at TIMESTAMP NULL`, (alterErr) => {
                if (alterErr) console.error('Product units rma_resolved_at migration error:', alterErr);
              });
              addIndexIfMissing('CREATE UNIQUE INDEX IF NOT EXISTS uniq_product_units_entity_serial ON product_units (business_entity_id, serial_number)', 'product units entity serial');
            });
          });
        });
      });
    });
  }

  createInventoryTables();

  db.query(`
    CREATE TABLE IF NOT EXISTS accounts_payable (
      id          integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
      business_entity_id integer    NULL,
      vendor_id   integer           NOT NULL,
      bill_number VARCHAR(50)   NOT NULL UNIQUE,
      invoice_number VARCHAR(50),
      bill_date   DATE          NOT NULL,
      due_date    DATE,
      project_id  integer,
      po_id       integer,
      total_amount DECIMAL(12,2) NOT NULL,
      paid_amount DECIMAL(12,2) DEFAULT 0,
      status      text DEFAULT 'pending',
      approval_status text NOT NULL DEFAULT 'approved',
      approved_by VARCHAR(255),
      approved_at TIMESTAMP,
      notes       TEXT,
      approval_comment TEXT,
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
    ADD COLUMN IF NOT EXISTS business_entity_id integer NULL
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
    ADD COLUMN IF NOT EXISTS project_id integer NULL
  `, (err) => {
    if (err) console.error('Accounts payable project_id migration error:', err);
  });
  db.query(`ALTER TABLE accounts_payable ADD COLUMN IF NOT EXISTS approval_status text NOT NULL DEFAULT 'approved'`, (err) => {
    if (err) console.error('Accounts payable approval_status migration error:', err);
  });
  db.query(`ALTER TABLE accounts_payable ADD COLUMN IF NOT EXISTS approved_by VARCHAR(255) NULL`, (err) => {
    if (err) console.error('Accounts payable approved_by migration error:', err);
  });
  // Links a bill to the SPECIFIC goods receipt it was raised from (so partial bills each show
  // their own GRN, not every GRN on the PO).
  db.query(`ALTER TABLE accounts_payable ADD COLUMN IF NOT EXISTS grn_id INTEGER NULL`, (err) => {
    if (err) console.error('Accounts payable grn_id migration error:', err);
  });
  db.query(`ALTER TABLE accounts_payable ADD COLUMN IF NOT EXISTS approved_at TIMESTAMP NULL`, (err) => {
    if (err) console.error('Accounts payable approved_at migration error:', err);
  });
  db.query(`ALTER TABLE accounts_payable ADD COLUMN IF NOT EXISTS draft_bill_number VARCHAR(50) NULL`, (err) => {
    if (err) console.error('Accounts payable draft_bill_number migration error:', err);
  });
  db.query(`ALTER TABLE accounts_payable ADD COLUMN IF NOT EXISTS approval_comment TEXT`, (err) => {
    if (err) console.error('Accounts payable approval_comment migration error:', err);
  });

  db.query(`
    CREATE TABLE IF NOT EXISTS sales_management_records (
      id integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
      record_type text NOT NULL,
      document_no VARCHAR(50) NOT NULL UNIQUE,
      business_entity_id integer NULL,
      company_id integer NULL,
      project_id integer NULL,
      source_record_id integer NULL,
      product_id integer NULL,
      warehouse_id integer NULL,
      quantity DECIMAL(12,2) NOT NULL DEFAULT 0,
      unit_price DECIMAL(12,2) NOT NULL DEFAULT 0,
      inventory_movement_id integer NULL,
      inventory_posted_at TIMESTAMP NULL,
      title VARCHAR(255) NOT NULL,
      description TEXT,
      requested_date DATE,
      target_date DATE,
      amount DECIMAL(12,2) NOT NULL DEFAULT 0,
      status text NOT NULL DEFAULT 'draft',
      contact_person VARCHAR(255),
      payment_terms VARCHAR(100),
      notes TEXT,
      created_by integer NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `, (err) => {
    if (err) console.error('Sales management records table error:', err);
    else {
      console.log('✅ Table "sales_management_records" ready');
      db.query(`ALTER TABLE sales_management_records ADD COLUMN IF NOT EXISTS business_entity_id integer NULL`, (alterErr) => {
        if (alterErr) console.error('Sales records business_entity_id migration error:', alterErr);
      });
      db.query(`ALTER TABLE sales_management_records ADD COLUMN IF NOT EXISTS company_id integer NULL`, (alterErr) => {
        if (alterErr) console.error('Sales records company_id migration error:', alterErr);
      });
      db.query(`ALTER TABLE sales_management_records ADD COLUMN IF NOT EXISTS project_id integer NULL`, (alterErr) => {
        if (alterErr) console.error('Sales records project_id migration error:', alterErr);
      });
      db.query(`ALTER TABLE sales_management_records ADD COLUMN IF NOT EXISTS source_record_id integer NULL`, (alterErr) => {
        if (alterErr) console.error('Sales records source_record_id migration error:', alterErr);
      });
      db.query(`ALTER TABLE sales_management_records ADD COLUMN IF NOT EXISTS product_id integer NULL`, (alterErr) => {
        if (alterErr) console.error('Sales records product_id migration error:', alterErr);
      });
      db.query(`ALTER TABLE sales_management_records ADD COLUMN IF NOT EXISTS warehouse_id integer NULL`, (alterErr) => {
        if (alterErr) console.error('Sales records warehouse_id migration error:', alterErr);
      });
      db.query(`ALTER TABLE sales_management_records ADD COLUMN IF NOT EXISTS quantity DECIMAL(12,2) NOT NULL DEFAULT 0`, (alterErr) => {
        if (alterErr) console.error('Sales records quantity migration error:', alterErr);
      });
      db.query(`ALTER TABLE sales_management_records ADD COLUMN IF NOT EXISTS unit_price DECIMAL(12,2) NOT NULL DEFAULT 0`, (alterErr) => {
        if (alterErr) console.error('Sales records unit_price migration error:', alterErr);
      });
      db.query(`ALTER TABLE sales_management_records ADD COLUMN IF NOT EXISTS inventory_movement_id integer NULL`, (alterErr) => {
        if (alterErr) console.error('Sales records inventory_movement_id migration error:', alterErr);
      });
      db.query(`ALTER TABLE sales_management_records ADD COLUMN IF NOT EXISTS inventory_posted_at TIMESTAMP NULL`, (alterErr) => {
        if (alterErr) console.error('Sales records inventory_posted_at migration error:', alterErr);
      });
      // Stage fields that mirror Procurement (SQ validity, SO downpayment/customer PO,
      // DR received-by/delivery address) so the sales flow matches PR->RFQ->PO->GRN->AP.
      db.query(`ALTER TABLE sales_management_records ADD COLUMN IF NOT EXISTS quote_validity DATE NULL`, (alterErr) => {
        if (alterErr) console.error('Sales records quote_validity migration error:', alterErr);
      });
      db.query(`ALTER TABLE sales_management_records ADD COLUMN IF NOT EXISTS downpayment DECIMAL(14,2) NOT NULL DEFAULT 0`, (alterErr) => {
        if (alterErr) console.error('Sales records downpayment migration error:', alterErr);
      });
      db.query(`ALTER TABLE sales_management_records ADD COLUMN IF NOT EXISTS customer_po_ref VARCHAR(100) NULL`, (alterErr) => {
        if (alterErr) console.error('Sales records customer_po_ref migration error:', alterErr);
      });
      db.query(`ALTER TABLE sales_management_records ADD COLUMN IF NOT EXISTS received_by VARCHAR(150) NULL`, (alterErr) => {
        if (alterErr) console.error('Sales records received_by migration error:', alterErr);
      });
      db.query(`ALTER TABLE sales_management_records ADD COLUMN IF NOT EXISTS delivery_address VARCHAR(255) NULL`, (alterErr) => {
        if (alterErr) console.error('Sales records delivery_address migration error:', alterErr);
      });
      // Delivery Receipt traceability: which purchase order supplied the delivered
      // goods, so non-serialized items can still be traced back to their vendor/PO.
      db.query(`ALTER TABLE sales_management_records ADD COLUMN IF NOT EXISTS source_po_id integer NULL`, (alterErr) => {
        if (alterErr) console.error('Sales records source_po_id migration error:', alterErr);
      });
      // Archive-only policy: records are soft-archived (never hard-deleted) so they appear in
      // the Archive Center and stay searchable. archived_at records when it was archived.
      db.query(`ALTER TABLE sales_management_records ADD COLUMN IF NOT EXISTS archived BOOLEAN NOT NULL DEFAULT FALSE`, (alterErr) => {
        if (alterErr) console.error('Sales records archived migration error:', alterErr);
      });
      db.query(`ALTER TABLE sales_management_records ADD COLUMN IF NOT EXISTS archived_at TIMESTAMP NULL`, (alterErr) => {
        if (alterErr) console.error('Sales records archived_at migration error:', alterErr);
      });
      // Project-centric flow migration: the legacy 'proposal-request' (Projects)
      // and 'service-order' sales record types were removed. Soft-archive any
      // existing rows (status -> cancelled) so they drop out of the active
      // pipeline while staying viewable for history. Idempotent.
      db.query(`
        UPDATE sales_management_records
        SET status = 'cancelled', updated_at = NOW()
        WHERE record_type IN ('proposal-request', 'service-order', 'sales-quotation')
          AND status <> 'cancelled'
      `, (alterErr, result) => {
        if (alterErr) console.error('Sales records legacy-type soft-archive migration error:', alterErr);
        else if (result && result.affectedRows) console.log(`✅ Soft-archived ${result.affectedRows} legacy Projects/Service-Order sales records`);
      });
    }
  });

  // Multi-item lines for sales records (SI/SO/DR). Additive: when a record has
  // line items, inventory/serials work per line; records without lines fall back
  // to the legacy single product_id/quantity fields on sales_management_records.
  db.query(`
    CREATE TABLE IF NOT EXISTS sales_record_items (
      id              integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
      sales_record_id integer NOT NULL,
      product_id      integer NULL,
      warehouse_id    integer NULL,
      description     TEXT,
      quantity        DECIMAL(12,2) NOT NULL DEFAULT 0,
      unit_price      DECIMAL(12,2) NOT NULL DEFAULT 0,
      line_total      DECIMAL(14,2) NOT NULL DEFAULT 0,
      created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (sales_record_id) REFERENCES sales_management_records(id) ON DELETE CASCADE,
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL,
      FOREIGN KEY (warehouse_id) REFERENCES warehouses(id) ON DELETE SET NULL
    )
  `, (err) => {
    if (err) console.error('Sales record items table error:', err);
    else {
      console.log('âœ… Table "sales_record_items" ready');
      addIndexIfMissing('CREATE INDEX IF NOT EXISTS idx_sales_record_items_record ON sales_record_items (sales_record_id)', 'sales_record_items record');
    }
  });

  db.query(`
    CREATE TABLE IF NOT EXISTS accounts_receivable (
      id          integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
      business_entity_id integer    NULL,
      customer_name VARCHAR(255) NOT NULL,
      invoice_number VARCHAR(50)  NOT NULL UNIQUE,
      invoice_date DATE          NOT NULL,
      due_date    DATE,
      payment_terms VARCHAR(50),
      total_amount DECIMAL(12,2) NOT NULL,
      paid_amount DECIMAL(12,2) DEFAULT 0,
      status      text DEFAULT 'draft',
      created_at  TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `, (err) => {
    if (err) console.error('Accounts receivable table error:', err);
    else     console.log('âœ… Table "accounts_receivable" ready');
  });

  db.query(`
    ALTER TABLE accounts_receivable
    ADD COLUMN IF NOT EXISTS business_entity_id integer NULL
  `, (err) => {
    if (err) console.error('Accounts receivable business_entity_id migration error:', err);
  });

  db.query(`
    ALTER TABLE accounts_receivable
    ADD COLUMN IF NOT EXISTS archived boolean NOT NULL DEFAULT false
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
    ADD COLUMN IF NOT EXISTS project_id integer NULL
  `, (err) => {
    if (err) console.error('Accounts receivable project_id column error:', err);
  });
  db.query(`
    CREATE INDEX IF NOT EXISTS idx_accounts_receivable_project_id
    ON accounts_receivable (project_id)
  `, (err) => {
    if (err && !isPostgresDuplicateObject(err)) {
      console.error('Accounts receivable project_id index migration error:', err);
    }
  });
  addForeignKeyIfMissing(`
    ALTER TABLE accounts_receivable
    ADD CONSTRAINT fk_accounts_receivable_project_id
    FOREIGN KEY (project_id) REFERENCES projects(id)
    ON DELETE SET NULL
  `, 'Accounts receivable project FK');

  db.query(`
    ALTER TABLE accounts_receivable
    ADD COLUMN IF NOT EXISTS project_docno VARCHAR(20) NULL
  `, (err) => {
    if (err) console.error('Accounts receivable project_docno column error:', err);
  });

  db.query(`
    ALTER TABLE accounts_receivable
    ADD COLUMN IF NOT EXISTS sales_record_id integer NULL
  `, (err) => {
    if (err) console.error('Accounts receivable sales_record_id migration error:', err);
  });

  db.query(`
    ALTER TABLE accounts_receivable
    ADD COLUMN IF NOT EXISTS sales_document_no VARCHAR(50) NULL
  `, (err) => {
    if (err) console.error('Accounts receivable sales_document_no migration error:', err);
  });

  db.query(`
    CREATE TABLE IF NOT EXISTS payments (
      id          integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
      payment_type text NOT NULL,
      ap_id       integer,
      ar_id       integer,
      payment_date DATE          NOT NULL,
      amount      DECIMAL(12,2) NOT NULL,
      payment_method text DEFAULT 'cash',
      reference_number VARCHAR(100),
      approval_status text NOT NULL DEFAULT 'approved',
      approved_by VARCHAR(255),
      approved_at TIMESTAMP,
      notes       TEXT,
      approval_comment TEXT,
      created_at  TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (ap_id) REFERENCES accounts_payable(id),
      FOREIGN KEY (ar_id) REFERENCES accounts_receivable(id)
    )
  `, (err) => {
    if (err) console.error('Payments table error:', err);
    else     console.log('âœ… Table "payments" ready');
  });

  db.query(`
    CREATE TABLE IF NOT EXISTS documents (
      id integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
      module_name VARCHAR(50) NOT NULL,
      record_id integer NOT NULL,
      document_type VARCHAR(80) NOT NULL DEFAULT 'attachment',
      original_filename VARCHAR(255) NOT NULL,
      stored_filename VARCHAR(255) NOT NULL,
      mime_type VARCHAR(100) NOT NULL DEFAULT 'application/pdf',
      file_size bigint NOT NULL DEFAULT 0,
      uploaded_by integer NULL,
      uploaded_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (uploaded_by) REFERENCES users(id) ON DELETE SET NULL
    )
  `, (err) => {
    if (err) console.error('Documents table error:', err);
    else     console.log('âœ… Table "documents" ready');
  });

  db.query(`ALTER TABLE payments ADD COLUMN IF NOT EXISTS payment_type text NOT NULL DEFAULT 'ap'`, (err) => {
    if (err) console.error('Payments payment_type migration error:', err);
  });
  db.query(`ALTER TABLE payments ADD COLUMN IF NOT EXISTS ap_id integer NULL`, (err) => {
    if (err) console.error('Payments ap_id migration error:', err);
  });
  db.query(`ALTER TABLE payments ADD COLUMN IF NOT EXISTS ar_id integer NULL`, (err) => {
    if (err) console.error('Payments ar_id migration error:', err);
  });
  db.query(`ALTER TABLE payments ADD COLUMN IF NOT EXISTS payment_method text DEFAULT 'cash'`, (err) => {
    if (err) console.error('Payments payment_method migration error:', err);
  });
  db.query(`ALTER TABLE payments ADD COLUMN IF NOT EXISTS reference_number VARCHAR(100) NULL`, (err) => {
    if (err) console.error('Payments reference_number migration error:', err);
  });
  db.query(`ALTER TABLE payments ADD COLUMN IF NOT EXISTS approval_status text NOT NULL DEFAULT 'approved'`, (err) => {
    if (err) console.error('Payments approval_status migration error:', err);
  });
  db.query(`ALTER TABLE payments ADD COLUMN IF NOT EXISTS approved_by VARCHAR(255) NULL`, (err) => {
    if (err) console.error('Payments approved_by migration error:', err);
  });
  db.query(`ALTER TABLE payments ADD COLUMN IF NOT EXISTS approved_at TIMESTAMP NULL`, (err) => {
    if (err) console.error('Payments approved_at migration error:', err);
  });
  db.query(`ALTER TABLE payments ADD COLUMN IF NOT EXISTS notes TEXT NULL`, (err) => {
    if (err) console.error('Payments notes migration error:', err);
  });
  db.query(`ALTER TABLE payments ADD COLUMN IF NOT EXISTS approval_comment TEXT`, (err) => {
    if (err) console.error('Payments approval_comment migration error:', err);
  });
  db.query(`UPDATE payments SET payment_type = 'ar' WHERE COALESCE(ar_id, 0) > 0 AND COALESCE(payment_type, '') <> 'ar'`, (err) => {
    if (err) console.error('Payments legacy AR migration error:', err);
  });
  db.query(`UPDATE payments SET payment_type = 'ap' WHERE COALESCE(ap_id, 0) > 0 AND COALESCE(payment_type, '') <> 'ap'`, (err) => {
    if (err) console.error('Payments legacy AP migration error:', err);
  });

  db.query(`
    CREATE TABLE IF NOT EXISTS projects (
      id          integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
      project_docno VARCHAR(20) UNIQUE,
      draft_docno VARCHAR(24) UNIQUE,
      project_name VARCHAR(255)  NOT NULL,
      business_entity_id integer NULL,
      company_id  integer,
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
      qty         integer           NOT NULL DEFAULT 0,
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
      status      text DEFAULT 'planning',
      priority    text DEFAULT 'medium',
      created_by integer NULL,
      assigned_to integer NULL,
      approved_by VARCHAR(255),
      approved_at TIMESTAMP NULL DEFAULT NULL,
      is_archived boolean NOT NULL DEFAULT false,
      archived_at TIMESTAMP NULL DEFAULT NULL,
      archived_auto boolean NOT NULL DEFAULT false,
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
      id          integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
      user_id     integer,
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
  // Audit-trail enrichment: link each log to the record it touched (entity_type + entity_id),
  // scope it to a workspace, capture WHAT changed (before → after), and flag its severity.
  db.query(`ALTER TABLE system_logs ADD COLUMN IF NOT EXISTS entity_type VARCHAR(50) NULL`, (err) => {
    if (err) console.error('System logs entity_type migration error:', err);
  });
  db.query(`ALTER TABLE system_logs ADD COLUMN IF NOT EXISTS entity_id INTEGER NULL`, (err) => {
    if (err) console.error('System logs entity_id migration error:', err);
  });
  db.query(`ALTER TABLE system_logs ADD COLUMN IF NOT EXISTS business_entity_id INTEGER NULL`, (err) => {
    if (err) console.error('System logs business_entity_id migration error:', err);
  });
  db.query(`ALTER TABLE system_logs ADD COLUMN IF NOT EXISTS changed_fields TEXT NULL`, (err) => {
    if (err) console.error('System logs changed_fields migration error:', err);
  });
  db.query(`ALTER TABLE system_logs ADD COLUMN IF NOT EXISTS severity VARCHAR(20) NOT NULL DEFAULT 'info'`, (err) => {
    if (err) console.error('System logs severity migration error:', err);
  });
  db.query(`CREATE INDEX IF NOT EXISTS idx_system_logs_entity ON system_logs (entity_type, entity_id)`, (err) => {
    if (err) console.error('System logs entity index error:', err);
  });
  db.query(`CREATE INDEX IF NOT EXISTS idx_system_logs_created_at ON system_logs (created_at DESC)`, (err) => {
    if (err) console.error('System logs created_at index error:', err);
  });

  // Migration for projects members
  db.query(`ALTER TABLE projects ADD COLUMN IF NOT EXISTS members VARCHAR(255)`, (err) => {
    if (err) console.error('Projects members migration error:', err);
  });
  // Project modal revamp fields (service type, estimated costs, location).
  db.query(`ALTER TABLE projects ADD COLUMN IF NOT EXISTS service_type VARCHAR(100) DEFAULT 'installation'`, (err) => {
    if (err) console.error('Projects service_type migration error:', err);
  });
  db.query(`ALTER TABLE projects ADD COLUMN IF NOT EXISTS estimated_material_cost NUMERIC DEFAULT 0`, (err) => {
    if (err) console.error('Projects estimated_material_cost migration error:', err);
  });
  db.query(`ALTER TABLE projects ADD COLUMN IF NOT EXISTS estimated_labor_cost NUMERIC DEFAULT 0`, (err) => {
    if (err) console.error('Projects estimated_labor_cost migration error:', err);
  });
  db.query(`ALTER TABLE projects ADD COLUMN IF NOT EXISTS estimated_other_cost NUMERIC DEFAULT 0`, (err) => {
    if (err) console.error('Projects estimated_other_cost migration error:', err);
  });
  db.query(`ALTER TABLE projects ADD COLUMN IF NOT EXISTS project_location VARCHAR(255)`, (err) => {
    if (err) console.error('Projects project_location migration error:', err);
  });
  db.query(`ALTER TABLE projects ADD COLUMN IF NOT EXISTS project_docno VARCHAR(20)`, (err) => {
    if (err) console.error('Projects project_docno migration error:', err);
  });
  db.query(`ALTER TABLE projects ADD COLUMN IF NOT EXISTS draft_docno VARCHAR(24)`, (err) => {
    if (err) console.error('Projects draft_docno migration error:', err);
  });
  db.query(`CREATE UNIQUE INDEX IF NOT EXISTS uniq_projects_draft_docno ON projects (draft_docno) WHERE draft_docno IS NOT NULL`, (err) => {
    if (err) console.error('Projects draft_docno unique index migration error:', err);
  });
  db.query(`
    UPDATE projects
    SET draft_docno = COALESCE(draft_docno, project_docno),
        project_docno = NULL,
        project_ar_invoice_no = NULL,
        project_ap_bill_no = NULL
    WHERE LOWER(COALESCE(status, '')) IN ('draft', 'needs_revision', 'submitted')
      AND draft_docno IS NULL
      AND project_docno IS NOT NULL
  `, (err) => {
    if (err) console.error('Projects draft number backfill migration error:', err);
  });
  db.query(`ALTER TABLE projects ADD COLUMN IF NOT EXISTS business_entity_id integer NULL`, (err) => {
    if (err) console.error('Projects business_entity_id migration error:', err);
  });
  db.query(`ALTER TABLE projects ADD COLUMN IF NOT EXISTS pdfFilename VARCHAR(255)`, (err) => {
    if (err) console.error('Projects pdfFilename migration error:', err);
  });
  db.query(`ALTER TABLE projects ADD COLUMN IF NOT EXISTS is_archived boolean NOT NULL DEFAULT false`, (err) => {
    if (err) console.error('Projects archived migration error:', err);
  });
  db.query(`ALTER TABLE projects ADD COLUMN IF NOT EXISTS archived_at TIMESTAMP NULL DEFAULT NULL`, (err) => {
    if (err) console.error('Projects archived_at migration error:', err);
  });
  db.query(`ALTER TABLE projects ADD COLUMN IF NOT EXISTS archived_auto boolean NOT NULL DEFAULT false`, (err) => {
    if (err) console.error('Projects archived_auto migration error:', err);
  });
  db.query(`ALTER TABLE projects ADD COLUMN IF NOT EXISTS created_by integer NULL`, (err) => {
    if (err) console.error('Projects created_by migration error:', err);
  });
  db.query(`ALTER TABLE projects ADD COLUMN IF NOT EXISTS assigned_to integer NULL`, (err) => {
    if (err) console.error('Projects assigned_to migration error:', err);
  });
  db.query(`ALTER TABLE projects ADD COLUMN IF NOT EXISTS approval_comment TEXT`, (err) => {
    if (err) console.error('Projects approval_comment migration error:', err);
  });
  db.query(`UPDATE projects SET assigned_to = created_by WHERE assigned_to IS NULL AND created_by IS NOT NULL`, (err) => {
    if (err) console.error('Projects assigned_to backfill error:', err);
  });
  db.query(`ALTER TABLE projects ADD COLUMN IF NOT EXISTS approved_by VARCHAR(255) NULL`, (err) => {
    if (err) console.error('Projects approved_by migration error:', err);
  });
  db.query(`ALTER TABLE projects ADD COLUMN IF NOT EXISTS approved_at TIMESTAMP NULL`, (err) => {
    if (err) console.error('Projects approved_at migration error:', err);
  });
  // Safe migration: Add company_id column if not exists
  db.query(`ALTER TABLE projects ADD COLUMN company_id integer NULL`, (err) => {
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

  addForeignKeyIfMissing(`
    ALTER TABLE accounts_payable
    ADD CONSTRAINT fk_accounts_payable_project_id
    FOREIGN KEY (project_id) REFERENCES projects(id)
    ON DELETE SET NULL
  `, 'Accounts payable project FK');

  db.query(`ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS project_id integer NULL`, (err) => {
    if (err) console.error('Stock movements project_id migration error:', err);
  });

  db.query(`
    CREATE TABLE IF NOT EXISTS document_sequences (
      sequence_key VARCHAR(100) NOT NULL,
      period_key VARCHAR(20) NOT NULL DEFAULT '',
      last_value integer NOT NULL DEFAULT 0,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ,
      PRIMARY KEY (sequence_key, period_key)
    )
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
    ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active',
    ADD COLUMN IF NOT EXISTS notes TEXT NULL,
    ADD COLUMN IF NOT EXISTS business_entity_id integer NULL
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
  db.query(`ALTER TABLE projects ADD COLUMN IF NOT EXISTS qty integer NOT NULL DEFAULT 0`, (err) => {
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
    SET company_id = c.id
    FROM company_registry c
    WHERE LOWER(TRIM(p.company_no)) = LOWER(TRIM(c.company_no))
      AND COALESCE(p.company_id, 0) = 0
      AND COALESCE(p.company_no, '') <> ''
  `, (err) => {
    if (err) console.error('Projects company_id backfill by company_no error:', err);
  });

  db.query(`
    UPDATE projects p
    SET company_id = c.id
    FROM company_registry c
    WHERE LOWER(TRIM(COALESCE(NULLIF(p.company_name, ''), NULLIF(p.client_name, '')))) = LOWER(TRIM(c.company_name))
      AND COALESCE(p.company_id, 0) = 0
      AND COALESCE(p.company_name, p.client_name, '') <> ''
  `, (err) => {
    if (err) console.error('Projects company_id backfill by company_name error:', err);
  });

  addForeignKeyIfMissing(`
    ALTER TABLE projects
    ADD CONSTRAINT fk_projects_company_id
    FOREIGN KEY (company_id) REFERENCES company_registry(id)
    ON UPDATE CASCADE
    ON DELETE SET NULL
  `, 'Projects company FK');
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
      id          integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
      project_id  integer           NOT NULL,
      task_name   VARCHAR(255)  NOT NULL,
      description TEXT,
      start_date  DATE          NOT NULL,
      end_date    DATE          NOT NULL,
      duration    integer,
      progress    integer           DEFAULT 0,
      assigned_to VARCHAR(100),
      status      text DEFAULT 'not_started',
      plan_cost   DECIMAL(12,2) DEFAULT 0,
      actual_cost DECIMAL(12,2) DEFAULT 0,
      dependencies integer,
      created_at  TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (project_id) REFERENCES projects(id)
    )
  `, (err) => {
    if (err) console.error('Tasks table error:', err);
    else     console.log('âœ… Table "tasks" ready');
  });

  db.query(`
    CREATE TABLE IF NOT EXISTS project_costs (
      id          integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
      project_id  integer           NOT NULL,
      task_id     integer,
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
      id          integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
      project_id  integer           NOT NULL,
      task_id     integer,
      resource_name VARCHAR(100) NOT NULL,
      resource_type text DEFAULT 'labor',
      quantity    DECIMAL(10,2),
      unit_cost   DECIMAL(12,2),
      allocation  integer           DEFAULT 100,
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
      id              integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
      account_code    VARCHAR(30)  NOT NULL UNIQUE,
      account_name    VARCHAR(255) NOT NULL,
      account_type    text NOT NULL,
      parent_account_id integer NULL,
      is_active       boolean NOT NULL DEFAULT true,
      created_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (parent_account_id) REFERENCES chart_of_accounts(id) ON DELETE SET NULL
    )
  `, (err) => {
    if (err) console.error('Chart of accounts table error:', err);
    else     console.log('âœ… Table "chart_of_accounts" ready');
  });

  db.query(`
    CREATE TABLE IF NOT EXISTS accounting_periods (
      id            integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
      period_name   VARCHAR(100) NOT NULL UNIQUE,
      start_date    DATE NOT NULL,
      end_date      DATE NOT NULL,
      is_closed     boolean NOT NULL DEFAULT false,
      created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `, (err) => {
    if (err) console.error('Accounting periods table error:', err);
    else     console.log('âœ… Table "accounting_periods" ready');
  });

  db.query(`
    CREATE TABLE IF NOT EXISTS journal_entries (
      id            integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
      entry_number  VARCHAR(50) NOT NULL UNIQUE,
      entry_date    DATE NOT NULL,
      reference_type VARCHAR(50),
      reference_id   VARCHAR(50),
      memo          TEXT,
      status        text NOT NULL DEFAULT 'draft',
      created_by    integer NULL,
      created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
    )
  `, (err) => {
    if (err) console.error('Journal entries table error:', err);
    else     console.log('âœ… Table "journal_entries" ready');
  });

  db.query(`
    CREATE TABLE IF NOT EXISTS journal_lines (
      id              integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
      journal_entry_id integer NOT NULL,
      account_id      integer NOT NULL,
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
      id            integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
      pr_number     VARCHAR(50) NOT NULL UNIQUE,
      business_entity_id integer NULL,
      company_id    integer NULL,
      project_id    integer NULL,
      request_date   DATE NOT NULL,
      department    VARCHAR(100),
      requested_by   VARCHAR(100),
      requested_by_email VARCHAR(255),
      pdfFilename VARCHAR(255),
      needed_by     DATE,
      status        text NOT NULL DEFAULT 'draft',
      notes        TEXT,
      approval_comment TEXT,
      created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (company_id) REFERENCES company_registry(id) ON DELETE SET NULL
    )
  `, (err) => {
    if (err) console.error('Purchase requisitions table error:', err);
    else     console.log('âœ… Table "purchase_requisitions" ready');
  });
  db.query(`ALTER TABLE purchase_requisitions ADD COLUMN IF NOT EXISTS company_id integer NULL`, (err) => {
    if (err) console.error('Purchase requisitions company_id migration error:', err);
  });
  db.query(`ALTER TABLE purchase_requisitions ADD COLUMN IF NOT EXISTS business_entity_id integer NULL`, (err) => {
    if (err) console.error('Purchase requisitions business_entity_id migration error:', err);
  });
  db.query(`ALTER TABLE purchase_requisitions ADD COLUMN IF NOT EXISTS project_id integer NULL`, (err) => {
    if (err) console.error('Purchase requisitions project_id migration error:', err);
  });
  // PR type: 'project' (raised from a project, project required) vs 'stock'
  // (direct stock replenishment, no project/company).
  db.query(`ALTER TABLE purchase_requisitions ADD COLUMN IF NOT EXISTS pr_type VARCHAR(20) NOT NULL DEFAULT 'project'`, (err) => {
    if (err) console.error('Purchase requisitions pr_type migration error:', err);
  });
  db.query(`ALTER TABLE purchase_requisitions ADD COLUMN IF NOT EXISTS requested_by_email VARCHAR(255) NULL`, (err) => {
    if (err) console.error('Purchase requisitions requested_by_email migration error:', err);
  });
  db.query(`ALTER TABLE purchase_requisitions ADD COLUMN IF NOT EXISTS pdfFilename VARCHAR(255) NULL`, (err) => {
    if (err) console.error('Purchase requisitions pdfFilename migration error:', err);
  });
  addForeignKeyIfMissing(`
    ALTER TABLE purchase_requisitions
    ADD CONSTRAINT chk_purchase_requisitions_project_required
    CHECK (project_id IS NOT NULL) NOT VALID
  `, 'Purchase requisitions project required check');
  db.query(`ALTER TABLE purchase_requisitions ADD COLUMN IF NOT EXISTS submitted_by VARCHAR(255) NULL`, (err) => {
    if (err) console.error('Purchase requisitions submitted_by migration error:', err);
  });
  db.query(`ALTER TABLE purchase_requisitions ADD COLUMN IF NOT EXISTS rfq_emailed_at TIMESTAMP NULL`, (err) => {
    if (err) console.error('Purchase requisitions rfq_emailed_at migration error:', err);
  });
  db.query(`ALTER TABLE purchase_requisitions ADD COLUMN IF NOT EXISTS rfq_emailed_to TEXT NULL`, (err) => {
    if (err) console.error('Purchase requisitions rfq_emailed_to migration error:', err);
  });
  db.query(`ALTER TABLE purchase_requisitions ADD COLUMN IF NOT EXISTS archived boolean NOT NULL DEFAULT false`, (err) => {
    if (err) console.error('Purchase requisitions archived migration error:', err);
  });
  db.query(`ALTER TABLE purchase_requisitions ADD COLUMN IF NOT EXISTS archived_at TIMESTAMP NULL`, (err) => {
    if (err) console.error('Purchase requisitions archived_at migration error:', err);
  });
  db.query(`ALTER TABLE purchase_requisitions ADD COLUMN IF NOT EXISTS rfq_email_count integer NOT NULL DEFAULT 0`, (err) => {
    if (err) console.error('Purchase requisitions rfq_email_count migration error:', err);
  });
  db.query(`ALTER TABLE purchase_requisitions ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMP NULL`, (err) => {
    if (err) console.error('Purchase requisitions submitted_at migration error:', err);
  });
  db.query(`ALTER TABLE purchase_requisitions ADD COLUMN IF NOT EXISTS approved_by VARCHAR(255) NULL`, (err) => {
    if (err) console.error('Purchase requisitions approved_by migration error:', err);
  });
  db.query(`ALTER TABLE purchase_requisitions ADD COLUMN IF NOT EXISTS approved_at TIMESTAMP NULL`, (err) => {
    if (err) console.error('Purchase requisitions approved_at migration error:', err);
  });
  db.query(`ALTER TABLE purchase_requisitions ADD COLUMN IF NOT EXISTS cancelled_by VARCHAR(255) NULL`, (err) => {
    if (err) console.error('Purchase requisitions cancelled_by migration error:', err);
  });
  db.query(`ALTER TABLE purchase_requisitions ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMP NULL`, (err) => {
    if (err) console.error('Purchase requisitions cancelled_at migration error:', err);
  });
  db.query(`ALTER TABLE purchase_requisitions ADD COLUMN IF NOT EXISTS cancel_reason TEXT NULL`, (err) => {
    if (err) console.error('Purchase requisitions cancel_reason migration error:', err);
  });
  db.query(`ALTER TABLE purchase_requisitions ADD COLUMN IF NOT EXISTS draft_pr_number VARCHAR(50) NULL`, (err) => {
    if (err) console.error('Purchase requisitions draft_pr_number migration error:', err);
  });
  db.query(`ALTER TABLE purchase_requisitions ADD COLUMN IF NOT EXISTS approval_comment TEXT`, (err) => {
    if (err) console.error('Purchase requisitions approval_comment migration error:', err);
  });
  addForeignKeyIfMissing(`
    ALTER TABLE purchase_requisitions
    ADD CONSTRAINT fk_purchase_requisitions_company_id
    FOREIGN KEY (company_id) REFERENCES company_registry(id)
    ON UPDATE CASCADE
    ON DELETE SET NULL
  `, 'Purchase requisitions company FK');
  addForeignKeyIfMissing(`
    ALTER TABLE purchase_requisitions
    ADD CONSTRAINT fk_purchase_requisitions_project_id
    FOREIGN KEY (project_id) REFERENCES projects(id)
    ON UPDATE CASCADE
    ON DELETE SET NULL
  `, 'Purchase requisitions project FK');
  db.query(`ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS requisition_id integer NULL`, (err) => {
    if (err) console.error('Purchase orders requisition_id migration error:', err);
  });
  db.query(`ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS quotation_id integer NULL`, (err) => {
    if (err) console.error('Purchase orders quotation_id migration error:', err);
  });
  addForeignKeyIfMissing(`
    ALTER TABLE purchase_orders
    ADD CONSTRAINT fk_purchase_orders_requisition_id
    FOREIGN KEY (requisition_id) REFERENCES purchase_requisitions(id)
    ON UPDATE CASCADE
    ON DELETE SET NULL
  `, 'Purchase orders requisition FK');
  addForeignKeyIfMissing(`
    ALTER TABLE purchase_orders
    ADD CONSTRAINT fk_purchase_orders_quotation_id
    FOREIGN KEY (quotation_id) REFERENCES procurement_quotations(id)
    ON UPDATE CASCADE
    ON DELETE SET NULL
  `, 'Purchase orders quotation FK');

  db.query(`
    CREATE TABLE IF NOT EXISTS purchase_requisition_items (
      id            integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
      pr_id         integer NOT NULL,
      item_name     VARCHAR(255) NOT NULL,
      product_id    integer,
      category      VARCHAR(120),
      warehouse_id  integer,
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
    else {
      console.log('âœ… Table "purchase_requisition_items" ready');
      db.query(`ALTER TABLE purchase_requisition_items ADD COLUMN IF NOT EXISTS product_id integer NULL`, (productColumnErr) => {
        if (productColumnErr) console.error('Purchase requisition items product_id migration error:', productColumnErr);
        else addForeignKeyIfMissing(`
          ALTER TABLE purchase_requisition_items
          ADD CONSTRAINT fk_purchase_requisition_items_product_id
          FOREIGN KEY (product_id) REFERENCES products(id)
          ON UPDATE CASCADE
          ON DELETE SET NULL
        `, 'Purchase requisition items product FK');
      });
      db.query(`ALTER TABLE purchase_requisition_items ADD COLUMN IF NOT EXISTS category VARCHAR(120) NULL`, (categoryErr) => {
        if (categoryErr) console.error('Purchase requisition items category migration error:', categoryErr);
      });
      db.query(`ALTER TABLE purchase_requisition_items ADD COLUMN IF NOT EXISTS warehouse_id integer NULL`, (warehouseColumnErr) => {
        if (warehouseColumnErr) console.error('Purchase requisition items warehouse_id migration error:', warehouseColumnErr);
        else addForeignKeyIfMissing(`
          ALTER TABLE purchase_requisition_items
          ADD CONSTRAINT fk_purchase_requisition_items_warehouse_id
          FOREIGN KEY (warehouse_id) REFERENCES warehouses(id)
          ON UPDATE CASCADE
          ON DELETE SET NULL
        `, 'Purchase requisition items warehouse FK');
      });
    }
  });
  db.query(`
    CREATE TABLE IF NOT EXISTS procurement_quotations (
      id            integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
      quote_number  VARCHAR(50) UNIQUE,
      requisition_id integer NOT NULL,
      vendor_id     integer NOT NULL,
      quote_date    DATE NOT NULL DEFAULT CURRENT_DATE,
      quoted_total  DECIMAL(15,2) NOT NULL DEFAULT 0,
      delivery_days integer NOT NULL DEFAULT 0,
      payment_terms VARCHAR(100),
      warranty_terms VARCHAR(255),
      score         DECIMAL(5,2) NOT NULL DEFAULT 0,
      status        VARCHAR(50) NOT NULL DEFAULT 'draft',
      remarks       TEXT,
      selected_at   TIMESTAMP NULL,
      created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (requisition_id) REFERENCES purchase_requisitions(id) ON DELETE CASCADE,
      FOREIGN KEY (vendor_id) REFERENCES vendors(id)
    )
  `, (err) => {
    if (err) console.error('Procurement quotations table error:', err);
    else     console.log('âœ… Table "procurement_quotations" ready');
  });
  // Tokenized links for the public vendor RFQ portal (one stable link per PR+vendor).
  db.query(`
    CREATE TABLE IF NOT EXISTS rfq_vendor_links (
      id                 integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
      token              VARCHAR(80) NOT NULL UNIQUE,
      requisition_id     integer NOT NULL,
      vendor_id          integer NOT NULL,
      business_entity_id integer NULL,
      deadline           DATE NULL,
      quotation_id       integer NULL,
      submission         TEXT NULL,
      submitted_at       TIMESTAMP NULL,
      created_at         TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (requisition_id, vendor_id),
      FOREIGN KEY (requisition_id) REFERENCES purchase_requisitions(id) ON DELETE CASCADE,
      FOREIGN KEY (vendor_id) REFERENCES vendors(id)
    )
  `, (err) => {
    if (err) console.error('RFQ vendor links table error:', err);
    else     console.log('✅ Table "rfq_vendor_links" ready');
  });
  db.query(`ALTER TABLE procurement_quotations ADD COLUMN IF NOT EXISTS payment_terms VARCHAR(100) NULL`, (err) => {
    if (err) console.error('Procurement quotations payment_terms migration error:', err);
  });
  db.query(`ALTER TABLE procurement_quotations ADD COLUMN IF NOT EXISTS warranty_terms VARCHAR(255) NULL`, (err) => {
    if (err) console.error('Procurement quotations warranty_terms migration error:', err);
  });
  db.query(`ALTER TABLE procurement_quotations ADD COLUMN IF NOT EXISTS selected_at TIMESTAMP NULL`, (err) => {
    if (err) console.error('Procurement quotations selected_at migration error:', err);
  });
  db.query(`ALTER TABLE procurement_quotations ADD COLUMN IF NOT EXISTS draft_quote_number VARCHAR(50) NULL`, (err) => {
    if (err) console.error('Procurement quotations draft_quote_number migration error:', err);
  });
  db.query(`ALTER TABLE procurement_quotations ADD COLUMN IF NOT EXISTS vendor_pdf VARCHAR(255) NULL`, (err) => {
    if (err) console.error('Procurement quotations vendor_pdf migration error:', err);
  });
  db.query(`ALTER TABLE procurement_quotations ADD COLUMN IF NOT EXISTS archived boolean NOT NULL DEFAULT false`, (err) => {
    if (err) console.error('Procurement quotations archived migration error:', err);
  });
  db.query(`ALTER TABLE procurement_quotations ADD COLUMN IF NOT EXISTS archived_at TIMESTAMP NULL`, (err) => {
    if (err) console.error('Procurement quotations archived_at migration error:', err);
  });

  db.query(`
    CREATE TABLE IF NOT EXISTS goods_receipts (
      id            integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
      grn_number    VARCHAR(50) NOT NULL UNIQUE,
      po_id         integer NOT NULL,
      received_date DATE NOT NULL,
      received_by   VARCHAR(100),
      status        text NOT NULL DEFAULT 'draft',
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
      id            integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
      receipt_id    integer NOT NULL,
      po_line_item_id integer,
      product_id    integer,
      warehouse_id  integer,
      received_qty  DECIMAL(12,2) NOT NULL DEFAULT 0,
      notes        TEXT,
      created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (receipt_id) REFERENCES goods_receipts(id) ON DELETE CASCADE,
      FOREIGN KEY (po_line_item_id) REFERENCES po_line_items(id) ON DELETE SET NULL,
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL,
      FOREIGN KEY (warehouse_id) REFERENCES warehouses(id) ON DELETE SET NULL
    )
  `, (err) => {
    if (err) console.error('Goods receipt items table error:', err);
    else     console.log('âœ… Table "goods_receipt_items" ready');
  });
  db.query(`ALTER TABLE goods_receipt_items ADD COLUMN IF NOT EXISTS product_id integer NULL`, (err) => {
    if (err) console.error('Goods receipt items product_id migration error:', err);
  });
  db.query(`ALTER TABLE goods_receipt_items ADD COLUMN IF NOT EXISTS warehouse_id integer NULL`, (err) => {
    if (err) console.error('Goods receipt items warehouse_id migration error:', err);
  });
  db.query(`ALTER TABLE goods_receipts ADD COLUMN IF NOT EXISTS archived boolean NOT NULL DEFAULT false`, (err) => {
    if (err) console.error('Goods receipts archived migration error:', err);
  });
  db.query(`ALTER TABLE goods_receipts ADD COLUMN IF NOT EXISTS archived_at TIMESTAMP NULL`, (err) => {
    if (err) console.error('Goods receipts archived_at migration error:', err);
  });

  db.query(`
    CREATE TABLE IF NOT EXISTS inventory_requests (
      id integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
      request_no VARCHAR(50) NOT NULL UNIQUE,
      request_type VARCHAR(30) NOT NULL,
      payload TEXT NOT NULL,
      status VARCHAR(30) NOT NULL DEFAULT 'draft',
      requested_by VARCHAR(255),
      requested_by_email VARCHAR(255),
      submitted_at TIMESTAMP NULL DEFAULT NULL,
      approved_by VARCHAR(255),
      approved_at TIMESTAMP NULL DEFAULT NULL,
      reject_reason TEXT,
      approval_comment TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `, (err) => {
    if (err) console.error('Inventory requests table error:', err);
    else console.log('Table "inventory_requests" ready');
  });
  db.query(`ALTER TABLE inventory_requests ADD COLUMN IF NOT EXISTS approval_comment TEXT`, (err) => {
    if (err) console.error('Inventory requests approval_comment migration error:', err);
  });

  db.query(`
    INSERT INTO chart_of_accounts (account_code, account_name, account_type)
    VALUES
      ('1000', 'Cash and Cash Equivalents', 'asset'),
      ('1100', 'Accounts Receivable', 'asset'),
      ('2000', 'Accounts Payable', 'liability'),
      ('3000', 'Owner''s Equity', 'equity'),
      ('4000', 'Service Revenue', 'revenue'),
      ('5000', 'Operating Expenses', 'expense')
    ON CONFLICT DO NOTHING
  `, (err) => {
    if (err) console.error('Seed chart of accounts error:', err);
  });

  addIndexIfMissing('CREATE INDEX IF NOT EXISTS idx_vendors_vendor_name ON vendors (vendor_name)', 'vendors.vendor_name');
  addIndexIfMissing('CREATE UNIQUE INDEX IF NOT EXISTS idx_vendors_vendor_no ON vendors (vendor_no)', 'vendors.vendor_no');
  addIndexIfMissing('CREATE INDEX IF NOT EXISTS idx_projects_project_name ON projects (project_name)', 'projects.project_name');
  addIndexIfMissing('CREATE INDEX IF NOT EXISTS idx_purchase_orders_po_date ON purchase_orders (po_date)', 'purchase_orders.po_date');
  addIndexIfMissing('CREATE INDEX IF NOT EXISTS idx_purchase_orders_project_id ON purchase_orders (project_id)', 'purchase_orders.project_id');
  addIndexIfMissing('CREATE INDEX IF NOT EXISTS idx_accounts_payable_bill_date_created_at ON accounts_payable (bill_date, created_at)', 'accounts_payable bill date');
  addIndexIfMissing('CREATE INDEX IF NOT EXISTS idx_accounts_payable_project_id ON accounts_payable (project_id)', 'accounts_payable.project_id');
  addIndexIfMissing('CREATE INDEX IF NOT EXISTS idx_accounts_receivable_invoice_date_created_at ON accounts_receivable (invoice_date, created_at)', 'accounts_receivable invoice date');
  addIndexIfMissing('CREATE INDEX IF NOT EXISTS idx_sales_records_type_created_at ON sales_management_records (record_type, created_at DESC)', 'sales records type');
  addIndexIfMissing('CREATE INDEX IF NOT EXISTS idx_sales_records_company_id ON sales_management_records (company_id)', 'sales records company');
  addIndexIfMissing('CREATE INDEX IF NOT EXISTS idx_sales_records_project_id ON sales_management_records (project_id)', 'sales records project');
  addIndexIfMissing('CREATE INDEX IF NOT EXISTS idx_purchase_requisitions_created_at ON purchase_requisitions (created_at)', 'purchase_requisitions.created_at');
  addIndexIfMissing('CREATE INDEX IF NOT EXISTS idx_purchase_requisitions_project_id ON purchase_requisitions (project_id)', 'purchase_requisitions.project_id');
  addIndexIfMissing('CREATE UNIQUE INDEX IF NOT EXISTS uniq_purchase_orders_requisition_id ON purchase_orders (requisition_id) WHERE requisition_id IS NOT NULL', 'purchase_orders.requisition_id unique conversion');
  addIndexIfMissing('CREATE INDEX IF NOT EXISTS idx_purchase_orders_quotation_id ON purchase_orders (quotation_id)', 'purchase_orders.quotation_id');
  addIndexIfMissing('CREATE INDEX IF NOT EXISTS idx_procurement_quotations_requisition_id ON procurement_quotations (requisition_id)', 'procurement_quotations.requisition_id');
  addIndexIfMissing('CREATE UNIQUE INDEX IF NOT EXISTS uniq_procurement_quotations_requisition_vendor ON procurement_quotations (requisition_id, vendor_id)', 'procurement_quotations requisition vendor unique');
  addIndexIfMissing('CREATE INDEX IF NOT EXISTS idx_documents_module_record ON documents (module_name, record_id, uploaded_at DESC)', 'documents module record');
  addIndexIfMissing('CREATE INDEX IF NOT EXISTS idx_goods_receipts_received_date ON goods_receipts (received_date)', 'goods_receipts.received_date');
  addIndexIfMissing('CREATE INDEX IF NOT EXISTS idx_journal_entries_created_at ON journal_entries (created_at)', 'journal_entries.created_at');
  setTimeout(() => addRelationshipIntegrityConstraints(), 1500);
  setTimeout(() => backfillVendorNumbers(), 2000);
  // Legacy cleanup: drop retired tables after schema init completes (idempotent).
  setTimeout(() => { dropLegacyTables().catch((err) => console.error('Legacy table cleanup error:', err)); }, 3500);
  setTimeout(() => {
    syncPostgresIdentitySequences().catch((err) => {
      console.error('PostgreSQL identity sequence sync error:', err);
    });
  }, 2500);
  setTimeout(() => {
    syncDocumentSequencesToExistingRecords().catch((err) => {
      console.error('Document sequence sync error:', err);
    });
  }, 3000);
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

// Audit value formatter — shows ∅ for empty and trims very long values so a log line stays readable.
function auditVal(v) {
  if (v == null || v === '') return '∅';
  const s = String(v);
  return s.length > 80 ? `${s.slice(0, 77)}…` : s;
}

// Normalize a change set into a human-readable "field: from → to; ..." string. Accepts either an
// array of { field, from, to }, an object map { field: [from, to] } / { field: { from, to } },
// or an already-formatted string.
function formatAuditChanges(changes) {
  if (!changes) return '';
  if (typeof changes === 'string') return changes.trim();
  let list = changes;
  if (!Array.isArray(list)) {
    list = Object.keys(list).map((k) => {
      const v = list[k];
      const pair = Array.isArray(v) ? { from: v[0], to: v[1] } : (v || {});
      return { field: k, from: pair.from, to: pair.to };
    });
  }
  return list
    .filter((c) => c && c.field)
    .map((c) => `${c.field}: ${auditVal(c.from)} → ${auditVal(c.to)}`)
    .join('; ');
}

// logAction(req, action, details, moduleName?, meta?)
//   meta = { entityType, entityId, businessEntityId, changes, severity }
// `changes` records WHAT changed (before → after); the rest links the log to a specific record +
// workspace and flags severity. All optional — legacy 4-arg calls keep working unchanged.
function logAction(req, action, details, moduleName = '', meta = {}) {
  const actor = getAuthenticatedUser(req);
  const userId = actor ? actor.id : null;
  const auditModule = String(moduleName || inferAuditModule(action) || '').trim().toLowerCase() || null;
  const clientIp = getClientIp(req);
  const actorName = actor
    ? String(actor.fullname || actor.username || `User #${actor.id || ''}`).trim()
    : 'System';
  const actorRole = formatAccessRoleLabel(actor?.role || 'user');
  const m = meta || {};
  const changedFields = formatAuditChanges(m.changes) || null;
  const severity = ['info', 'warning', 'critical'].includes(String(m.severity || '').toLowerCase())
    ? String(m.severity).toLowerCase() : 'info';
  const entityType = String(m.entityType || '').trim().toLowerCase() || null;
  const entityId = Number(m.entityId) > 0 ? Number(m.entityId) : null;
  const businessEntityId = Number(m.businessEntityId) > 0 ? Number(m.businessEntityId) : null;
  const baseDetails = String(details || '').trim();
  // Echo the diff into details too, so the existing System Logs UI shows it without UI changes.
  const fullDetails = changedFields ? `${baseDetails}${baseDetails ? ' — ' : ''}Changes: ${changedFields}` : baseDetails;
  const auditDetails = `[Actor: ${actorName} | Role: ${actorRole}] ${fullDetails}`.trim();
  const sql = 'INSERT INTO system_logs (user_id, module, action, details, ip_address, entity_type, entity_id, business_entity_id, changed_fields, severity) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)';
  const params = [userId, auditModule, action, auditDetails, clientIp, entityType, entityId, businessEntityId, changedFields, severity];
  const insertLog = (hasRetried = false) => {
    db.query(sql, params, (err) => {
      if (!err) return;
      if (isPostgresUniqueViolation(err) && !hasRetried) {
        syncPostgresIdentitySequence('system_logs').then(() => insertLog(true)).catch((syncErr) => {
          console.error('Logging sequence sync error:', syncErr);
          console.error('Logging error:', err);
        });
        return;
      }
      console.error('Logging error:', err);
    });
  };
  insertLog();
}

// Audit a rejected sign-in attempt. No authenticated actor yet, so the attempted username is the
// key forensic detail. A lockout is flagged 'critical'; a plain miss is 'warning'.
function auditLoginFailure(req, username, lockState, reason) {
  const locked = !!(lockState && lockState.locked);
  const remaining = lockState && typeof lockState.attemptsRemaining === 'number' ? lockState.attemptsRemaining : null;
  const tail = locked
    ? ' — account temporarily locked'
    : (remaining != null ? ` — ${remaining} attempt(s) left` : '');
  logAction(req, locked ? 'LOGIN_LOCKED' : 'LOGIN_FAILED',
    `Failed login for "${String(username || '').trim() || '(blank)'}"${reason ? ` — ${reason}` : ''}${tail}`,
    'auth', { severity: locked ? 'critical' : 'warning' });
}

function getApprovalComment(req) {
  return String(req.body?.comment || req.body?.approval_comment || '').trim();
}

function appendApprovalComment(details, comment) {
  const safeComment = String(comment || '').trim();
  return safeComment ? `${details} | Comment: ${safeComment}` : details;
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

function generateDraftRequestNo(prefix) {
  return new Promise((resolve, reject) => {
    const prefixUpper = String(prefix || 'REQ').toUpperCase();
    // Count BOTH draft (DRAFT-CMP-NNN) and already-official (CMP-NNN) numbers so a
    // staff draft and an admin-created official never collide on the same sequence.
    db.query(
      `SELECT COALESCE(MAX(CAST(regexp_replace(request_no, '^(DRAFT-)?[A-Z]+-', '') AS integer)), 0) AS max_seq
       FROM company_registry_requests
       WHERE request_no ~ ?
       UNION ALL
       SELECT COALESCE(MAX(CAST(regexp_replace(request_no, '^(DRAFT-)?[A-Z]+-', '') AS integer)), 0) AS max_seq
       FROM vendor_registry_requests
       WHERE request_no ~ ?`,
      [`^(DRAFT-)?${prefixUpper}-[0-9]+$`, `^(DRAFT-)?${prefixUpper}-[0-9]+$`],
      (err, rows) => {
        if (err) return reject(err);
        const maxSeq = Math.max(...(rows || []).map(r => Number(r?.max_seq || 0)));
        const nextNum = maxSeq + 1;
        resolve(`DRAFT-${prefixUpper}-${String(nextNum).padStart(3, '0')}`);
      }
    );
  });
}

// On approval a staff DRAFT-<PREFIX>-NNN request number becomes its official
// form by dropping the DRAFT- prefix (e.g. DRAFT-CMP-002 -> CMP-002).
function stripDraftRequestNoPrefix(requestNo) {
  const value = String(requestNo || '').trim();
  return /^DRAFT-/i.test(value) ? value.replace(/^DRAFT-/i, '') : value;
}

function generateInventoryDraftRequestNo() {
  return new Promise((resolve, reject) => {
    // Count both DRAFT-INV-NNN and official INV-NNN so drafts and admin-created
    // official requests never collide on the same sequence number.
    db.query(
      `SELECT COALESCE(MAX(CAST(regexp_replace(request_no, '^(DRAFT-)?INV-', '') AS integer)), 0) AS max_seq
       FROM inventory_requests
       WHERE request_no ~ ?`,
      ['^(DRAFT-)?INV-[0-9]+$'],
      (err, rows) => {
        if (err) return reject(err);
        const nextNum = (Number(rows?.[0]?.max_seq || 0) || 0) + 1;
        resolve(`DRAFT-INV-${String(nextNum).padStart(3, '0')}`);
      }
    );
  });
}



// queryAsync now lives in src/database (imported at top).

function withDbTransaction(work) {
  return new Promise((resolve, reject) => {
    db.getConnection((connErr, connection) => {
      if (connErr) return reject(connErr);

      let settled = false;
      const finish = (err, value) => {
        if (settled) return;
        settled = true;
        if (typeof connection.release === 'function') connection.release();
        if (err) reject(err);
        else resolve(value);
      };

      connection.beginTransaction(async (beginErr) => {
        if (beginErr) return finish(beginErr);
        try {
          const value = await work(connection);
          connection.commit((commitErr) => finish(commitErr, value));
        } catch (err) {
          connection.rollback(() => finish(err));
        }
      });
    });
  });
}

function formatArchiveCenterDate(...values) {
  const value = values.find((entry) => entry !== undefined && entry !== null && String(entry).trim() !== '');
  if (!value) return '';
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  const text = String(value).trim();
  const parsed = new Date(text);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  return text.slice(0, 10);
}

function joinArchiveCenterText(...parts) {
  return parts
    .map((part) => String(part || '').trim())
    .filter(Boolean)
    .join(' - ');
}

// Drops tables for features that were retired from the app (Transactions / "Project Records",
// HR, Service Orders). Idempotent (IF EXISTS), runs once after schema init. The transaction_id /
// service_order columns + their code were removed app-wide, so nothing references these tables.
// KEEP: chart_of_accounts / journal_entries / journal_lines — AP/AR still auto-post journals there.
async function dropLegacyTables() {
  const drops = [
    'DROP TABLE IF EXISTS payroll_run_lines CASCADE',
    'DROP TABLE IF EXISTS payroll_runs CASCADE',
    'DROP TABLE IF EXISTS payroll_periods CASCADE',
    'DROP TABLE IF EXISTS employees CASCADE',
    'DROP TABLE IF EXISTS departments CASCADE',
    'DROP TABLE IF EXISTS service_orders CASCADE',
    'DROP TABLE IF EXISTS transactions CASCADE'
  ];
  for (const sql of drops) {
    try { await queryAsync(sql); } catch (err) { console.error('dropLegacyTables:', sql, '-', err.message); }
  }
  console.log('✅ Legacy tables dropped (transactions, service_orders, HR).');
}

async function syncPostgresIdentitySequences() {
  const tables = [
    'business_entities',
    'users',
    'vendors',
    'company_registry',
    'purchase_orders',
    'po_line_items',
    'accounts_payable',
    'accounts_receivable',
    'payments',
    'projects',
    'system_logs',
    'tasks',
    'project_costs',
    'project_resources',
    'chart_of_accounts',
    'accounting_periods',
    'journal_entries',
    'journal_lines',
    'purchase_requisitions',
    'purchase_requisition_items',
    'goods_receipts',
    'goods_receipt_items'
  ];

  for (const tableName of tables) {
    await syncPostgresIdentitySequence(tableName);
  }
}

async function syncPostgresIdentitySequence(tableName) {
  if (!/^[a-z_][a-z0-9_]*$/.test(tableName)) return;
  try {
    await queryAsync(`
      SELECT setval(
        pg_get_serial_sequence('${tableName}', 'id'),
        GREATEST(COALESCE((SELECT MAX(id) FROM ${tableName}), 0) + 1, 1),
        false
      )
      WHERE pg_get_serial_sequence('${tableName}', 'id') IS NOT NULL
    `);
  } catch (err) {
    if (!(isPostgresUndefinedTable(err) || isPostgresUndefinedColumn(err))) {
      console.error(`PostgreSQL identity sequence sync warning (${tableName}):`, err);
    }
  }
}

function normalizeBusinessEntityId(value) {
  const id = Number(value || 0);
  return Number.isInteger(id) && id > 0 ? id : null;
}

async function getDefaultBusinessEntityId() {
  const defaultRows = await queryAsync(
    "SELECT id FROM business_entities WHERE is_default = TRUE AND status = 'active' ORDER BY id ASC LIMIT 1"
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
    'purchase_requisitions',
    'purchase_orders',
    'procurement_quotations',
    'goods_receipts',
    'accounts_payable',
    'sales_management_records'
  ]);
  const safeColumns = new Set([
    'project_docno',
    'docno',
    'pr_number',
    'po_number',
    'quote_number',
    'grn_number',
    'bill_number',
    'document_no'
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

  const existingRows = tableName === 'procurement_quotations'
    ? await queryDbAsync(
        dbClient,
        `SELECT COALESCE(MAX(CAST(split_part(q.${columnName}, '-', array_length(string_to_array(q.${columnName}, '-'), 1)) AS integer)), 0) AS max_no
         FROM procurement_quotations q
         JOIN purchase_requisitions pr ON pr.id = q.requisition_id
         WHERE pr.business_entity_id ${resolvedEntityId ? '= ?' : 'IS NULL'}
           AND q.${columnName} LIKE ?`,
        resolvedEntityId ? [resolvedEntityId, `${codePrefix}-%`] : [`${codePrefix}-%`]
      )
    : tableName === 'goods_receipts'
    ? await queryDbAsync(
        dbClient,
        `SELECT COALESCE(MAX(CAST(split_part(gr.${columnName}, '-', array_length(string_to_array(gr.${columnName}, '-'), 1)) AS integer)), 0) AS max_no
         FROM goods_receipts gr
         JOIN purchase_orders po ON po.id = gr.po_id
         WHERE po.business_entity_id ${resolvedEntityId ? '= ?' : 'IS NULL'}
           AND gr.${columnName} LIKE ?`,
        resolvedEntityId ? [resolvedEntityId, `${codePrefix}-%`] : [`${codePrefix}-%`]
      )
    : await queryDbAsync(
        dbClient,
        `SELECT COALESCE(MAX(CAST(split_part(${columnName}, '-', array_length(string_to_array(${columnName}, '-'), 1)) AS integer)), 0) AS max_no
         FROM ${tableName}
         WHERE ${columnName} LIKE ?`,
        [`${codePrefix}-%`]
      );
  const initialValue = Number(existingRows?.[0]?.max_no || 0) + 1;

  try {
    const sequenceRows = await queryDbAsync(
      dbClient,
      `INSERT INTO document_sequences (sequence_key, period_key, last_value)
       VALUES (?, ?, ?)
       ON CONFLICT (sequence_key, period_key)
       DO UPDATE SET last_value = GREATEST(document_sequences.last_value, EXCLUDED.last_value - 1) + 1
       RETURNING last_value`,
      [sequenceKey, period, initialValue]
    );
    const sequenceValue = Number(sequenceRows?.[0]?.last_value || initialValue) || initialValue;
    return `${codePrefix}-${String(sequenceValue).padStart(pad, '0')}`;
  } catch (err) {
    if (!isPostgresUndefinedTable(err)) throw err;
  }

  return `${codePrefix}-${String(initialValue).padStart(pad, '0')}`;
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
    'purchase_requisitions',
    'purchase_orders',
    'procurement_quotations',
    'goods_receipts',
    'accounts_payable',
    'sales_management_records'
  ]);
  const safeColumns = new Set([
    'project_docno',
    'docno',
    'pr_number',
    'po_number',
    'quote_number',
    'grn_number',
    'bill_number',
    'document_no'
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

  const existingRows = tableName === 'procurement_quotations'
    ? await queryDbAsync(
        dbClient,
        `SELECT COALESCE(MAX(CAST(split_part(q.${columnName}, '-', array_length(string_to_array(q.${columnName}, '-'), 1)) AS integer)), 0) AS max_no
         FROM procurement_quotations q
         JOIN purchase_requisitions pr ON pr.id = q.requisition_id
         WHERE pr.business_entity_id ${resolvedEntityId ? '= ?' : 'IS NULL'}
           AND q.${columnName} LIKE ?`,
        resolvedEntityId ? [resolvedEntityId, `${codePrefix}-%`] : [`${codePrefix}-%`]
      )
    : tableName === 'goods_receipts'
    ? await queryDbAsync(
        dbClient,
        `SELECT COALESCE(MAX(CAST(split_part(gr.${columnName}, '-', array_length(string_to_array(gr.${columnName}, '-'), 1)) AS integer)), 0) AS max_no
         FROM goods_receipts gr
         JOIN purchase_orders po ON po.id = gr.po_id
         WHERE po.business_entity_id ${resolvedEntityId ? '= ?' : 'IS NULL'}
           AND gr.${columnName} LIKE ?`,
        resolvedEntityId ? [resolvedEntityId, `${codePrefix}-%`] : [`${codePrefix}-%`]
      )
    : await queryDbAsync(
        dbClient,
        `SELECT COALESCE(MAX(CAST(split_part(${columnName}, '-', array_length(string_to_array(${columnName}, '-'), 1)) AS integer)), 0) AS max_no
         FROM ${tableName}
         WHERE ${columnName} LIKE ?`,
        [`${codePrefix}-%`]
      );
  const sequenceRows = await queryDbAsync(
    dbClient,
    'SELECT last_value FROM document_sequences WHERE sequence_key = ? AND period_key = ? LIMIT 1',
    [sequenceKey, period]
  ).catch((err) => {
    if (!isPostgresUndefinedTable(err)) throw err;
    return [];
  });
  const maxExisting = Number(existingRows?.[0]?.max_no || 0) || 0;
  const maxClaimed = Number(sequenceRows?.[0]?.last_value || 0) || 0;
  const nextNum = Math.max(maxExisting, maxClaimed) + 1;
  return `${codePrefix}-${String(nextNum).padStart(pad, '0')}`;
}

async function generateNextDraftEntityDocumentNo({
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
    'purchase_requisitions',
    'purchase_orders',
    'procurement_quotations',
    'accounts_payable',
    'accounts_receivable',
    'sales_management_records'
  ]);
  const safeColumns = new Set([
    'pr_number',
    'po_number',
    'quote_number',
    'bill_number',
    'invoice_number',
    'document_no'
  ]);
  if (!safeTables.has(tableName) || !safeColumns.has(columnName)) {
    throw new Error('Invalid draft document sequence target.');
  }

  const entity = await getBusinessEntitySequenceCode(businessEntityId, dbClient);
  const resolvedEntityId = entity.id || await getDefaultBusinessEntityId();
  const docPrefix = String(prefix || documentType || 'DOC').replace(/[^a-z0-9]/gi, '').toUpperCase();
  const period = String(periodKey || getManilaYmd().slice(0, 4)).replace(/[^0-9]/g, '').slice(0, 8) || getManilaYmd().slice(0, 4);
  const codePrefix = `DFT-${docPrefix}-${entity.code}-${period}`;
  const sequenceKey = `draft-${String(documentType || docPrefix).toLowerCase()}:${resolvedEntityId || 'default'}`;
  const existingRows = tableName === 'procurement_quotations'
    ? await queryDbAsync(
        dbClient,
        `SELECT COALESCE(MAX(CAST(split_part(q.${columnName}, '-', array_length(string_to_array(q.${columnName}, '-'), 1)) AS integer)), 0) AS max_no
         FROM procurement_quotations q
         JOIN purchase_requisitions pr ON pr.id = q.requisition_id
         WHERE pr.business_entity_id ${resolvedEntityId ? '= ?' : 'IS NULL'}
           AND q.${columnName} LIKE ?`,
        resolvedEntityId ? [resolvedEntityId, `${codePrefix}-%`] : [`${codePrefix}-%`]
      )
    : await queryDbAsync(
        dbClient,
        `SELECT COALESCE(MAX(CAST(split_part(${columnName}, '-', array_length(string_to_array(${columnName}, '-'), 1)) AS integer)), 0) AS max_no
         FROM ${tableName}
         WHERE ${columnName} LIKE ?`,
        [`${codePrefix}-%`]
      );
  let nextNo = Number(existingRows?.[0]?.max_no || 0) + 1;
  try {
    const rows = await queryDbAsync(
      dbClient,
      `INSERT INTO document_sequences (sequence_key, period_key, last_value)
       VALUES (?, ?, ?)
       ON CONFLICT (sequence_key, period_key)
       DO UPDATE SET last_value = GREATEST(document_sequences.last_value, ?) + 1
       RETURNING last_value`,
      [sequenceKey, period, nextNo, Number(existingRows?.[0]?.max_no || 0) || 0]
    );
    nextNo = Number(rows?.[0]?.last_value || nextNo) || nextNo;
  } catch (err) {
    if (!isPostgresUndefinedTable(err)) throw err;
  }
  return `${codePrefix}-${String(nextNo).padStart(pad, '0')}`;
}

async function peekNextDraftEntityDocumentNo(options = {}) {
  const generated = await generateNextDraftEntityDocumentNo(options);
  const match = generated.match(/^(.*-)(\d+)$/);
  if (!match) return generated;
  await queryAsync(
    `UPDATE document_sequences
     SET last_value = GREATEST(0, last_value - 1)
     WHERE sequence_key = ? AND period_key = ?`,
    [
      `draft-${String(options.documentType || options.prefix || 'DOC').toLowerCase()}:${(await getBusinessEntitySequenceCode(options.businessEntityId, options.dbClient)).id || await getDefaultBusinessEntityId() || 'default'}`,
      String(options.periodKey || getManilaYmd().slice(0, 4)).replace(/[^0-9]/g, '').slice(0, 8) || getManilaYmd().slice(0, 4)
    ]
  ).catch(() => {});
  return generated;
}

function isDraftDocumentNo(value) {
  return /^DFT-/i.test(String(value || '').trim());
}

async function claimEntityDocumentNo({
  businessEntityId,
  documentType,
  prefix,
  documentNo,
  dbClient = null,
  periodKey = getManilaYmd().slice(0, 4)
}) {
  const value = String(documentNo || '').trim();
  if (!value) return;

  const entity = await getBusinessEntitySequenceCode(businessEntityId, dbClient);
  const resolvedEntityId = entity.id || await getDefaultBusinessEntityId();
  const docPrefix = String(prefix || documentType || 'DOC').replace(/[^a-z0-9]/gi, '').toUpperCase();
  const period = String(periodKey || getManilaYmd().slice(0, 4)).replace(/[^0-9]/g, '').slice(0, 8) || getManilaYmd().slice(0, 4);
  const codePrefix = `${docPrefix}-${entity.code}-${period}`;
  if (!value.toUpperCase().startsWith(`${codePrefix}-`.toUpperCase())) return;

  const lastPart = value.split('-').pop();
  const sequenceValue = Number(lastPart || 0) || 0;
  if (!sequenceValue) return;

  const sequenceKey = `${String(documentType || docPrefix).toLowerCase()}:${resolvedEntityId || 'default'}`;
  await queryDbAsync(
    dbClient,
    `INSERT INTO document_sequences (sequence_key, period_key, last_value)
     VALUES (?, ?, ?)
     ON CONFLICT (sequence_key, period_key)
     DO UPDATE SET last_value = GREATEST(document_sequences.last_value, EXCLUDED.last_value)
     RETURNING last_value`,
    [sequenceKey, period, sequenceValue]
  );
}

async function syncDocumentSequencesToExistingRecords() {
  const targets = [
    { documentType: 'purchase-requisition', prefix: 'PR', tableName: 'purchase_requisitions', columnName: 'pr_number' },
    { documentType: 'purchase-order', prefix: 'PO', tableName: 'purchase_orders', columnName: 'po_number' },
    { documentType: 'procurement-quotation', prefix: 'RFQ', tableName: 'procurement_quotations', columnName: 'quote_number' },
    { documentType: 'goods-receipt', prefix: 'GRN', tableName: 'goods_receipts', columnName: 'grn_number' },
    { documentType: 'ap-bill', prefix: 'BILL', tableName: 'accounts_payable', columnName: 'bill_number' }
  ];
  const entityRows = await queryAsync('SELECT id FROM business_entities ORDER BY id ASC');

  for (const entityRow of entityRows || []) {
    const businessEntityId = Number(entityRow.id || 0) || null;
    if (!businessEntityId) continue;
    const entity = await getBusinessEntitySequenceCode(businessEntityId);

    for (const target of targets) {
      const docPrefix = String(target.prefix || '').toUpperCase();
      const codePrefix = `${docPrefix}-${entity.code}-`;
      const rows = target.tableName === 'procurement_quotations'
        ? await queryAsync(
            `SELECT q.${target.columnName} AS document_no
             FROM procurement_quotations q
             JOIN purchase_requisitions pr ON pr.id = q.requisition_id
             WHERE pr.business_entity_id = ?
               AND q.${target.columnName} LIKE ?`,
            [businessEntityId, `${codePrefix}%`]
          )
        : target.tableName === 'goods_receipts'
        ? await queryAsync(
            `SELECT gr.${target.columnName} AS document_no
             FROM goods_receipts gr
             JOIN purchase_orders po ON po.id = gr.po_id
             WHERE po.business_entity_id = ?
               AND gr.${target.columnName} LIKE ?`,
            [businessEntityId, `${codePrefix}%`]
          )
        : await queryAsync(
            `SELECT ${target.columnName} AS document_no
             FROM ${target.tableName}
             WHERE business_entity_id = ?
               AND ${target.columnName} LIKE ?`,
            [businessEntityId, `${codePrefix}%`]
          );

      const maxByPeriod = new Map();
      const pattern = new RegExp(`^${docPrefix}-${entity.code}-(\\d{4,8})-(\\d+)$`, 'i');
      for (const row of rows || []) {
        const match = pattern.exec(String(row.document_no || '').trim());
        if (!match) continue;
        const period = match[1];
        const sequenceValue = Number(match[2] || 0) || 0;
        if (!sequenceValue) continue;
        maxByPeriod.set(period, Math.max(maxByPeriod.get(period) || 0, sequenceValue));
      }

      const sequenceKey = `${target.documentType}:${businessEntityId}`;
      const sequenceRows = await queryAsync(
        'SELECT period_key FROM document_sequences WHERE sequence_key = ?',
        [sequenceKey]
      );
      for (const row of sequenceRows || []) {
        const periodKey = String(row.period_key || '').trim();
        if (!periodKey || maxByPeriod.has(periodKey)) continue;
        await queryAsync(
          'UPDATE document_sequences SET last_value = 0, updated_at = CURRENT_TIMESTAMP WHERE sequence_key = ? AND period_key = ?',
          [sequenceKey, periodKey]
        );
      }

      for (const [period, maxValue] of maxByPeriod.entries()) {
        await queryAsync(
          `INSERT INTO document_sequences (sequence_key, period_key, last_value)
           VALUES (?, ?, ?)
           ON CONFLICT (sequence_key, period_key)
           DO UPDATE SET last_value = EXCLUDED.last_value
           RETURNING last_value`,
          [sequenceKey, period, maxValue]
        );
      }
    }
  }
}

async function getProjectDocnoSequenceState(businessEntityId = null, dbClient = null) {
  const resolvedBusinessEntityId = normalizeBusinessEntityId(businessEntityId) || await getDefaultBusinessEntityId();
  const entity = await getBusinessEntitySequenceCode(resolvedBusinessEntityId, dbClient);
  const year = getManilaYmd().slice(0, 4);
  const period = year;
  // Project ID format: PRJ_<entityCode>-<year><5-digit seq>, e.g. PRJ_KVSK-202600001
  const prefix = `PRJ_${entity.code}-${year}`;
  const sequenceKey = `project-docno:${resolvedBusinessEntityId || 'default'}`;
  // Sequence = digits after the PRJ_<code>-<year> head; ~ regex so the literal
  // underscore is matched exactly (LIKE would treat _ as a wildcard).
  const docnoPattern = `^PRJ_${entity.code}-${year}[0-9]+$`;
  const params = resolvedBusinessEntityId
    ? [resolvedBusinessEntityId, docnoPattern]
    : [docnoPattern];
  const projectRows = await queryDbAsync(
    dbClient,
    `SELECT COALESCE(MAX(CAST(regexp_replace(project_docno, '^PRJ_[A-Za-z0-9]+-[0-9]{4}', '') AS integer)), 0) AS max_no
     FROM projects
     WHERE business_entity_id ${resolvedBusinessEntityId ? '= ?' : 'IS NULL'}
       AND project_docno ~ ?`,
    params
  );
  let sequenceMax = 0;
  try {
    const sequenceRows = await queryDbAsync(
      dbClient,
      'SELECT COALESCE(last_value, 0) AS last_value FROM document_sequences WHERE sequence_key = ? AND period_key = ? LIMIT 1',
      [sequenceKey, period]
    );
    sequenceMax = Number(sequenceRows?.[0]?.last_value || 0) || 0;
  } catch (err) {
    if (!isPostgresUndefinedTable(err)) throw err;
  }

  return {
    period,
    prefix,
    sequenceKey,
    tableMax: Number(projectRows?.[0]?.max_no || 0) || 0,
    sequenceMax
  };
}

async function getDraftProjectDocnoSequenceState(businessEntityId = null, dbClient = null) {
  const resolvedBusinessEntityId = normalizeBusinessEntityId(businessEntityId) || await getDefaultBusinessEntityId();
  const period = getProjectMonthKey(new Date());
  const prefix = `DFT-${period}`;
  const sequenceKey = `project-draft-docno:${resolvedBusinessEntityId || 'default'}`;
  const params = resolvedBusinessEntityId
    ? [resolvedBusinessEntityId, `${prefix}-%`]
    : [`${prefix}-%`];
  const projectRows = await queryDbAsync(
    dbClient,
    `SELECT COALESCE(MAX(CAST(split_part(draft_docno, '-', array_length(string_to_array(draft_docno, '-'), 1)) AS integer)), 0) AS max_no
     FROM projects
     WHERE business_entity_id ${resolvedBusinessEntityId ? '= ?' : 'IS NULL'}
       AND draft_docno LIKE ?`,
    params
  );
  let sequenceMax = 0;
  try {
    const sequenceRows = await queryDbAsync(
      dbClient,
      'SELECT COALESCE(last_value, 0) AS last_value FROM document_sequences WHERE sequence_key = ? AND period_key = ? LIMIT 1',
      [sequenceKey, period]
    );
    sequenceMax = Number(sequenceRows?.[0]?.last_value || 0) || 0;
  } catch (err) {
    if (!isPostgresUndefinedTable(err)) throw err;
  }

  return {
    period,
    prefix,
    sequenceKey,
    tableMax: Number(projectRows?.[0]?.max_no || 0) || 0,
    sequenceMax
  };
}

async function peekNextProjectDocnoAsync(businessEntityId = null, dbClient = null) {
  const state = await getProjectDocnoSequenceState(businessEntityId, dbClient);
  const nextNo = Math.max(state.tableMax, state.sequenceMax) + 1;
  // prefix already ends with the year; the 5-digit seq is appended with no separator.
  return `${state.prefix}${String(nextNo).padStart(5, '0')}`;
}

async function peekNextDraftProjectDocnoAsync(businessEntityId = null, dbClient = null) {
  const state = await getDraftProjectDocnoSequenceState(businessEntityId, dbClient);
  const nextNo = Math.max(state.tableMax, state.sequenceMax) + 1;
  return `${state.prefix}-${String(nextNo).padStart(2, '0')}`;
}

async function generateNextProjectDocnoAsync(businessEntityId = null, dbClient = null) {
  const state = await getProjectDocnoSequenceState(businessEntityId, dbClient);
  let nextNo = Math.max(state.tableMax, state.sequenceMax) + 1;

  try {
    const rows = await queryDbAsync(
      dbClient,
      `INSERT INTO document_sequences (sequence_key, period_key, last_value)
       VALUES (?, ?, ?)
       ON CONFLICT (sequence_key, period_key)
       DO UPDATE SET last_value = GREATEST(document_sequences.last_value, ?) + 1
       RETURNING last_value`,
      [state.sequenceKey, state.period, nextNo, state.tableMax]
    );
    nextNo = Number(rows?.[0]?.last_value || nextNo) || nextNo;
  } catch (err) {
    if (!isPostgresUndefinedTable(err)) throw err;
  }

  return `${state.prefix}${String(nextNo).padStart(5, '0')}`;
}

async function generateNextDraftProjectDocnoAsync(businessEntityId = null, dbClient = null) {
  const state = await getDraftProjectDocnoSequenceState(businessEntityId, dbClient);
  let nextNo = Math.max(state.tableMax, state.sequenceMax) + 1;

  try {
    const rows = await queryDbAsync(
      dbClient,
      `INSERT INTO document_sequences (sequence_key, period_key, last_value)
       VALUES (?, ?, ?)
       ON CONFLICT (sequence_key, period_key)
       DO UPDATE SET last_value = GREATEST(document_sequences.last_value, ?) + 1
       RETURNING last_value`,
      [state.sequenceKey, state.period, nextNo, state.tableMax]
    );
    nextNo = Number(rows?.[0]?.last_value || nextNo) || nextNo;
  } catch (err) {
    if (!isPostgresUndefinedTable(err)) throw err;
  }

  return `${state.prefix}-${String(nextNo).padStart(2, '0')}`;
}

function peekNextProjectDocno(callback, businessEntityId = null) {
  peekNextProjectDocnoAsync(businessEntityId)
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
      'purchase_requisitions',
      'purchase_orders',
      'accounts_payable',
      'accounts_receivable'
    ];
    for (const tableName of targets) {
      await queryAsync(`UPDATE ${tableName} SET business_entity_id = ? WHERE business_entity_id IS NULL`, [defaultId]);
    }
  } catch (err) {
    if (!(isPostgresUndefinedTable(err) || isPostgresUndefinedColumn(err))) {
      console.error('Business entity backfill error:', err);
    }
  }
}

setTimeout(() => {
  backfillDefaultBusinessEntityLinks().catch((err) => {
    console.error('Business entity backfill init error:', err);
  });
}, 2500);

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

function normalizeInventorySaleFields(body = {}) {
  const productId = Number(body.product_id || body.productId || 0) || null;
  const warehouseId = Number(body.warehouse_id || body.warehouseId || 0) || null;
  const quantity = Math.max(0, Number(body.qty || body.quantity || 0) || 0);
  const unitPrice = Number(body.unitprice || body.unit_price || body.price || 0) || 0;
  return { productId, warehouseId, quantity, unitPrice };
}

async function assertInventorySaleCanPost({ businessEntityId, productId, warehouseId, quantity }, dbClient = null) {
  if (!productId) return null;
  if (!warehouseId) {
    const err = new Error('Warehouse is required when selling an inventory product.');
    err.statusCode = 400;
    throw err;
  }
  if (!(quantity > 0)) {
    const err = new Error('Quantity must be greater than zero when selling an inventory product.');
    err.statusCode = 400;
    throw err;
  }

  const productRows = await queryDbAsync(dbClient, 'SELECT id, product_name FROM products WHERE id = ? AND business_entity_id = ? LIMIT 1', [productId, businessEntityId]);
  const warehouseRows = await queryDbAsync(dbClient, 'SELECT id, warehouse_name FROM warehouses WHERE id = ? AND business_entity_id = ? LIMIT 1', [warehouseId, businessEntityId]);
  const stockRows = await queryDbAsync(dbClient, 'SELECT quantity_on_hand FROM stock WHERE product_id = ? AND warehouse_id = ? LIMIT 1', [productId, warehouseId]);

  if (!productRows.length) {
    const err = new Error('Selected inventory product was not found.');
    err.statusCode = 404;
    throw err;
  }
  if (!warehouseRows.length) {
    const err = new Error('Selected warehouse was not found.');
    err.statusCode = 404;
    throw err;
  }
  const available = Number(stockRows[0]?.quantity_on_hand || 0);
  if (available < quantity) {
    const err = new Error(`Not enough stock for this sale. Available: ${available}.`);
    err.statusCode = 400;
    throw err;
  }
  return { product: productRows[0], warehouse: warehouseRows[0], available };
}

async function postSalesInventoryMovement({
  businessEntityId,
  productId,
  warehouseId,
  quantity,
  docno,
  movementDate,
  createdBy,
  projectId = null,
  reverse = false,
  referenceType = null,
  notes = null
}, dbClient = null) {
  if (!productId || !warehouseId || !(quantity > 0)) return null;
  const signedQty = reverse ? quantity : -quantity;
  const stockRows = await queryDbAsync(
    dbClient,
    `INSERT INTO stock (business_entity_id, product_id, warehouse_id, quantity_on_hand, updated_at)
     VALUES (?, ?, ?, ?, NOW())
     ON CONFLICT (product_id, warehouse_id)
     DO UPDATE SET quantity_on_hand = stock.quantity_on_hand + EXCLUDED.quantity_on_hand, updated_at = NOW()
     RETURNING *`,
    [businessEntityId, productId, warehouseId, signedQty]
  );
  if (Number(stockRows[0]?.quantity_on_hand || 0) < 0) {
    const err = new Error('Stock cannot go below zero.');
    err.statusCode = 400;
    throw err;
  }

  const movementRows = await queryDbAsync(
    dbClient,
    `INSERT INTO stock_movements (business_entity_id, product_id, warehouse_id, movement_type, quantity, reference_type, reference_no, project_id, notes, movement_date, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     RETURNING *`,
    [
      businessEntityId,
      productId,
      warehouseId,
      reverse ? 'in' : 'out',
      quantity,
      referenceType || (reverse ? 'sales_transaction_reversal' : 'sales_transaction'),
      docno || null,
      Number(projectId || 0) || null,
      notes || (reverse ? 'Reversed inventory sale stock-out' : 'Sales invoice stock-out'),
      movementDate || new Date().toISOString().slice(0, 10),
      createdBy || null
    ]
  );
  return { stock: stockRows[0], movement: movementRows[0] };
}

const AUTO_GL_ACCOUNTS = {
  cash: { code: '1000', name: 'Cash and Cash Equivalents', type: 'asset' },
  accountsReceivable: { code: '1100', name: 'Accounts Receivable', type: 'asset' },
  accountsPayable: { code: '2000', name: 'Accounts Payable', type: 'liability' },
  serviceRevenue: { code: '4000', name: 'Service Revenue', type: 'revenue' },
  operatingExpenses: { code: '5000', name: 'Operating Expenses', type: 'expense' }
};

function getAutoJournalPrefix(referenceType) {
  const safe = String(referenceType || '').trim().toLowerCase();
  const map = {
    transaction_invoice: 'TRX',
    ap_bill: 'APB',
    ar_payment: 'ARPAY',
    ap_payment: 'APPAY'
  };
  return map[safe] || 'AUTO';
}

async function ensureChartAccount(account, dbClient = null) {
  const code = String(account?.code || '').trim();
  const name = String(account?.name || '').trim();
  const type = String(account?.type || '').trim().toLowerCase();
  if (!code || !name || !type) {
    throw new Error('Auto journal account setup is incomplete.');
  }

  const existingRows = await queryDbAsync(
    dbClient,
    'SELECT id FROM chart_of_accounts WHERE account_code = ? LIMIT 1',
    [code]
  );
  if (existingRows.length) return Number(existingRows[0].id || 0);

  await queryDbAsync(
    dbClient,
    `INSERT INTO chart_of_accounts (account_code, account_name, account_type)
     VALUES (?, ?, ?)
     ON CONFLICT DO NOTHING`,
    [code, name, type]
  );
  const rows = await queryDbAsync(
    dbClient,
    'SELECT id FROM chart_of_accounts WHERE account_code = ? LIMIT 1',
    [code]
  );
  const id = Number(rows[0]?.id || 0);
  if (!id) throw new Error(`Unable to prepare GL account ${code}.`);
  return id;
}

async function deleteAutoJournalEntries(referenceType, referenceId, dbClient = null) {
  const refType = String(referenceType || '').trim();
  const refId = String(referenceId || '').trim();
  if (!refType || !refId) return;
  await queryDbAsync(
    dbClient,
    "DELETE FROM journal_entries WHERE reference_type = ? AND reference_id = ? AND entry_number LIKE 'AUTO-%'",
    [refType, refId]
  );
}

async function postAutoJournalEntry({
  referenceType,
  referenceId,
  entryDate,
  memo,
  debitAccount,
  creditAccount,
  amount,
  createdBy = null,
  dbClient = null
}) {
  const refType = String(referenceType || '').trim();
  const refId = String(referenceId || '').trim();
  const finalAmount = Number(amount || 0);
  if (!refType || !refId) return null;

  await deleteAutoJournalEntries(refType, refId, dbClient);
  if (!(finalAmount > 0)) return null;

  const debitAccountId = await ensureChartAccount(debitAccount, dbClient);
  const creditAccountId = await ensureChartAccount(creditAccount, dbClient);
  if (!debitAccountId || !creditAccountId || debitAccountId === creditAccountId) {
    throw new Error('Auto journal debit and credit accounts must be valid and different.');
  }

  const entryNumber = `AUTO-${getAutoJournalPrefix(refType)}-${refId}`.slice(0, 50);
  // entryDate may be a JS Date (DATE columns come back as Date objects) — String(date) would give
  // "Mon Jun 22 ..." which Postgres can't parse. Normalize to YYYY-MM-DD using local components.
  let entryDateValue = entryDate;
  if (entryDateValue instanceof Date && !Number.isNaN(entryDateValue.getTime())) {
    const y = entryDateValue.getFullYear();
    const m = String(entryDateValue.getMonth() + 1).padStart(2, '0');
    const d = String(entryDateValue.getDate()).padStart(2, '0');
    entryDateValue = `${y}-${m}-${d}`;
  }
  const finalDate = String(entryDateValue || getManilaYmd()).slice(0, 10);
  const finalMemo = String(memo || '').trim() || `Auto-posted ${refType} ${refId}`;
  const entryResult = await queryDbAsync(
    dbClient,
    'INSERT INTO journal_entries (entry_number, entry_date, reference_type, reference_id, memo, status, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [entryNumber, finalDate, refType, refId, finalMemo, 'posted', createdBy || null]
  );
  const journalEntryId = Number(entryResult?.insertId || 0);
  if (!journalEntryId) throw new Error('Unable to create auto journal entry.');

  await queryDbAsync(
    dbClient,
    'INSERT INTO journal_lines (journal_entry_id, account_id, line_memo, debit, credit) VALUES (?, ?, ?, ?, ?)',
    [journalEntryId, debitAccountId, finalMemo, finalAmount, 0]
  );
  await queryDbAsync(
    dbClient,
    'INSERT INTO journal_lines (journal_entry_id, account_id, line_memo, debit, credit) VALUES (?, ?, ?, ?, ?)',
    [journalEntryId, creditAccountId, finalMemo, 0, finalAmount]
  );
  return { id: journalEntryId, entry_number: entryNumber };
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

const PDF_BRAND_HEADER_PATH = path.join(__dirname, 'public', 'assets', 'pdf', 'kvsk-pdf-header.png');
const PDF_BRAND_FOOTER_PATH = path.join(__dirname, 'public', 'assets', 'pdf', 'kvsk-pdf-footer.png');

function paethPredictor(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

function parsePngForPdf(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return null;
  const buffer = fs.readFileSync(filePath);
  if (!buffer.slice(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return null;

  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 8;
  let colorType = 6;
  let interlace = 0;
  const idat = [];
  const palette = [];
  let transparency = null;

  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    const data = buffer.slice(dataStart, dataEnd);
    offset = dataEnd + 4;

    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'PLTE') {
      for (let i = 0; i + 2 < data.length; i += 3) {
        palette.push([data[i], data[i + 1], data[i + 2]]);
      }
    } else if (type === 'tRNS') {
      transparency = data;
    } else if (type === 'IEND') {
      break;
    }
  }

  if (!width || !height || bitDepth !== 8 || interlace !== 0 || !idat.length) return null;
  const channelsByColorType = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
  const channels = channelsByColorType[colorType];
  if (!channels) return null;

  const inflated = zlib.inflateSync(Buffer.concat(idat));
  const bytesPerPixel = channels;
  const scanlineLength = width * channels;
  const pixels = Buffer.alloc(width * height * channels);
  let inputOffset = 0;
  let outputOffset = 0;
  let previous = Buffer.alloc(scanlineLength);

  for (let y = 0; y < height; y += 1) {
    const filter = inflated[inputOffset++];
    const line = Buffer.from(inflated.slice(inputOffset, inputOffset + scanlineLength));
    inputOffset += scanlineLength;

    for (let x = 0; x < scanlineLength; x += 1) {
      const left = x >= bytesPerPixel ? line[x - bytesPerPixel] : 0;
      const up = previous[x] || 0;
      const upLeft = x >= bytesPerPixel ? previous[x - bytesPerPixel] || 0 : 0;
      if (filter === 1) line[x] = (line[x] + left) & 255;
      else if (filter === 2) line[x] = (line[x] + up) & 255;
      else if (filter === 3) line[x] = (line[x] + Math.floor((left + up) / 2)) & 255;
      else if (filter === 4) line[x] = (line[x] + paethPredictor(left, up, upLeft)) & 255;
    }

    line.copy(pixels, outputOffset);
    outputOffset += scanlineLength;
    previous = line;
  }

  const rgb = Buffer.alloc(width * height * 3);
  const alpha = Buffer.alloc(width * height);
  let rgbOffset = 0;
  let alphaOffset = 0;

  for (let i = 0; i < width * height; i += 1) {
    if (colorType === 6) {
      const source = i * 4;
      rgb[rgbOffset++] = pixels[source];
      rgb[rgbOffset++] = pixels[source + 1];
      rgb[rgbOffset++] = pixels[source + 2];
      alpha[alphaOffset++] = pixels[source + 3];
    } else if (colorType === 2) {
      const source = i * 3;
      rgb[rgbOffset++] = pixels[source];
      rgb[rgbOffset++] = pixels[source + 1];
      rgb[rgbOffset++] = pixels[source + 2];
      alpha[alphaOffset++] = 255;
    } else if (colorType === 4) {
      const source = i * 2;
      const gray = pixels[source];
      rgb[rgbOffset++] = gray;
      rgb[rgbOffset++] = gray;
      rgb[rgbOffset++] = gray;
      alpha[alphaOffset++] = pixels[source + 1];
    } else if (colorType === 0) {
      const gray = pixels[i];
      rgb[rgbOffset++] = gray;
      rgb[rgbOffset++] = gray;
      rgb[rgbOffset++] = gray;
      alpha[alphaOffset++] = 255;
    } else if (colorType === 3) {
      const paletteIndex = pixels[i];
      const color = palette[paletteIndex] || [255, 255, 255];
      rgb[rgbOffset++] = color[0];
      rgb[rgbOffset++] = color[1];
      rgb[rgbOffset++] = color[2];
      alpha[alphaOffset++] = transparency && paletteIndex < transparency.length ? transparency[paletteIndex] : 255;
    }
  }

  const hasAlpha = alpha.some((value) => value < 255);
  return {
    width,
    height,
    rgb: zlib.deflateSync(rgb),
    alpha: hasAlpha ? zlib.deflateSync(alpha) : null
  };
}

function pdfHexStream(buffer) {
  return `${Buffer.from(buffer || Buffer.alloc(0)).toString('hex').toUpperCase()}>`;
}

function buildSimplePdfBuffer({ title, subtitle = '', headers = [], rows = [], branded = false }) {
  if (Array.isArray(headers) && headers.length) {
    return buildProfessionalTablePdfBuffer({ title, subtitle, headers, rows });
  }

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
  const imageMap = {};
  const imageObjects = [];
  const headerImage = branded ? parsePngForPdf(PDF_BRAND_HEADER_PATH) : null;
  const footerImage = branded ? parsePngForPdf(PDF_BRAND_FOOTER_PATH) : null;

  function addImage(name, image) {
    if (!image) return;
    let smaskObjectNumber = null;
    if (image.alpha) {
      const alphaStream = pdfHexStream(image.alpha);
      objectStrings.push(`<< /Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter [/ASCIIHexDecode /FlateDecode] /Length ${alphaStream.length} >>\nstream\n${alphaStream}\nendstream`);
      smaskObjectNumber = objectStrings.length;
    }
    const rgbStream = pdfHexStream(image.rgb);
    objectStrings.push(`<< /Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter [/ASCIIHexDecode /FlateDecode]${smaskObjectNumber ? ` /SMask ${smaskObjectNumber} 0 R` : ''} /Length ${rgbStream.length} >>\nstream\n${rgbStream}\nendstream`);
    imageMap[name] = objectStrings.length;
    imageObjects.push(name);
  }

  addImage('HeaderLogo', headerImage);
  addImage('FooterLogo', footerImage);

  const pageCount = pages.length;
  const pageObjectNumbers = [];
  const pagesParentObjectNumber = objectStrings.length + (pageCount * 2) + 1;
  for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
    const contentObjectNumber = objectStrings.length + 1;
    const pageObjectNumber = objectStrings.length + 2;
    pageObjectNumbers.push(pageObjectNumber);

    const pageLines = pages[pageIndex];
    const contentLines = ['BT', '/F1 10 Tf'];
    let y = branded ? 620 : 760;
    pageLines.forEach((line) => {
      contentLines.push(`1 0 0 1 50 ${y} Tm (${escapePdfText(line)}) Tj`);
      y -= 14;
    });
    contentLines.push('ET');
    if (headerImage) {
      const width = 560;
      const height = width * (headerImage.height / headerImage.width);
      contentLines.push(`q ${width.toFixed(2)} 0 0 ${height.toFixed(2)} 26 ${(780 - height).toFixed(2)} cm /HeaderLogo Do Q`);
    }
    if (footerImage) {
      const width = 270;
      const height = width * (footerImage.height / footerImage.width);
      contentLines.push(`q ${width.toFixed(2)} 0 0 ${height.toFixed(2)} 50 24 cm /FooterLogo Do Q`);
    }
    const contentStream = contentLines.join('\n');
    objectStrings.push(`<< /Length ${Buffer.byteLength(contentStream, 'utf8')} >>\nstream\n${contentStream}\nendstream`);
    const xobjects = imageObjects.length
      ? ` /XObject << ${imageObjects.map((name) => `/${name} ${imageMap[name]} 0 R`).join(' ')} >>`
      : '';
    objectStrings.push(`<< /Type /Page /Parent ${pagesParentObjectNumber} 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 1 0 R >>${xobjects} >> /Contents ${contentObjectNumber} 0 R >>`);
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

function buildProfessionalTablePdfBuffer({ title = 'ERP REPORT', subtitle = '', headers = [], rows = [] } = {}) {
  const brand = getPurchaseRequisitionPdfBrand({});
  const safeHeaders = Array.isArray(headers) ? headers.slice(0, 7) : [];
  const safeRows = Array.isArray(rows) ? rows : [];
  const rowsPerPage = 24;
  const pages = [];
  for (let i = 0; i < safeRows.length; i += rowsPerPage) {
    pages.push(safeRows.slice(i, i + rowsPerPage));
  }
  if (!pages.length) pages.push([]);

  const objects = [
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>'
  ];
  const pageObjectNumbers = [];
  const pageCount = pages.length;
  const colWidth = safeHeaders.length ? 512 / safeHeaders.length : 512;

  const addPage = (pageRows, pageIndex) => {
    const content = [];
    const text = (x, y, value, options = {}) => {
      const font = options.bold ? 'F2' : 'F1';
      let size = Number(options.size || 8);
      const color = options.color || '0.12 0.12 0.12';
      let safeValue = options.maxWidth ? fitPdfValue(value, options.maxWidth, size) : String(value || '');
      if (options.fitSize && options.maxWidth) {
        const fitted = fitPdfValueToWidth(value, options.maxWidth, size, options.minSize || 6.5);
        safeValue = fitted.text;
        size = fitted.size;
      }
      const safeX = pdfTextXForAlign(Number(x), Number(options.width || 0), safeValue, size, options.align || 'left');
      content.push(`BT /${font} ${size} Tf ${color} rg 1 0 0 1 ${safeX.toFixed(2)} ${y} Tm (${escapePdfText(safeValue)}) Tj ET`);
    };
    const rect = (x, y, w, h, options = {}) => {
      if (options.fill) content.push(`${options.fill} rg ${x} ${y} ${w} ${h} re f`);
      if (options.stroke) content.push(`${options.stroke} RG ${x} ${y} ${w} ${h} re S`);
    };
    const line = (x1, y1, x2, y2, color = '0.70 0.70 0.70') => {
      content.push(`${color} RG 0.6 w ${x1} ${y1} m ${x2} ${y2} l S`);
    };

    rect(32, 42, 548, 708, { stroke: '0.86 0.88 0.90' });
    rect(50, 724, 512, 4, { fill: brand.accent });
    text(50, 755, brand.name, { bold: true, size: 14, color: brand.accent });
    text(50, 739, brand.subtitle, { size: 8, color: '0.25 0.25 0.25' });
    line(50, 728, 562, 728, brand.accent);

    rect(50, 670, 512, 36, { fill: '0.96 0.97 0.98', stroke: '0.80 0.83 0.86' });
    text(64, 690, String(title || 'ERP REPORT').toUpperCase(), { bold: true, size: 16, color: '0.08 0.08 0.08' });
    text(398, 691, `PAGE ${pageIndex + 1} OF ${pageCount}`, { bold: true, size: 9, color: brand.accent, width: 140, align: 'right' });
    if (subtitle) text(64, 676, subtitle, { size: 8, color: '0.36 0.38 0.42', maxWidth: 320 });

    let y = 630;
    rect(50, y, 512, 22, { fill: brand.accent });
    safeHeaders.forEach((header, index) => {
      text(58 + (index * colWidth), y + 8, formatPdfHeaderLabel(header), { bold: true, size: 7, color: '1 1 1', maxWidth: colWidth - 12 });
    });
    y -= 24;

    if (!pageRows.length) {
      rect(50, y - 6, 512, 24, { fill: '1 1 1', stroke: '0.88 0.89 0.91' });
      text(62, y + 2, 'No data found.', { size: 9, color: '0.36 0.38 0.42' });
    } else {
      pageRows.forEach((row, rowIndex) => {
        rect(50, y - 6, 512, 22, { fill: rowIndex % 2 === 0 ? '1 1 1' : '0.98 0.98 0.98', stroke: '0.88 0.89 0.91' });
        safeHeaders.forEach((header, colIndex) => {
          const maxLength = Math.max(8, Math.floor(colWidth / 4.6));
          text(58 + (colIndex * colWidth), y + 2, truncatePdfValue(row?.[header] ?? '', maxLength), { size: 7, maxWidth: colWidth - 12 });
        });
        y -= 22;
      });
    }

    text(470, 58, `Rows: ${safeRows.length}`, { size: 7, color: '0.45 0.48 0.52' });

    const contentStream = content.join('\n');
    const contentObjectNumber = objects.length + 1;
    const pageObjectNumber = objects.length + 2;
    pageObjectNumbers.push(pageObjectNumber);
    objects.push(`<< /Length ${Buffer.byteLength(contentStream, 'utf8')} >>\nstream\n${contentStream}\nendstream`);
    objects.push(`<< /Type /Page /Parent PAGES_OBJECT 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 1 0 R /F2 2 0 R >> >> /Contents ${contentObjectNumber} 0 R >>`);
  };

  pages.forEach(addPage);
  const pagesObjectNumber = objects.length + 1;
  const catalogObjectNumber = objects.length + 2;
  for (let i = 0; i < objects.length; i += 1) {
    objects[i] = objects[i].replace(/PAGES_OBJECT/g, String(pagesObjectNumber));
  }
  objects.push(`<< /Type /Pages /Kids [${pageObjectNumbers.map((num) => `${num} 0 R`).join(' ')}] /Count ${pageCount} >>`);
  objects.push(`<< /Type /Catalog /Pages ${pagesObjectNumber} 0 R >>`);

  let pdf = '%PDF-1.4\n';
  const offsets = ['0000000000 65535 f \n'];
  objects.forEach((body, index) => {
    offsets.push(`${String(pdf.length).padStart(10, '0')} 00000 n \n`);
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefStart = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += offsets.join('');
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogObjectNumber} 0 R >>\n`;
  pdf += `startxref\n${xrefStart}\n%%EOF`;
  return Buffer.from(pdf, 'binary');
}

function sendPdfTableResponse(res, filename, title, headers, rows, subtitle = '') {
  const pdf = buildProfessionalTablePdfBuffer({ title, subtitle, headers, rows });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(pdf);
}

// formatPdfMoney + formatPdfDate now live in src/shared/format (imported at top).

function truncatePdfValue(value, maxLength = 56) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 3)).trim()}...`;
}

function formatPdfHeaderLabel(value) {
  const acronymMap = {
    ap: 'AP',
    ar: 'AR',
    id: 'ID',
    ip: 'IP',
    po: 'PO',
    pr: 'PR',
    pdf: 'PDF',
    qty: 'Qty'
  };
  return String(value || '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .map((word) => acronymMap[word.toLowerCase()] || word.replace(/\b\w/g, (match) => match.toUpperCase()))
    .join(' ');
}

function wrapPdfValue(value, maxLength = 34) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) return ['-'];
  if (text.length <= maxLength) return [text];

  const lines = [];
  let remaining = text;
  while (remaining.length > maxLength) {
    let cut = remaining.lastIndexOf(' ', maxLength);
    if (cut < Math.floor(maxLength / 2)) cut = maxLength;
    lines.push(remaining.slice(0, cut).trim());
    remaining = remaining.slice(cut).trim();
  }
  if (remaining) lines.push(remaining);
  return lines;
}

function estimatePdfTextWidth(value, size = 9) {
  return String(value || '').length * Number(size || 9) * 0.52;
}

function fitPdfValue(value, maxWidth, size = 9) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text || estimatePdfTextWidth(text, size) <= maxWidth) return text;
  let fitted = text;
  while (fitted.length > 1 && estimatePdfTextWidth(`${fitted}...`, size) > maxWidth) {
    fitted = fitted.slice(0, -1);
  }
  return `${fitted.trim()}...`;
}

function fitPdfValueToWidth(value, maxWidth, preferredSize = 9, minSize = 6.5) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  let size = Number(preferredSize || 9);
  while (text && size > minSize && estimatePdfTextWidth(text, size) > maxWidth) {
    size -= 0.5;
  }
  return {
    text: size <= minSize && estimatePdfTextWidth(text, size) > maxWidth ? fitPdfValue(text, maxWidth, size) : text,
    size
  };
}

function formatPdfStatusLabel(value = '') {
  return String(value || '-').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim().toUpperCase();
}

function pdfTextXForAlign(x, width, value, size = 9, align = 'left') {
  if (align === 'right') return x + width - estimatePdfTextWidth(value, size);
  if (align === 'center') return x + ((width - estimatePdfTextWidth(value, size)) / 2);
  return x;
}

function drawPdfWrappedText(drawText, x, y, value, options = {}) {
  const width = Number(options.width || 260);
  const size = Number(options.size || 8);
  const lineHeight = Number(options.lineHeight || 10);
  const maxLines = Number(options.maxLines || 3);
  const maxChars = Math.max(12, Math.floor(width / (size * 0.52)));
  const lines = wrapPdfValue(value || '-', maxChars).slice(0, maxLines);
  lines.forEach((lineText, index) => {
    const isLast = index === maxLines - 1 && wrapPdfValue(value || '-', maxChars).length > maxLines;
    drawText(x, y - (index * lineHeight), isLast ? fitPdfValue(`${lineText}...`, width, size) : lineText, {
      ...options,
      maxWidth: width
    });
  });
}

// Hex (#rrggbb) → PDF "r g b" floats (0–1). Returns null for anything else.
function hexToPdfRgb(hex) {
  const s = String(hex || '').trim();
  if (!/^#[0-9a-fA-F]{6}$/.test(s)) return null;
  const r = parseInt(s.slice(1, 3), 16) / 255;
  const g = parseInt(s.slice(3, 5), 16) / 255;
  const b = parseInt(s.slice(5, 7), 16) / 255;
  return `${r.toFixed(3)} ${g.toFixed(3)} ${b.toFixed(3)}`;
}

function getPurchaseRequisitionPdfBrand(row = {}) {
  const entityName = String(row.business_entity_name || row.entity_name || '').trim();
  const entityCode = String(row.business_entity_code || row.entity_code || '').trim();
  const address = String(row.business_entity_address || row.entity_address || '').trim();
  const phone = String(row.business_entity_phone || row.entity_phone || '').trim();
  const email = String(row.business_entity_email || row.entity_email || '').trim();
  const fallbackName = 'KVSK CCTV & IT Solutions';
  const subtitleParts = [address, phone, email].filter(Boolean);
  const brandKey = `${entityCode} ${entityName}`.toLowerCase();
  const isKitsi = /\bkitsi\b|\bkits\b/.test(brandKey);
  // The entity's own brand color (set in the Business Entity modal) drives the PDF accent.
  // Falls back to the legacy per-name accent only when no color is set.
  const customAccent = hexToPdfRgb(row.business_entity_brand_color);
  return {
    name: entityName || entityCode || fallbackName,
    subtitle: subtitleParts.length ? subtitleParts.join(' | ') : 'Tanauan City, Batangas, 4232 | info@kvsk.com.ph',
    accent: customAccent || (isKitsi ? '0.00 0.58 0.78' : '0.70 0.12 0.08')
  };
}

function getPdfStatusTone(status = '') {
  const safe = String(status || '').trim().toLowerCase();
  if (['approved', 'paid', 'completed', 'accepted', 'received'].includes(safe)) {
    return { fill: '0.88 0.96 0.90', text: '0.10 0.45 0.20', stroke: '0.55 0.78 0.58' };
  }
  if (['rejected', 'cancelled', 'overdue', 'void'].includes(safe)) {
    return { fill: '0.99 0.90 0.90', text: '0.70 0.12 0.08', stroke: '0.86 0.52 0.48' };
  }
  if (['pending', 'for_approval', 'partial', 'sent', 'issued', 'in_progress'].includes(safe)) {
    return { fill: '1.00 0.96 0.86', text: '0.62 0.36 0.06', stroke: '0.88 0.68 0.30' };
  }
  return { fill: '0.93 0.95 0.97', text: '0.25 0.29 0.35', stroke: '0.75 0.79 0.84' };
}

function buildProfessionalPurchaseRequisitionPdf(row, itemRows = [], total = 0) {
  const brand = getPurchaseRequisitionPdfBrand(row);
  const statusTone = getPdfStatusTone(row.status);
  const objects = [
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>'
  ];

  const content = [];
  function text(x, y, value, options = {}) {
    const font = options.bold ? 'F2' : 'F1';
    let size = Number(options.size || 9);
    const color = options.color || '0.12 0.12 0.12';
    let safeValue = options.maxWidth ? fitPdfValue(value, options.maxWidth, size) : String(value || '');
    if (options.fitSize && options.maxWidth) {
      const fitted = fitPdfValueToWidth(value, options.maxWidth, size, options.minSize || 6.5);
      safeValue = fitted.text;
      size = fitted.size;
    }
    const safeX = pdfTextXForAlign(Number(x), Number(options.width || 0), safeValue, size, options.align || 'left');
    content.push(`BT /${font} ${size} Tf ${color} rg 1 0 0 1 ${safeX.toFixed(2)} ${y} Tm (${escapePdfText(safeValue)}) Tj ET`);
  }
  function rect(x, y, w, h, options = {}) {
    const fill = options.fill || null;
    const stroke = options.stroke || null;
    if (fill) content.push(`${fill} rg ${x} ${y} ${w} ${h} re f`);
    if (stroke) content.push(`${stroke} RG ${x} ${y} ${w} ${h} re S`);
  }
  function line(x1, y1, x2, y2, color = '0.70 0.70 0.70') {
    content.push(`${color} RG 0.6 w ${x1} ${y1} m ${x2} ${y2} l S`);
  }
  function noteText(x, y, value, options = {}) {
    drawPdfWrappedText(text, x, y, value, options);
  }

  rect(32, 42, 548, 724, { stroke: '0.86 0.88 0.90' });
  rect(50, 718, 512, 42, { fill: '1 1 1', stroke: '0.82 0.84 0.87' });
  rect(50, 756, 512, 4, { fill: brand.accent });
  text(64, 741, brand.name, { bold: true, size: 14, color: brand.accent, maxWidth: 320 });
  text(64, 727, brand.subtitle, { size: 8, color: '0.25 0.25 0.25', maxWidth: 320 });

  rect(50, 666, 512, 46, { fill: '0.96 0.97 0.98', stroke: '0.80 0.83 0.86' });
  text(64, 688, 'PURCHASE REQUISITION', { bold: true, size: 16, color: '0.08 0.08 0.08', maxWidth: 300 });
  rect(398, 673, 140, 28, { fill: '1 1 1', stroke: '0.80 0.83 0.86' });
  text(408, 689, row.pr_number || `PR-${row.id || ''}`, { bold: true, size: 10, color: brand.accent, width: 120, align: 'center', maxWidth: 120, fitSize: true });
  rect(408, 676, 120, 10, { fill: statusTone.fill, stroke: statusTone.stroke });
  text(408, 679, formatPdfStatusLabel(row.status || 'draft'), { bold: true, size: 6, color: statusTone.text, width: 120, align: 'center', maxWidth: 112, fitSize: true, minSize: 5 });

  rect(50, 543, 248, 108, { stroke: '0.82 0.84 0.87' });
  rect(50, 631, 248, 20, { fill: '0.94 0.95 0.96' });
  text(62, 638, 'REQUEST DETAILS', { bold: true, size: 9 });
  text(62, 615, 'Request Date', { bold: true, size: 8, color: '0.36 0.38 0.42' });
  text(150, 615, formatPdfDate(row.request_date) || '-', { size: 9, maxWidth: 130 });
  text(62, 597, 'Needed By', { bold: true, size: 8, color: '0.36 0.38 0.42' });
  text(150, 597, formatPdfDate(row.needed_by) || '-', { size: 9, maxWidth: 130 });
  text(62, 579, 'Requested By', { bold: true, size: 8, color: '0.36 0.38 0.42' });
  text(150, 579, row.requested_by || '-', { size: 9, maxWidth: 130 });
  text(62, 561, 'Submitted By', { bold: true, size: 8, color: '0.36 0.38 0.42' });
  text(150, 561, row.submitted_by || '-', { size: 9, maxWidth: 130 });

  rect(314, 543, 248, 108, { stroke: '0.82 0.84 0.87' });
  rect(314, 631, 248, 20, { fill: '0.94 0.95 0.96' });
  text(326, 638, 'PROJECT / COMPANY', { bold: true, size: 9 });
  text(326, 615, 'Company', { bold: true, size: 8, color: '0.36 0.38 0.42' });
  noteText(400, 615, [row.company_no, row.company_name].filter(Boolean).join(' - ') || '-', {
    size: 8,
    color: '0.12 0.12 0.12',
    width: 140,
    maxLines: 2,
    lineHeight: 9
  });
  text(326, 587, 'Project', { bold: true, size: 8, color: '0.36 0.38 0.42' });
  noteText(400, 587, [row.project_docno, row.project_name].filter(Boolean).join(' - ') || '-', {
    size: 8,
    color: '0.12 0.12 0.12',
    width: 140,
    maxLines: 2,
    lineHeight: 9
  });
  text(326, 559, 'Submitted', { bold: true, size: 8, color: '0.36 0.38 0.42' });
  text(400, 559, row.submitted_by || '-', { size: 8, maxWidth: 140 });

  text(50, 517, 'REQUESTED ITEMS', { bold: true, size: 10 });
  rect(50, 492, 512, 20, { fill: brand.accent });
  text(58, 499, '#', { bold: true, size: 8, color: '1 1 1' });
  text(78, 499, 'Item', { bold: true, size: 8, color: '1 1 1' });
  text(194, 499, 'Description', { bold: true, size: 8, color: '1 1 1' });
  text(342, 499, 'Qty', { bold: true, size: 8, color: '1 1 1' });
  text(386, 499, 'Unit Cost', { bold: true, size: 8, color: '1 1 1', width: 82, align: 'right' });
  text(474, 499, 'Total', { bold: true, size: 8, color: '1 1 1', width: 82, align: 'right' });

  const visibleItems = Array.isArray(itemRows) ? itemRows : [];
  let y = 469;
  let renderedItemCount = 0;
  visibleItems.forEach((item, index) => {
    const descriptionLines = wrapPdfValue(item.description || '-', 30);
    const rowHeight = Math.max(22, 16 + (descriptionLines.length * 10));
    if (y - rowHeight < 210) return;

    rect(50, y - rowHeight + 11, 512, rowHeight, { fill: index % 2 === 0 ? '1 1 1' : '0.98 0.98 0.98', stroke: '0.88 0.89 0.91' });
    text(58, y + 3, String(index + 1), { size: 8 });
    text(78, y + 3, item.item_name || 'Item', { size: 8, maxWidth: 108 });
    descriptionLines.forEach((lineText, lineIndex) => {
      text(194, y + 3 - (lineIndex * 10), lineText, { size: 8, color: '0.24 0.25 0.28', maxWidth: 136 });
    });
    text(342, y + 3, `${Number(item.quantity || 0)} ${truncatePdfValue(item.unit || '', 5)}`.trim(), { size: 8, maxWidth: 44 });
    text(386, y + 3, formatPdfMoney(item.estimated_unit_price), { size: 8, width: 82, align: 'right', maxWidth: 82, fitSize: true });
    text(474, y + 3, formatPdfMoney(item.line_total), { size: 8, width: 82, align: 'right', maxWidth: 82, fitSize: true });
    y -= rowHeight;
    renderedItemCount += 1;
  });
  if (itemRows.length > renderedItemCount) {
    text(58, y + 3, `+ ${itemRows.length - renderedItemCount} more item(s)`, { size: 8, color: '0.36 0.38 0.42' });
  }

  rect(50, 142, 512, 62, { stroke: '0.82 0.84 0.87' });
  rect(50, 184, 512, 20, { fill: '0.94 0.95 0.96' });
  text(62, 191, 'NOTES', { bold: true, size: 9, color: '0.28 0.30 0.34' });
  noteText(62, 174, row.notes || '-', { size: 8, color: '0.24 0.25 0.28', width: 312, maxLines: 3, lineHeight: 10 });
  rect(392, 154, 138, 28, { fill: '0.96 0.97 0.98', stroke: '0.80 0.83 0.86' });
  text(404, 171, 'Grand Total', { bold: true, size: 8, color: '0.36 0.38 0.42' });
  text(404, 159, formatPdfMoney(total), { bold: true, size: 11, color: brand.accent, width: 114, align: 'right', maxWidth: 114, fitSize: true, minSize: 7 });

  // Actual signatory names sit just above each line so the PDF shows who prepared/approved.
  const prPreparedBy = String(row.requested_by || '').trim();
  const prApprovedBy = String(row.approved_by || '').trim();
  if (prPreparedBy) text(72, 110, prPreparedBy, { bold: true, size: 9, width: 148, align: 'center', maxWidth: 148, fitSize: true, minSize: 6.5 });
  if (prApprovedBy) text(390, 110, prApprovedBy, { bold: true, size: 9, width: 148, align: 'center', maxWidth: 148, fitSize: true, minSize: 6.5 });
  line(72, 105, 220, 105);
  line(390, 105, 538, 105);
  text(96, 90, 'Prepared / Submitted By', { size: 8, color: '0.36 0.38 0.42' });
  text(430, 90, 'Approved By', { size: 8, color: '0.36 0.38 0.42' });

  const contentStream = content.join('\n');
  const contentObjectNumber = objects.length + 1;
  const pageObjectNumber = objects.length + 2;
  const pagesObjectNumber = objects.length + 3;
  const catalogObjectNumber = objects.length + 4;
  objects.push(`<< /Length ${Buffer.byteLength(contentStream, 'utf8')} >>\nstream\n${contentStream}\nendstream`);
  objects.push(`<< /Type /Page /Parent ${pagesObjectNumber} 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 1 0 R /F2 2 0 R >> >> /Contents ${contentObjectNumber} 0 R >>`);
  objects.push(`<< /Type /Pages /Kids [${pageObjectNumber} 0 R] /Count 1 >>`);
  objects.push(`<< /Type /Catalog /Pages ${pagesObjectNumber} 0 R >>`);

  let pdf = '%PDF-1.4\n';
  const offsets = ['0000000000 65535 f \n'];
  objects.forEach((body, index) => {
    offsets.push(`${String(pdf.length).padStart(10, '0')} 00000 n \n`);
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefStart = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += offsets.join('');
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogObjectNumber} 0 R >>\n`;
  pdf += `startxref\n${xrefStart}\n%%EOF`;
  return Buffer.from(pdf, 'binary');
}

function buildProfessionalSummaryPdf({
  title = 'DOCUMENT SUMMARY',
  documentNo = '',
  status = '',
  brandSource = {},
  leftTitle = 'DETAILS',
  leftRows = [],
  rightTitle = 'REFERENCE',
  rightRows = [],
  tableTitle = '',
  tableHeaders = [],
  tableRows = [],
  notes = '',
  totalLabel = '',
  totalValue = null,
  brand: brandOverride = null,
  hideBrandHeader = false,
  preparedByName = '',
  approvedByName = ''
} = {}) {
  // brandOverride lets a caller supply its own letterhead (e.g. a vendor quotation that
  // must carry the vendor's identity, not our operating company's).
  const brand = brandOverride || getPurchaseRequisitionPdfBrand(brandSource);
  const statusTone = getPdfStatusTone(status);
  const objects = [
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>'
  ];

  const content = [];
  function text(x, y, value, options = {}) {
    const font = options.bold ? 'F2' : 'F1';
    let size = Number(options.size || 9);
    const color = options.color || '0.12 0.12 0.12';
    let safeValue = options.maxWidth ? fitPdfValue(value, options.maxWidth, size) : String(value || '');
    if (options.fitSize && options.maxWidth) {
      const fitted = fitPdfValueToWidth(value, options.maxWidth, size, options.minSize || 6.5);
      safeValue = fitted.text;
      size = fitted.size;
    }
    const safeX = pdfTextXForAlign(Number(x), Number(options.width || 0), safeValue, size, options.align || 'left');
    content.push(`BT /${font} ${size} Tf ${color} rg 1 0 0 1 ${safeX.toFixed(2)} ${y} Tm (${escapePdfText(safeValue)}) Tj ET`);
  }
  function rect(x, y, w, h, options = {}) {
    const fill = options.fill || null;
    const stroke = options.stroke || null;
    if (fill) content.push(`${fill} rg ${x} ${y} ${w} ${h} re f`);
    if (stroke) content.push(`${stroke} RG ${x} ${y} ${w} ${h} re S`);
  }
  function line(x1, y1, x2, y2, color = '0.70 0.70 0.70') {
    content.push(`${color} RG 0.6 w ${x1} ${y1} m ${x2} ${y2} l S`);
  }
  function noteText(x, y, value, options = {}) {
    drawPdfWrappedText(text, x, y, value, options);
  }
  function fieldRows(x, y, rows) {
    let currentY = y;
    (rows || []).slice(0, 7).forEach(([label, value]) => {
      text(x, currentY, label, { bold: true, size: 8, color: '0.36 0.38 0.42', maxWidth: 76 });
      text(x + 88, currentY, value || '-', { size: 9, maxWidth: 132 });
      currentY -= 18;
    });
  }

  rect(32, 42, 548, 724, { stroke: '0.86 0.88 0.90' });
  // Letterhead band (company/vendor identity). Suppressed for documents that should not
  // carry any letterhead — e.g. a vendor quotation, which is the vendor's own document.
  if (!hideBrandHeader) {
    rect(50, 718, 512, 42, { fill: '1 1 1', stroke: '0.82 0.84 0.87' });
    rect(50, 756, 512, 4, { fill: brand.accent });
    text(64, 741, brand.name, { bold: true, size: 14, color: brand.accent, maxWidth: 320 });
    text(64, 727, brand.subtitle, { size: 8, color: '0.25 0.25 0.25', maxWidth: 320 });
  }

  // With no letterhead, pull the title band to the top (a thin accent strip replaces it).
  const titleBandTop = hideBrandHeader ? 714 : 666;
  if (hideBrandHeader) rect(50, 760, 512, 4, { fill: brand.accent });
  rect(50, titleBandTop, 512, 46, { fill: '0.96 0.97 0.98', stroke: '0.80 0.83 0.86' });
  text(64, titleBandTop + 22, title, { bold: true, size: 16, color: '0.08 0.08 0.08', maxWidth: 300 });
  rect(398, titleBandTop + 7, 140, 28, { fill: '1 1 1', stroke: '0.80 0.83 0.86' });
  text(408, titleBandTop + 23, documentNo || '-', { bold: true, size: 10, color: brand.accent, width: 120, align: 'center', maxWidth: 120, fitSize: true });
  rect(408, titleBandTop + 10, 120, 10, { fill: statusTone.fill, stroke: statusTone.stroke });
  text(408, titleBandTop + 13, formatPdfStatusLabel(status || '-'), { bold: true, size: 6, color: statusTone.text, width: 120, align: 'center', maxWidth: 112, fitSize: true, minSize: 5 });

  rect(50, 512, 248, 139, { stroke: '0.82 0.84 0.87' });
  rect(50, 631, 248, 20, { fill: '0.94 0.95 0.96' });
  text(62, 638, leftTitle, { bold: true, size: 9 });
  fieldRows(62, 615, leftRows);

  rect(314, 512, 248, 139, { stroke: '0.82 0.84 0.87' });
  rect(314, 631, 248, 20, { fill: '0.94 0.95 0.96' });
  text(326, 638, rightTitle, { bold: true, size: 9 });
  fieldRows(326, 615, rightRows);

  let y = 480;
  if (tableTitle && tableHeaders.length) {
    text(50, y, tableTitle, { bold: true, size: 10 });
    y -= 25;
    rect(50, y, 512, 20, { fill: brand.accent });
    const columnLayouts = {
      1: [{ x: 62, width: 488 }],
      2: [{ x: 62, width: 170 }, { x: 250, width: 300 }],
      3: [{ x: 62, width: 170 }, { x: 250, width: 150 }, { x: 430, width: 120 }],
      4: [{ x: 58, width: 120 }, { x: 190, width: 105 }, { x: 315, width: 115 }, { x: 455, width: 95 }]
    };
    const activeHeaders = tableHeaders.slice(0, 4);
    const layout = columnLayouts[Math.min(activeHeaders.length, 4)] || columnLayouts[4];
    activeHeaders.forEach((header, index) => {
      text(layout[index].x, y + 7, formatPdfHeaderLabel(header), { bold: true, size: 8, color: '1 1 1', maxWidth: layout[index].width });
    });
    y -= 24;
    (tableRows || []).slice(0, 8).forEach((row, rowIndex) => {
      rect(50, y - 6, 512, 22, { fill: rowIndex % 2 === 0 ? '1 1 1' : '0.98 0.98 0.98', stroke: '0.88 0.89 0.91' });
      activeHeaders.forEach((header, colIndex) => {
        const isAmount = /amount|total|balance|value/i.test(String(header || '')) && tableHeaders.length > 2 && colIndex === tableHeaders.length - 1;
        text(layout[colIndex].x, y + 1, row?.[header] || '-', {
          size: 8,
          maxWidth: layout[colIndex].width,
          width: layout[colIndex].width,
          align: isAmount ? 'right' : 'left',
          fitSize: isAmount,
          minSize: 6.5
        });
      });
      y -= 22;
    });
  }

  rect(50, 142, 512, 62, { stroke: '0.82 0.84 0.87' });
  rect(50, 184, 512, 20, { fill: '0.94 0.95 0.96' });
  text(62, 191, 'NOTES', { bold: true, size: 9, color: '0.28 0.30 0.34' });

  if (totalLabel) {
    noteText(62, 174, notes || '-', { size: 8, color: '0.24 0.25 0.28', width: 312, maxLines: 3, lineHeight: 10 });
    rect(392, 154, 138, 28, { fill: '0.96 0.97 0.98', stroke: '0.80 0.83 0.86' });
    text(404, 171, totalLabel, { bold: true, size: 8, color: '0.36 0.38 0.42', maxWidth: 114 });
    text(404, 159, totalValue === null ? '-' : formatPdfMoney(totalValue), { bold: true, size: 11, color: brand.accent, width: 114, align: 'right', maxWidth: 114, fitSize: true, minSize: 7 });
  } else {
    noteText(62, 174, notes || '-', { size: 8, color: '0.24 0.25 0.28', width: 468, maxLines: 3, lineHeight: 10 });
  }

  // Actual signatory names sit just above each line so the PDF shows who prepared/approved.
  if (preparedByName) text(72, 110, preparedByName, { bold: true, size: 9, width: 148, align: 'center', maxWidth: 148, fitSize: true, minSize: 6.5 });
  if (approvedByName) text(390, 110, approvedByName, { bold: true, size: 9, width: 148, align: 'center', maxWidth: 148, fitSize: true, minSize: 6.5 });
  line(72, 105, 220, 105);
  line(390, 105, 538, 105);
  text(96, 90, 'Prepared / Submitted By', { size: 8, color: '0.36 0.38 0.42' });
  text(430, 90, 'Approved By', { size: 8, color: '0.36 0.38 0.42' });

  const contentStream = content.join('\n');
  const contentObjectNumber = objects.length + 1;
  const pageObjectNumber = objects.length + 2;
  const pagesObjectNumber = objects.length + 3;
  const catalogObjectNumber = objects.length + 4;
  objects.push(`<< /Length ${Buffer.byteLength(contentStream, 'utf8')} >>\nstream\n${contentStream}\nendstream`);
  objects.push(`<< /Type /Page /Parent ${pagesObjectNumber} 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 1 0 R /F2 2 0 R >> >> /Contents ${contentObjectNumber} 0 R >>`);
  objects.push(`<< /Type /Pages /Kids [${pageObjectNumber} 0 R] /Count 1 >>`);
  objects.push(`<< /Type /Catalog /Pages ${pagesObjectNumber} 0 R >>`);

  let pdf = '%PDF-1.4\n';
  const offsets = ['0000000000 65535 f \n'];
  objects.forEach((body, index) => {
    offsets.push(`${String(pdf.length).padStart(10, '0')} 00000 n \n`);
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefStart = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += offsets.join('');
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogObjectNumber} 0 R >>\n`;
  pdf += `startxref\n${xrefStart}\n%%EOF`;
  return Buffer.from(pdf, 'binary');
}

async function buildPurchaseRequisitionPdf(requisitionId) {
  const rows = await queryAsync(`
    SELECT
      pr.*,
      be.company_name AS business_entity_name, be.brand_color AS business_entity_brand_color,
      be.entity_code AS business_entity_code,
      be.address AS business_entity_address,
      be.phone AS business_entity_phone,
      be.email AS business_entity_email,
      c.company_name,
      c.company_no,
      p.project_docno,
      p.project_name
    FROM purchase_requisitions pr
    LEFT JOIN business_entities be ON be.id = pr.business_entity_id
    LEFT JOIN company_registry c ON c.id = pr.company_id
    LEFT JOIN projects p ON p.id = pr.project_id
    WHERE pr.id = ?
    LIMIT 1
  `, [requisitionId]);
  const row = rows?.[0];
  if (!row) throw new Error('Purchase requisition not found.');

  const itemRows = await queryAsync(`
    SELECT item_name, description, quantity, unit, estimated_unit_price, line_total
    FROM purchase_requisition_items
    WHERE pr_id = ?
    ORDER BY id ASC
  `, [requisitionId]);
  const total = (Array.isArray(itemRows) ? itemRows : []).reduce((sum, item) => sum + Number(item.line_total || 0), 0);
  return buildProfessionalPurchaseRequisitionPdf(row, itemRows, total);
}

async function generatePurchaseRequisitionPdfFile(requisitionId) {
  const pdf = await buildPurchaseRequisitionPdf(requisitionId);
  const timestamp = Date.now();
  const filename = `${timestamp}-${Math.round(Math.random() * 1e9)}-purchase-requisition-${Number(requisitionId)}.pdf`;
  const filePath = path.join(UPLOAD_DIR, filename);
  await fs.promises.writeFile(filePath, pdf);
  await queryAsync('UPDATE purchase_requisitions SET pdfFilename = ? WHERE id = ?', [filename, requisitionId]);
  return { filename, filePath };
}

async function buildPurchaseRequisitionEmailAttachment(requisitionId) {
  const generated = await generatePurchaseRequisitionPdfFile(requisitionId);
  return {
    filename: generated.filename,
    path: generated.filePath,
    contentType: 'application/pdf'
  };
}

// Request-for-Quotation PDF sent to a vendor: lists the PR items with BLANK price
// columns for the vendor to fill in, plus the requesting company's contact details
// and the quote deadline. Returns an in-memory buffer attachment (no file saved).
async function buildRfqRequestPdfAttachment(requisitionId, options = {}) {
  const rows = await queryAsync(`
    SELECT pr.*,
           be.company_name AS business_entity_name, be.brand_color AS business_entity_brand_color, be.entity_code AS business_entity_code,
           be.address AS business_entity_address, be.phone AS business_entity_phone,
           be.email AS business_entity_email,
           c.company_name, c.company_no, p.project_docno, p.project_name
    FROM purchase_requisitions pr
    LEFT JOIN business_entities be ON be.id = pr.business_entity_id
    LEFT JOIN company_registry c ON c.id = pr.company_id
    LEFT JOIN projects p ON p.id = pr.project_id
    WHERE pr.id = ?
    LIMIT 1
  `, [requisitionId]);
  const row = rows?.[0];
  if (!row) throw new Error('Purchase requisition not found.');

  const itemRows = await queryAsync(`
    SELECT item_name, description, quantity, unit
    FROM purchase_requisition_items
    WHERE pr_id = ?
    ORDER BY id ASC
  `, [requisitionId]);

  const vendorName = String(options.vendorName || '').trim();
  const deadlineText = options.deadline ? formatPdfDate(options.deadline) : 'As soon as possible';

  const pdf = buildProfessionalSummaryPdf({
    title: 'REQUEST FOR QUOTATION',
    documentNo: `RFQ • ${row.pr_number || `PR-${row.id}`}`,
    status: '',
    brandSource: row,
    leftTitle: 'RFQ DETAILS',
    leftRows: [
      ['RFQ Date', formatPdfDate(new Date())],
      ['Quote Deadline', deadlineText],
      ['Reference PR', row.pr_number || `PR-${row.id}`],
      ['To Vendor', vendorName || '—']
    ],
    rightTitle: 'REQUESTING COMPANY',
    rightRows: [
      ['Company', row.business_entity_name || ''],
      ['Address', row.business_entity_address || ''],
      ['Phone', row.business_entity_phone || ''],
      ['Email', row.business_entity_email || '']
    ],
    tableTitle: 'ITEMS TO QUOTE',
    tableHeaders: ['Item', 'Qty', 'Unit', 'Unit Price', 'Amount'],
    tableRows: (Array.isArray(itemRows) ? itemRows : []).map((item) => ({
      Item: String(item.item_name || item.description || '-'),
      Qty: Number(item.quantity || 0),
      Unit: String(item.unit || 'pcs'),
      'Unit Price': '',
      Amount: ''
    })),
    notes: [
      options.portalUrl ? `Submit your quotation online: ${options.portalUrl}` : '',
      String(options.message || '').trim()
        || 'Please provide your best quotation (unit price, delivery lead time, payment terms, and warranty) for the items above on or before the quote deadline. You may submit online using the link above, reply to this email, or reach us using the contact details provided.'
    ].filter(Boolean).join('  •  '),
    totalLabel: '',
    totalValue: null
  });

  return {
    filename: `${toSafeAttachmentFilename(`RFQ-${row.pr_number || requisitionId}`)}.pdf`,
    content: pdf,
    contentType: 'application/pdf',
    prNumber: row.pr_number || `PR-${row.id}`,
    businessEntityName: row.business_entity_name || ''
  };
}

// Upserts a stable tokenized portal link for (PR, vendor). Re-sending refreshes the
// deadline but keeps the same token so any earlier email still works.
async function ensureRfqVendorLink(requisitionId, vendorId, businessEntityId, deadline) {
  const existing = await queryAsync(
    'SELECT id, token FROM rfq_vendor_links WHERE requisition_id = ? AND vendor_id = ? LIMIT 1',
    [requisitionId, vendorId]
  );
  if (existing.length) {
    await queryAsync(
      'UPDATE rfq_vendor_links SET deadline = ?, business_entity_id = ? WHERE id = ?',
      [deadline || null, businessEntityId || null, existing[0].id]
    );
    return existing[0].token;
  }
  const token = crypto.randomBytes(24).toString('hex');
  await queryAsync(
    'INSERT INTO rfq_vendor_links (token, requisition_id, vendor_id, business_entity_id, deadline) VALUES (?, ?, ?, ?, ?)',
    [token, requisitionId, vendorId, businessEntityId || null, deadline || null]
  );
  return token;
}

// Professional PDF of a vendor's quotation (PR items + the vendor's quoted unit prices,
// pulled from the portal submission when available, plus delivery/terms/total).
async function buildQuotationPdfAttachment(quotationId) {
  const rows = await queryAsync(`
    SELECT q.*, r.pr_number, r.business_entity_id, v.vendor_name,
           c.company_name, c.company_no, p.project_docno, p.project_name
    FROM procurement_quotations q
    JOIN purchase_requisitions r ON r.id = q.requisition_id
    LEFT JOIN business_entities be ON be.id = r.business_entity_id
    LEFT JOIN vendors v ON v.id = q.vendor_id
    LEFT JOIN company_registry c ON c.id = r.company_id
    LEFT JOIN projects p ON p.id = r.project_id
    WHERE q.id = ?
    LIMIT 1
  `, [quotationId]);
  const row = rows?.[0];
  if (!row) throw new Error('Quotation not found.');

  const itemRows = await queryAsync('SELECT id, item_name, description, quantity, unit FROM purchase_requisition_items WHERE pr_id = ? ORDER BY id ASC', [row.requisition_id]);

  // Per-line prices come from the vendor portal submission (if the vendor used it).
  const lineByItem = new Map();
  const linkRows = await queryAsync('SELECT submission FROM rfq_vendor_links WHERE requisition_id = ? AND vendor_id = ? LIMIT 1', [row.requisition_id, row.vendor_id]);
  if (linkRows.length && linkRows[0].submission) {
    try {
      const sub = JSON.parse(linkRows[0].submission);
      (Array.isArray(sub.lines) ? sub.lines : []).forEach((l) => lineByItem.set(Number(l.item_id), Number(l.unit_price) || 0));
    } catch (_) {}
  }
  const hasLinePrices = lineByItem.size > 0;

  const tableRows = (Array.isArray(itemRows) ? itemRows : []).map((it) => {
    const qty = Number(it.quantity || 0);
    const up = hasLinePrices ? (lineByItem.get(Number(it.id)) || 0) : null;
    return {
      Item: String(it.item_name || it.description || 'Item'),
      Qty: qty,
      Unit: String(it.unit || 'pcs'),
      'Unit Price': up != null ? formatPdfMoney(up) : '—',
      Amount: up != null ? formatPdfMoney(qty * up) : '—'
    };
  });

  // This is the VENDOR's own offer, so it carries NO letterhead at all (not ours, and
  // not the vendor's). Only the "VENDOR QUOTATION" title band shows; the PR/company/
  // project stay in REFERENCE. A neutral accent is used for the title/total.
  const pdf = buildProfessionalSummaryPdf({
    title: 'VENDOR QUOTATION',
    documentNo: row.quote_number || `RFQ-${row.id}`,
    status: row.status || 'submitted',
    brand: { accent: '0.20 0.23 0.28' },
    hideBrandHeader: true,
    leftTitle: 'QUOTATION DETAILS',
    leftRows: [
      ['Vendor', row.vendor_name],
      ['Quote Date', formatPdfDate(row.quote_date)],
      ['Delivery Days', Number(row.delivery_days || 0) ? `${Number(row.delivery_days)} days` : '—'],
      ['Payment Terms', row.payment_terms || '—'],
      ['Warranty', row.warranty_terms || '—']
    ],
    rightTitle: 'REFERENCE',
    rightRows: [
      ['PR No.', row.pr_number],
      ['Company', [row.company_no, row.company_name].filter(Boolean).join(' - ')],
      ['Project', [row.project_docno, row.project_name].filter(Boolean).join(' - ')],
      ['Status', row.status || 'submitted']
    ],
    tableTitle: 'QUOTED ITEMS',
    tableHeaders: ['Item', 'Qty', 'Unit', 'Unit Price', 'Amount'],
    tableRows,
    notes: row.remarks || '',
    totalLabel: 'QUOTED TOTAL',
    // buildProfessionalSummaryPdf formats this with formatPdfMoney itself; pass the
    // raw number, not a pre-formatted string (double-formatting yields NaN -> PHP 0.00).
    totalValue: Number(row.quoted_total || 0) || 0
  });

  return {
    filename: `${toSafeAttachmentFilename(`Quotation-${row.quote_number || quotationId}`)}.pdf`,
    content: pdf,
    contentType: 'application/pdf',
    quoteNumber: row.quote_number || `RFQ-${row.id}`,
    prNumber: row.pr_number,
    vendorName: row.vendor_name
  };
}

async function buildPurchaseOrderPdfAttachment(poId, options = {}) {
  const rows = await queryAsync(`
    SELECT
      po.*,
      be.company_name AS business_entity_name, be.brand_color AS business_entity_brand_color,
      be.entity_code AS business_entity_code,
      be.address AS business_entity_address,
      be.phone AS business_entity_phone,
      be.email AS business_entity_email,
      pr.pr_number,
      v.vendor_name,
      c.company_no,
      c.company_name,
      p.project_docno,
      p.project_name
    FROM purchase_orders po
    LEFT JOIN business_entities be ON be.id = po.business_entity_id
    LEFT JOIN purchase_requisitions pr ON pr.id = po.requisition_id
    LEFT JOIN vendors v ON v.id = po.vendor_id
    LEFT JOIN company_registry c ON c.id = po.company_id
    LEFT JOIN projects p ON p.id = po.project_id
    WHERE po.id = ?
    LIMIT 1
  `, [poId]);
  const row = rows?.[0];
  if (!row) throw new Error('Purchase order not found.');

  const lineItems = await queryAsync(`
    SELECT description, quantity, unit_price, line_total
    FROM po_line_items
    WHERE po_id = ?
    ORDER BY id ASC
  `, [poId]);
  const total = (Array.isArray(lineItems) ? lineItems : []).reduce((sum, item) => sum + Number(item.line_total || 0), 0) || Number(row.total_amount || 0);
  const pdf = buildProfessionalSummaryPdf({
    title: 'PURCHASE ORDER',
    documentNo: row.po_number || `PO-${row.id || ''}`,
    status: options.status || row.status || 'draft',
    brandSource: row,
    leftTitle: 'ORDER DETAILS',
    leftRows: [
      ['PO Date', formatPdfDate(row.po_date)],
      ['Delivery Date', formatPdfDate(row.delivery_date)],
      ['Vendor', row.vendor_name],
      ['Payment Terms', row.payment_terms],
      ['Prepared By', row.prepared_by],
      ['Approved By', row.approved_by]
    ],
    rightTitle: 'REFERENCE',
    rightRows: [
      ['PR No.', row.pr_number],
      ['Company', [row.company_no, row.company_name].filter(Boolean).join(' - ')],
      ['Project', [row.project_docno, row.project_name].filter(Boolean).join(' - ')],
      ['Approved At', formatPdfDate(row.approved_at)]
    ],
    tableTitle: 'ORDER ITEMS',
    tableHeaders: ['Description', 'Qty', 'Unit Cost', 'Amount'],
    tableRows: (Array.isArray(lineItems) ? lineItems : []).map((item) => ({
      Description: item.description,
      Qty: Number(item.quantity || 0),
      'Unit Cost': formatPdfMoney(item.unit_price),
      Amount: formatPdfMoney(item.line_total)
    })),
    notes: row.notes || row.approval_comment || '',
    totalLabel: 'Total Amount',
    totalValue: total,
    preparedByName: row.prepared_by || '',
    approvedByName: row.approved_by || ''
  });

  return {
    filename: `${toSafeAttachmentFilename(`purchase-order-${row.po_number || poId}`)}.pdf`,
    content: pdf,
    contentType: 'application/pdf'
  };
}

async function buildPaymentVoucherPdfAttachment(paymentId) {
  const rows = await queryAsync(`
    SELECT
      pay.*,
      ap.bill_number,
      ap.bill_date,
      ap.due_date,
      v.vendor_name,
      po.po_number,
      ar.invoice_number,
      ar.customer_name,
      be.company_name AS business_entity_name, be.brand_color AS business_entity_brand_color,
      be.entity_code AS business_entity_code,
      be.address AS business_entity_address,
      be.phone AS business_entity_phone,
      be.email AS business_entity_email
    FROM payments pay
    LEFT JOIN accounts_payable ap ON ap.id = pay.ap_id
    LEFT JOIN vendors v ON v.id = ap.vendor_id
    LEFT JOIN purchase_orders po ON po.id = ap.po_id
    LEFT JOIN accounts_receivable ar ON ar.id = pay.ar_id
    LEFT JOIN business_entities be ON be.id = COALESCE(ap.business_entity_id, ar.business_entity_id)
    WHERE pay.id = ?
    LIMIT 1
  `, [paymentId]);
  const row = rows?.[0];
  if (!row) throw new Error('Payment not found.');

  const isAp = String(row.payment_type || '').toLowerCase() === 'ap';
  const recordNo = row.reference_number || `PAY-${row.id || paymentId}`;
  const pdf = buildProfessionalSummaryPdf({
    title: isAp ? 'PAYMENT VOUCHER' : 'COLLECTION RECEIPT',
    documentNo: recordNo,
    status: row.approval_status || 'approved',
    brandSource: row,
    leftTitle: 'PAYMENT DETAILS',
    leftRows: [
      ['Payment Type', String(row.payment_type || '').toUpperCase()],
      ['Payment Date', formatPdfDate(row.payment_date)],
      ['Method', row.payment_method],
      ['Reference No.', row.reference_number],
      ['Approved By', row.approved_by],
      ['Approved At', formatPdfDate(row.approved_at)]
    ],
    rightTitle: isAp ? 'PAYABLE REFERENCE' : 'RECEIVABLE REFERENCE',
    rightRows: isAp ? [
      ['Vendor', row.vendor_name],
      ['Bill No.', row.bill_number],
      ['PO No.', row.po_number],
      ['Bill Date', formatPdfDate(row.bill_date)],
      ['Due Date', formatPdfDate(row.due_date)]
    ] : [
      ['Customer', row.customer_name],
      ['Invoice No.', row.invoice_number]
    ],
    tableTitle: 'AMOUNT SUMMARY',
    tableHeaders: ['Item', 'Value', 'Amount'],
    tableRows: [
      { Item: isAp ? 'Payment' : 'Collection', Value: row.payment_method || '-', Amount: formatPdfMoney(row.amount) },
      { Item: 'Reference', Value: row.reference_number || '-', Amount: formatPdfMoney(row.amount) }
    ],
    notes: row.notes || row.approval_comment || '',
    totalLabel: 'Payment Amount',
    totalValue: row.amount
  });

  return {
    filename: `${toSafeAttachmentFilename(`payment-voucher-${recordNo}`)}.pdf`,
    content: pdf,
    contentType: 'application/pdf'
  };
}

function buildProjectSummaryPdf(row = {}) {
  return buildProfessionalSummaryPdf({
    title: 'PROJECT SUMMARY',
    documentNo: row.project_docno || row.draft_docno || `PROJECT-${row.id || ''}`,
    status: row.status || 'planning',
    brandSource: row,
    leftTitle: 'PROJECT DETAILS',
    leftRows: [
      ['Project Title', row.project_name],
      ['Project Manager', row.project_manager],
      ['Client / Company', [row.company_no, row.company_name || row.client_name].filter(Boolean).join(' - ')],
      ['Operating Company', [row.business_entity_code, row.business_entity_name].filter(Boolean).join(' - ')],
      ['Priority', row.priority],
      ['Check No.', row.checkno],
      ['Customer PO Ref.', row.pono]
    ],
    rightTitle: 'SCHEDULE / TEAM',
    rightRows: [
      ['Planned Start', formatPdfDate(row.planned_start_date || row.start_date)],
      ['Planned End', formatPdfDate(row.planned_end_date || row.end_date)],
      ['Actual Start', formatPdfDate(row.actual_start_date)],
      ['Actual End', formatPdfDate(row.actual_end_date)],
      ['Member 1', [row.project_members, row.member_role, row.member_phone].filter(Boolean).join(' | ')],
      ['Member 2', [row.project_members_2, row.member_role_2, row.member_phone_2].filter(Boolean).join(' | ')],
      ['Member 3', [row.project_members_3, row.member_role_3, row.member_phone_3].filter(Boolean).join(' | ')]
    ],
    notes: row.description || row.status_reason || '',
    totalLabel: 'Contract Amount',
    totalValue: row.budget
  });
}

async function generateProjectPdfFile(projectId) {
  const rows = await queryAsync(`
    SELECT
      p.*,
      be.company_name AS business_entity_name, be.brand_color AS business_entity_brand_color,
      be.entity_code AS business_entity_code,
      be.address AS business_entity_address,
      be.phone AS business_entity_phone,
      be.email AS business_entity_email
    FROM projects p
    LEFT JOIN business_entities be ON be.id = p.business_entity_id
    WHERE p.id = ?
    LIMIT 1
  `, [projectId]);
  const row = rows?.[0];
  if (!row) throw new Error('Project not found.');

  const pdf = buildProjectSummaryPdf(row);
  const timestamp = Date.now();
  const filename = `${timestamp}-${Math.round(Math.random() * 1e9)}-project-${Number(projectId)}.pdf`;
  const filePath = path.join(UPLOAD_DIR, filename);
  await fs.promises.writeFile(filePath, pdf);
  await queryAsync('UPDATE projects SET pdfFilename = ? WHERE id = ?', [filename, projectId]);
  return { filename, filePath };
}

function buildBillSummaryPdf(row = {}) {
  return buildProfessionalSummaryPdf({
    title: 'ACCOUNTS PAYABLE BILL',
    documentNo: row.bill_number || `BILL-${row.id || ''}`,
    status: row.approval_status || row.status || 'pending',
    brandSource: row,
    leftTitle: 'BILL DETAILS',
    leftRows: [
      ['Bill Date', formatPdfDate(row.bill_date)],
      ['Due Date', formatPdfDate(row.due_date)],
      ['Vendor', row.vendor_name],
      ['PO Number', row.po_number],
      ['Project', [row.project_docno, row.project_name].filter(Boolean).join(' - ')],
      ['Status', row.approval_status || row.status],
      ['Approved By', row.approved_by]
    ],
    rightTitle: 'COMPANY',
    rightRows: [
      ['Operating Company', [row.business_entity_code, row.business_entity_name].filter(Boolean).join(' - ')],
      ['Client / Company', [row.company_no, row.company_name].filter(Boolean).join(' - ')],
      ['Submitted', formatPdfDate(row.created_at)],
      ['Approved At', formatPdfDate(row.approved_at)]
    ],
    notes: row.notes || '',
    totalLabel: 'Total Amount',
    totalValue: row.total_amount
  });
}

async function generateBillPdfFile(billId) {
  const rows = await queryAsync(`
    SELECT
      ap.*,
      be.company_name AS business_entity_name, be.brand_color AS business_entity_brand_color,
      be.entity_code AS business_entity_code,
      be.address AS business_entity_address,
      be.phone AS business_entity_phone,
      be.email AS business_entity_email,
      v.vendor_name,
      po.po_number,
      p.project_docno,
      p.project_name,
      c.company_no,
      c.company_name
    FROM accounts_payable ap
    LEFT JOIN business_entities be ON be.id = ap.business_entity_id
    LEFT JOIN vendors v ON v.id = ap.vendor_id
    LEFT JOIN purchase_orders po ON po.id = ap.po_id
    LEFT JOIN projects p ON p.id = ap.project_id
    LEFT JOIN company_registry c ON c.id = p.company_id
    WHERE ap.id = ?
    LIMIT 1
  `, [billId]);
  const row = rows?.[0];
  if (!row) throw new Error('Bill not found.');

  const pdf = buildBillSummaryPdf(row);
  const filename = `${Date.now()}-${Math.round(Math.random() * 1e9)}-bill-${Number(billId)}.pdf`;
  const filePath = path.join(UPLOAD_DIR, filename);
  await fs.promises.writeFile(filePath, pdf);
  await queryAsync('UPDATE accounts_payable SET pdfFilename = ? WHERE id = ?', [filename, billId]);
  return { filename, filePath };
}

async function buildBillSummaryEmailAttachment(billId) {
  const generated = await generateBillPdfFile(billId);
  return {
    filename: generated.filename,
    path: generated.filePath,
    contentType: 'application/pdf'
  };
}

function isGeneratedErpPdfFilename(filename = '', documentType = '') {
  const safeFilename = path.basename(String(filename || '').trim()).toLowerCase();
  const safeType = String(documentType || '').trim().toLowerCase();
  if (!safeFilename || !safeType) return false;
  return safeFilename.includes(`-${safeType}-`) && safeFilename.endsWith('.pdf');
}

function shouldRegenerateErpPdfFile(filename = '', filePath = '', documentType = '') {
  const safeFilename = path.basename(String(filename || '').trim());
  if (!safeFilename || !filePath || !fs.existsSync(filePath)) return true;
  return isGeneratedErpPdfFilename(safeFilename, documentType);
}

// ==================== AUTH MIDDLEWARE ====================
// isApiRequest, rejectUnauthorized, and the protect* guards now live in
// src/middleware/auth (imported at top).

async function sendBillPdf(req, res, billId) {
  try {
    const rows = await queryAsync(
      'SELECT id, bill_number, pdfFilename FROM accounts_payable WHERE id = ? LIMIT 1',
      [billId]
    );
    if (!rows.length) {
      return res.status(404).json({ error: 'Bill not found' });
    }

    const record = rows[0];
    let safeFilename = record.pdfFilename ? path.basename(record.pdfFilename) : '';
    let filePath = safeFilename ? path.join(UPLOAD_DIR, safeFilename) : '';

    if (shouldRegenerateErpPdfFile(safeFilename, filePath, 'bill')) {
      const generated = await generateBillPdfFile(record.id);
      safeFilename = generated.filename;
      filePath = generated.filePath;
    }

    noCache(res);
    res.type('application/pdf');
    if (req.query.download === '1') {
      return res.download(filePath, safeFilename);
    }

    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(safeFilename)}"`);
    return res.sendFile(filePath);
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Unable to generate bill PDF.' });
  }
}

async function sendProjectPdf(req, res, projectId) {
  try {
    const rows = await queryAsync(
      'SELECT id, project_docno, pdfFilename FROM projects WHERE id = ? LIMIT 1',
      [projectId]
    );
    if (!rows.length) {
      return res.status(404).json({ error: 'Project not found' });
    }

    const record = rows[0];
    let safeFilename = record.pdfFilename ? path.basename(record.pdfFilename) : '';
    let filePath = safeFilename ? path.join(UPLOAD_DIR, safeFilename) : '';

    if (shouldRegenerateErpPdfFile(safeFilename, filePath, 'project')) {
      const generated = await generateProjectPdfFile(projectId);
      safeFilename = generated.filename;
      filePath = generated.filePath;
    }

    noCache(res);
    res.type('application/pdf');
    if (req.query.download === '1') {
      return res.download(filePath, safeFilename);
    }

    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(safeFilename)}"`);
    return res.sendFile(filePath);
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Unable to generate project PDF.' });
  }
}

async function assertProjectAcceptsNewActivity(projectId, dbClient = null) {
  const normalizedProjectId = Number(projectId || 0) || 0;
  if (!normalizedProjectId) return;

  const rows = await queryDbAsync(
    dbClient,
    'SELECT id, status, COALESCE(is_archived, FALSE) AS is_archived FROM projects WHERE id = ? LIMIT 1',
    [normalizedProjectId]
  );
  if (!rows.length) {
    throw new Error('Selected project was not found.');
  }
  if (rows[0].is_archived === true || Number(rows[0].is_archived || 0) === 1) {
    throw new Error('Selected project is archived. Restore the project before creating new activity.');
  }
  if (isProjectAwaitingApprovalStatus(rows[0].status)) {
    throw new Error(getProjectAwaitingApprovalMessage('creating new activity'));
  }
}

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

// Phone/TIN/email validation helpers now live in src/shared/validation (imported at top).

function buildResetLink(token) {
  return `${APP_BASE_URL}/reset-password/index.html?token=${token}`;
}

// ==================== ROUTES ====================

app.get('/', (req, res) => {
    noCache(res);
    if (req.session.user) {
        if (isAdminRole(req.session.user.role)) {
            return res.redirect('/admin');
        }
        if (isStaffRole(req.session.user.role)) {
            return res.redirect('/staff');
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
        if (isAdminRole(req.session.user.role)) {
            return res.redirect('/admin');
        }
        if (isStaffRole(req.session.user.role)) {
            return res.redirect('/staff');
        }
        return res.redirect('/status');
    }
    res.sendFile(path.join(__dirname, 'public', 'login', 'index.html'));
});

app.get(['/reset-password', '/reset-password/'], (req, res) => {
    noCache(res);
    res.sendFile(path.join(__dirname, 'public', 'reset-password', 'index.html'));
});

// âœ… No-cache helper â€” para hindi ma-restore ang page via back button / bfcache
function noCache(res) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.setHeader('Surrogate-Control', 'no-store');
}

const DOCUMENT_MODULE_ALIASES = new Map([
  ['po', 'purchase_order'],
  ['purchase-orders', 'purchase_order'],
  ['purchase_order', 'purchase_order'],
  ['pr', 'purchase_requisition'],
  ['purchase-requisitions', 'purchase_requisition'],
  ['purchase_requisition', 'purchase_requisition'],
  ['quotation', 'quotation'],
  ['quotations', 'quotation'],
  ['goods-receipt', 'goods_receipt'],
  ['goods_receipt', 'goods_receipt'],
  ['project', 'project'],
  ['bill', 'bill'],
  ['ap-bill', 'bill'],
  ['receivable', 'receivable'],
  ['invoice', 'receivable']
]);

const DOCUMENT_MODULE_TABLES = {
  purchase_order: 'purchase_orders',
  purchase_requisition: 'purchase_requisitions',
  quotation: 'procurement_quotations',
  goods_receipt: 'goods_receipts',
  project: 'projects',
  bill: 'accounts_payable',
  receivable: 'accounts_receivable'
};

function normalizeDocumentModule(value) {
  const raw = String(value || '').trim().toLowerCase().replace(/\s+/g, '-');
  return DOCUMENT_MODULE_ALIASES.get(raw) || '';
}

async function assertDocumentRecordExists(moduleName, recordId) {
  const tableName = DOCUMENT_MODULE_TABLES[moduleName];
  const normalizedRecordId = Number(recordId || 0);
  if (!tableName || !normalizedRecordId) {
    const err = new Error('Invalid document target.');
    err.statusCode = 400;
    throw err;
  }

  const rows = await queryAsync(`SELECT id FROM ${tableName} WHERE id = ? LIMIT 1`, [normalizedRecordId]);
  if (!rows.length) {
    const err = new Error('Linked record was not found.');
    err.statusCode = 404;
    throw err;
  }
}

function deleteUploadedPdfIfPresent(filename) {
  const safeFilename = path.basename(String(filename || ''));
  if (!safeFilename) return;
  const filePath = path.join(UPLOAD_DIR, safeFilename);
  if (fs.existsSync(filePath)) {
    fs.unlink(filePath, () => {});
  }
}

app.get('/api/documents', protectAdmin, async (req, res) => {
  const moduleName = normalizeDocumentModule(req.query.module_name || req.query.module || '');
  const recordId = Number(req.query.record_id || 0);
  if (!moduleName || !recordId) {
    return res.status(400).json({ error: 'Document module and record ID are required.' });
  }

  try {
    await assertDocumentRecordExists(moduleName, recordId);
    const rows = await queryAsync(
      `SELECT d.*, COALESCE(u.fullname, u.username, '') AS uploaded_by_name
       FROM documents d
       LEFT JOIN users u ON u.id = d.uploaded_by
       WHERE d.module_name = ? AND d.record_id = ?
       ORDER BY d.uploaded_at DESC, d.id DESC`,
      [moduleName, recordId]
    );
    res.json(rows);
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message || 'Unable to load documents.' });
  }
});

app.post('/api/documents', protectAdmin, upload.single('pdf_file'), async (req, res) => {
  const moduleName = normalizeDocumentModule(req.body.module_name || req.body.module || '');
  const recordId = Number(req.body.record_id || 0);
  const documentType = String(req.body.document_type || 'attachment').trim().slice(0, 80) || 'attachment';

  if (!req.file) {
    return res.status(400).json({ error: 'PDF file is required.' });
  }
  if (!moduleName || !recordId) {
    deleteUploadedPdfIfPresent(req.file.filename);
    return res.status(400).json({ error: 'Document module and record ID are required.' });
  }

  try {
    await assertDocumentRecordExists(moduleName, recordId);
    const user = getAuthenticatedUser(req);
    const result = await queryAsync(
      `INSERT INTO documents
        (module_name, record_id, document_type, original_filename, stored_filename, mime_type, file_size, uploaded_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        moduleName,
        recordId,
        documentType,
        String(req.file.originalname || 'document.pdf').slice(0, 255),
        req.file.filename,
        req.file.mimetype || 'application/pdf',
        Number(req.file.size || 0),
        Number(user?.id || 0) || null
      ]
    );
    logAction(req, 'UPLOAD_DOCUMENT', `Uploaded ${documentType} for ${moduleName} #${recordId}`);
    res.json({ id: result.insertId, success: true });
  } catch (err) {
    deleteUploadedPdfIfPresent(req.file.filename);
    res.status(err.statusCode || 500).json({ error: err.message || 'Unable to upload document.' });
  }
});

app.get('/api/documents/:id/file', protectAdmin, async (req, res) => {
  const documentId = Number(req.params.id || 0);
  if (!documentId) return res.status(400).json({ error: 'Invalid document ID.' });

  try {
    const rows = await queryAsync('SELECT id, original_filename, stored_filename FROM documents WHERE id = ? LIMIT 1', [documentId]);
    if (!rows.length) return res.status(404).json({ error: 'Document not found.' });

    const record = rows[0];
    const safeFilename = path.basename(record.stored_filename || '');
    const filePath = path.join(UPLOAD_DIR, safeFilename);
    if (!safeFilename || !fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'PDF file missing on disk.' });
    }

    noCache(res);
    res.type('application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(record.original_filename || safeFilename)}"`);
    return res.sendFile(filePath);
  } catch (err) {
    res.status(500).json({ error: err.message || 'Unable to open document.' });
  }
});

app.delete('/api/documents/:id', protectAdminOnly, async (req, res) => {
  const documentId = Number(req.params.id || 0);
  if (!documentId) return res.status(400).json({ error: 'Invalid document ID.' });

  try {
    const rows = await queryAsync('SELECT id, module_name, record_id, stored_filename FROM documents WHERE id = ? LIMIT 1', [documentId]);
    if (!rows.length) return res.status(404).json({ error: 'Document not found.' });

    const record = rows[0];
    await queryAsync('DELETE FROM documents WHERE id = ?', [documentId]);
    deleteUploadedPdfIfPresent(record.stored_filename);
    logAction(req, 'DELETE_DOCUMENT', `Deleted document ${documentId} from ${record.module_name} #${record.record_id}`);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Unable to delete document.' });
  }
});

app.get('/healthz', (req, res) => {
  const payload = {
    status: 'ok',
    uptime: Math.floor(process.uptime()),
    environment: process.env.NODE_ENV || 'development',
    database: db ? 'ready' : 'initializing',
    email: hasEmailConfig || RESEND_API_KEY ? 'configured' : 'missing',
    session: sessionSecret ? 'configured' : 'missing',
    jwt: jwtSecret ? 'configured' : 'missing',
    registration: allowPublicRegistration ? 'public' : 'restricted'
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
               payment_terms = ?, total_amount = ?, paid_amount = ?, status = ?, notes = ?,
               business_entity_id = ?, project_id = ?, project_docno = ?
           WHERE id = ?`,
          [
            payload[0], payload[1], payload[2], payload[3],
            payload[4], payload[5], payload[6], payload[7],
            payload[9], payload[8], payload[10], payload[11],
            rows[0].id
          ],
          (updateErr) => done(updateErr || null)
        );
      }

      db.query(
        `INSERT INTO accounts_receivable
          (customer_name, invoice_number, invoice_date, due_date, payment_terms, total_amount, paid_amount, status, business_entity_id, notes, project_id, project_docno)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
              if (isPostgresUniqueViolation(insertErr)) return done(null);
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
    'UPDATE projects SET is_archived = ?, archived_auto = FALSE WHERE LOWER(TRIM(project_name)) = LOWER(TRIM(?))',
    [isArchived ? 1 : 0, normalized],
    (err) => done(err || null)
  );
}

function autoArchiveExpiredProjects(callback) {
  const done = typeof callback === 'function' ? callback : () => {};
  // Overdue projects stay visible in Total Projects; we no longer auto-hide them.
  done(null);
}

function autoRestoreActiveProjects(callback) {
  const done = typeof callback === 'function' ? callback : () => {};
  db.query(
    `UPDATE projects
     SET is_archived = FALSE,
         archived_at = NULL,
         archived_auto = FALSE
     WHERE COALESCE(archived_auto, FALSE) = TRUE`,
    (err) => done(err || null)
  );
}

function runArchiveMaintenance(callback) {
  const done = typeof callback === 'function' ? callback : () => {};
  // Project auto-restore/archive only. (The legacy transaction backfill + auto
  // archive/restore steps were removed with the retired Transactions feature.)
  autoRestoreActiveProjects((projectRestoreErr) => {
    if (projectRestoreErr) return done(projectRestoreErr);
    autoArchiveExpiredProjects((projectArchiveErr) => done(projectArchiveErr || null));
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

function sendAdminWorkspacePage(req, res) {
  noCache(res);
  res.sendFile(path.join(__dirname, 'public', 'admin', 'index.html'));
}

function sendStaffPage(req, res) {
  noCache(res);
  res.sendFile(path.join(__dirname, 'public', 'staff', 'index.html'));
}

app.get('/admin', protectAdminOnly, (req, res) => {
  sendAdminWorkspacePage(req, res);
});

app.get('/staff', protectStaffOnly, (req, res) => {
  sendStaffPage(req, res);
});

app.get('/accounts-payable', protectAdmin, handleAccountsPayablePage);

app.get('/accounts-receivable', protectAdmin, (req, res) => {
  noCache(res);
  // Migrated to React (Invoices / Collections / Customer Balances / AR Aging / Documents +
  // Add Invoice + Record Collection). Serve the React build when present; fall back to the
  // classic page (backed up in _legacy_pages/) if the bundle is missing. Revert this branch +
  // move the dir back to roll back. See [[react-migration]].
  const reactIndex = path.join(__dirname, 'public', 'react', 'index.html');
  const target = fs.existsSync(reactIndex)
    ? reactIndex
    : path.join(__dirname, '_legacy_pages', 'accounts-receivable', 'index.html');
  res.sendFile(target);
});

app.get('/inventory', protectAdmin, (req, res) => {
  noCache(res);
  res.sendFile(path.join(__dirname, 'public', 'inventory', 'index.html'));
});

app.get(['/crm', '/crm/'], protectAdmin, (req, res) => {
  noCache(res);
  res.sendFile(path.join(__dirname, 'public', 'crm', 'index.html'));
});

app.get('/reports', protectAdminOnly, (req, res) => {
  noCache(res);
  res.sendFile(path.join(__dirname, 'public', 'reports', 'index.html'));
});

app.get('/gantt-chart', protectAdminOnly, (req, res) => {
  noCache(res);
  res.sendFile(path.join(__dirname, 'public', 'gantt-chart', 'index.html'));
});

app.get('/user-management', protectAdminOnly, (req, res) => {
  noCache(res);
  // Migrated to React. The classic page is backed up at _legacy_pages/user-management/
  // (moved OUT of public/ so express.static doesn't intercept the route). Built by:
  // cd client && npm run build
  const reactIndex = path.join(__dirname, 'public', 'react', 'index.html');
  const target = fs.existsSync(reactIndex) ? reactIndex : path.join(__dirname, '_legacy_pages', 'user-management', 'index.html');
  res.sendFile(target);
});

app.get('/business-entities', protectSuperAdmin, (req, res) => {
  noCache(res);
  // Migrated to React (classic backup at _legacy_pages/business-entities/).
  const reactIndex = path.join(__dirname, 'public', 'react', 'index.html');
  const target = fs.existsSync(reactIndex) ? reactIndex : path.join(__dirname, '_legacy_pages', 'business-entities', 'index.html');
  res.sendFile(target);
});

app.get(['/system-overview', '/system-overview/'], (req, res) => {
  noCache(res);
  res.sendFile(path.join(__dirname, 'public', 'system-overview', 'index.html'));
});

app.get('/procurement', protectAdmin, handleProcurementPage);

app.get('/master-data', protectAdmin, handleMasterDataPage);

app.get('/erp', protectAdmin, (req, res) => {
  noCache(res);
  if (String(req.query?.embedded || '') !== '1') {
    return res.redirect(301, '/master-data?tab=companies');
  }
  res.sendFile(path.join(__dirname, 'public', 'company', 'index.html'));
});

app.get('/company-registry', protectAdmin, (req, res) => {
  noCache(res);
  res.redirect(301, '/master-data?tab=companies');
});

app.get(['/company', '/company/index.html'], protectAdmin, (req, res) => {
  noCache(res);
  res.redirect(301, '/master-data?tab=companies');
});

app.get('/status', protectAuthenticated, (req, res) => {
  noCache(res);
  res.sendFile(path.join(__dirname, 'public', 'user-index', 'index.html'));
});



app.get('/api/me', async (req, res) => {
  noCache(res);
  const user = getAuthenticatedUser(req);
  if (!user) {
    return res.status(401).json({ loggedIn: false });
  }

  try {
    const rows = await queryAsync(
      'SELECT id, username, fullname, email, role, active FROM users WHERE id = ? LIMIT 1',
      [user.id]
    );
    const freshUser = rows && rows[0];

    if (!freshUser || Number(freshUser.active) !== 1) {
      if (req.session?.user) {
        req.session.destroy(() => {});
      }
      return res.status(401).json({ loggedIn: false });
    }

    const freshRole = normalizeAccessRole(freshUser.role);
    const currentUser = {
      id: freshUser.id,
      username: freshUser.username,
      fullname: freshUser.fullname,
      email: freshUser.email,
      role: freshRole
    };

    if (req.session?.user) {
      req.session.user = currentUser;
    }

    const csrfToken = req.session?.user ? ensureSessionCsrfToken(req) : '';
    res.json({
      loggedIn: true,
      id: currentUser.id,
      username: currentUser.username,
      fullname: currentUser.fullname,
      role: currentUser.role,
      email: currentUser.email,
      permissions: getRolePermissions(currentUser.role),
      inactivityTimeoutMs: sessionMaxAgeMs,
      csrfToken
    });
  } catch (err) {
    console.error('Current user lookup error:', err);
    res.status(500).json({ loggedIn: false, message: 'Unable to verify current user' });
  }
});

app.get('/api/session/refresh', protectAuthenticated, (req, res) => {
  noCache(res);
  const csrfToken = req.session?.user ? ensureSessionCsrfToken(req) : '';
  res.json({
    loggedIn: true,
    inactivityTimeoutMs: sessionMaxAgeMs,
    csrfToken
  });
});

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// AUTHENTICATION
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

app.post('/api/register/send-verification', registerVerificationRateLimiter, async (req, res) => {
  if (!allowPublicRegistration) {
    return res.status(403).json({ status: 'error', message: 'Public registration is disabled.' });
  }

  const name = String(req.body?.name || '').trim();
  const email = String(req.body?.email || '').trim().toLowerCase();
  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  if (!name || !email) {
    return res.status(400).json({ status: 'error', message: 'Complete name and email before sending a code.' });
  }
  if (!emailPattern.test(email)) {
    return res.status(400).json({ status: 'error', message: 'Invalid email format' });
  }

  try {
    const duplicateRows = await queryAsync(
      'SELECT email FROM users WHERE LOWER(email) = ? LIMIT 1',
      [email]
    );
    if (duplicateRows.length) {
      return res.status(400).json({ status: 'error', message: 'Email already exists' });
    }

    const code = String(crypto.randomInt(100000, 1000000));
    const codeHash = hashRegistrationVerificationCode(email, code);
    await queryAsync(`
      INSERT INTO registration_email_verifications (email, code_hash, requested_at, expires_at, attempts, verified_at)
      VALUES (?, ?, NOW(), NOW() + INTERVAL '10 minutes', 0, NULL)
      ON CONFLICT (email)
      DO UPDATE SET
        code_hash = EXCLUDED.code_hash,
        requested_at = NOW(),
        expires_at = NOW() + INTERVAL '10 minutes',
        attempts = 0,
        verified_at = NULL
      RETURNING email
    `, [email, codeHash]);

    const emailResult = await sendSystemEmail({
      from: `Kinaadman ERP <${SMTP_FROM}>`,
      to: email,
      subject: 'Your Kinaadman ERP verification code',
      text: `Your verification code is ${code}. It expires in 10 minutes.`,
      html: `
        <div style="font-family:Arial,sans-serif;color:#1f2937;line-height:1.5;">
          <h2 style="margin:0 0 12px;">Email Verification</h2>
          <p style="margin:0 0 12px;">Use this code to finish creating your Kinaadman ERP account:</p>
          <div style="font-size:28px;font-weight:800;letter-spacing:6px;background:#f3f4f6;border:1px solid #d1d5db;border-radius:8px;padding:14px 18px;display:inline-block;">${htmlEscape(code)}</div>
          <p style="margin:14px 0 0;">This code expires in 10 minutes.</p>
        </div>
      `
    });

    logAction(req, 'REGISTER_EMAIL_VERIFICATION', `Verification code requested for ${email}`);
    if (!emailResult.sent && isProduction) {
      return res.status(503).json({ status: 'error', message: 'Verification email is unavailable right now.' });
    }

    return res.json({
      status: 'success',
      message: emailResult.sent
        ? 'Verification code sent. Please check your email.'
        : 'Email sender is not configured. Use the verification code below for local testing.',
      ...(emailResult.sent ? {} : { verificationCode: code })
    });
  } catch (error) {
    console.error('Register verification error:', error);
    res.status(500).json({ status: 'error', message: 'Unable to send verification code.' });
  }
});

app.post('/register', registerRateLimiter, async (req, res) => {
  if (!allowPublicRegistration) {
    return res.status(403).json({ status: 'error', message: 'Public registration is disabled.' });
  }

  const name = String(req.body?.name || '').trim();
  const requestedUsername = String(req.body?.username || '').trim();
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  const verificationCode = normalizeRegistrationVerificationCode(req.body?.verificationCode);
  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  if (!name || !email || !password) {
    return res.status(400).json({ status: 'error', message: 'All fields are required' });
  }

  if (String(password).length < 8) {
    return res.status(400).json({ status: 'error', message: 'Password must be at least 8 characters long' });
  }
  if (!emailPattern.test(email)) {
    return res.status(400).json({ status: 'error', message: 'Invalid email format' });
  }
  if (verificationCode.length !== 6) {
    return res.status(400).json({ status: 'error', message: 'Enter the 6-digit email verification code.' });
  }

  try {
    await validateRegistrationVerificationCode(email, verificationCode);
    const username = requestedUsername || await generateUniqueUsernameFromEmail(email);
    db.query('SELECT id FROM users WHERE username = ?', [username], async (err, rows) => {
      if (err) return res.status(500).json({ status: 'error', message: 'Database error' });
      if (rows.length > 0)
        return res.status(400).json({ status: 'error', message: 'Unable to prepare account. Please try again.' });

      db.query('SELECT id FROM users WHERE email = ?', [email], (err, rows) => {
        if (err) return res.status(500).json({ status: 'error', message: 'Database error' });
        if (rows.length > 0)
          return res.status(400).json({ status: 'error', message: 'Email already exists' });

        bcrypt.hash(password, 10, (err, hashedPassword) => {
          if (err) return res.status(500).json({ status: 'error', message: 'Password hashing error' });

          db.query(
            'INSERT INTO users (fullname, username, email, password, role, active, approval_status, created_at) VALUES (?, ?, ?, ?, ?, false, ?, NOW())',
            [name, username, email, hashedPassword, 'staff', 'pending'],
            async (err) => {
              if (err) return res.status(500).json({ status: 'error', message: 'Failed to create account' });
              await queryAsync('DELETE FROM registration_email_verifications WHERE email = ?', [email]).catch((cleanupErr) => {
                console.error('Registration verification cleanup error:', cleanupErr);
              });
              logAction(req, 'REGISTER_REQUEST', `Public account requested approval: ${email}`);
              sendBackgroundNotification(() => notifyApprovalRequest(req, {
                title: 'User Registration',
                recordNo: email,
                submittedBy: `${name} (Staff)`,
                reviewPath: '/user-management',
                details: {
                  Name: name,
                  Email: email,
                  Role: 'Staff'
                }
              }), 'user registration approval email');
              res.json({ status: 'success', message: 'Registration submitted. Please wait for admin approval before signing in.' });
            }
          );
        });
      });
    });
  } catch (error) {
    const validationMessage = String(error?.message || '');
    if (/verification|code|expired|incorrect/i.test(validationMessage)) {
      return res.status(400).json({ status: 'error', message: validationMessage });
    }
    console.error('Register route error:', error);
    res.status(500).json({ status: 'error', message: 'Server error' });
  }
});

// âœ… FIXED LOGIN â€” Suportahan ang bcrypt (registered users) AT plain text (legacy)
app.post('/login', loginRateLimiter, async (req, res) => {
  const username = String(req.body?.username || req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');

  if (!username || !password) {
    return res.status(400).json({ status: 'error', message: 'Email and password are required' });
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

  db.query('SELECT * FROM users WHERE LOWER(username) = ? OR LOWER(email) = ? LIMIT 1', [username, username], async (err, rows) => {
    if (err) return res.status(500).json({ status: 'error', message: 'Database error' });

    if (rows.length === 0) {
      const lockState = registerLoginFailure(req, username);
      auditLoginFailure(req, username, lockState, 'no matching account');
      if (lockState.locked) {
        res.setHeader('Retry-After', String(lockState.retryAfter));
        return res.status(429).json({
          status: 'error',
          message: `Too many login attempts. Try again in ${lockState.retryAfter} seconds.`,
          retryAfter: lockState.retryAfter,
          attemptsRemaining: 0
        });
      }
      return res.status(401).json({
        status: 'error',
        message: 'Invalid email or password',
        attemptsRemaining: lockState.attemptsRemaining
      });
    }

    const user = rows[0];
    if (String(user.approval_status || 'approved') === 'pending') {
      registerLoginFailure(req, username);
      return res.status(403).json({ status: 'error', message: 'Account pending admin approval.' });
    }
    if (String(user.approval_status || 'approved') === 'rejected') {
      registerLoginFailure(req, username);
      return res.status(403).json({ status: 'error', message: 'Registration was not approved. Please contact the administrator.' });
    }
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
      auditLoginFailure(req, username, lockState, 'wrong password');
      if (lockState.locked) {
        res.setHeader('Retry-After', String(lockState.retryAfter));
        return res.status(429).json({
          status: 'error',
          message: `Too many login attempts. Try again in ${lockState.retryAfter} seconds.`,
          retryAfter: lockState.retryAfter,
          attemptsRemaining: 0
        });
      }
      return res.status(401).json({
        status: 'error',
        message: 'Invalid email or password',
        attemptsRemaining: lockState.attemptsRemaining
      });
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
        fullname: user.fullname,
        email:    user.email
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
        fullname: user.fullname,
        email: user.email
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

  const retryAfter = getForgotPasswordRetryAfter(req, email);
  if (retryAfter > 0) {
    res.setHeader('Retry-After', String(retryAfter));
    return res.status(429).json({
      status: 'error',
      message: `Please wait ${retryAfter} seconds before requesting another reset link.`,
      retryAfter
    });
  }

  db.query('SELECT id, username FROM users WHERE email = ?', [email], (err, rows) => {
    if (err) return res.status(500).json({ status: 'error', message: 'Database error' });
    if (rows.length === 0) {
      startForgotPasswordCooldown(req, email);
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

      if (!hasAnyEmailConfig) {
        console.warn('Email sender is not configured.');
        if (isProduction) {
          return res.status(503).json({
            status: 'error',
            message: 'Password reset email is unavailable right now.'
          });
        }
        console.warn(`Reset link for ${email}: ${resetLink}`);
        startForgotPasswordCooldown(req, email);
        return res.json({
          status: 'success',
          message: 'Email sender is not configured yet. Use the reset link below for now.',
          retryAfter: Math.ceil(FORGOT_PASSWORD_RESEND_COOLDOWN_MS / 1000),
          resetLink
        });
      }

      sendSystemEmail(mailOptions).then((emailResult) => {
        if (!emailResult.sent) {
          return res.status(500).json({
            status: 'error',
            message: 'Failed to send email. Check SMTP settings in server environment.'
          });
        }
        startForgotPasswordCooldown(req, email);
        res.json({
          status: 'success',
          message: 'Reset link sent to your email',
          retryAfter: Math.ceil(FORGOT_PASSWORD_RESEND_COOLDOWN_MS / 1000)
        });
      }).catch((mailErr) => {
        console.error('Email error:', mailErr);
        res.status(500).json({
          status: 'error',
          message: 'Failed to send email. Check SMTP settings in server environment.'
        });
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
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// PROTECTED API
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// ── Transactions feature RETIRED (legacy) ─────────────────────────────────────
// The current flows are Project → Procurement (PR→RFQ→PO→AP/GRN→Inventory) and
// Project → Sales Management (Inquiry→SO→AR/DR→Inventory). "Transactions" / the old
// "Project Records" view is no longer part of the UI, so its endpoints are disabled
// here to remove the unused (legacy) request surface. The old route handlers have been
// DELETED (~580 lines); this single guard now answers any lingering /api/transactions* call
// with 410 Gone (e.g. the Reports page degrades gracefully to an empty transactions list).
// The `transactions` TABLE is dropped by dropLegacyTables() and the legacy sync helpers were
// deleted. (createReceivableFromDeliveryRecord — the Sales Order → AR invoice builder — stays;
// it is NOT transaction-related.) This guard stays until the frontend stops calling /api/transactions.
app.use('/api/transactions', (req, res) => {
  res.status(410).json({ error: 'The Transactions feature has been retired. Use Projects → Procurement (AP) or Sales Management (AR).' });
});


function generateNextProjectDocno(callback, businessEntityId = null) {
  generateNextProjectDocnoAsync(businessEntityId)
    .then((projectDocno) => callback(null, projectDocno))
    .catch((err) => callback(err));
}

function generateNextCompanyNo(callback) {
  const prefix = 'CMP';

  db.query(
    `SELECT COALESCE(MAX(CAST(SUBSTRING(company_no FROM 5) AS integer)), 0) AS max_seq
     FROM company_registry
     WHERE company_no ~ ?`,
    [`^${prefix}-[0-9]+$`],
    (err, rows) => {
      if (err) return callback(err);

      const nextNum = (Number(rows?.[0]?.max_seq || 0) || 0) + 1;

      callback(null, `${prefix}-${String(nextNum).padStart(3, '0')}`);
    }
  );
}

function generateNextCompanyNoPromise() {
  return new Promise((resolve, reject) => {
    generateNextCompanyNo((err, companyNo) => {
      if (err) reject(err);
      else resolve(companyNo);
    });
  });
}

function sanitizeCompanyRegistryPayload(input = {}) {
  const companyTinDigits = normalizeTin(input.tin || '');
  return {
    company_no: String(input.company_no || '').trim(),
    branch_code: String(input.branch_code || '').trim().slice(0, 10) || '000',
    company_name: String(input.company_name || '').trim(),
    contact_person: String(input.contact_person || '').trim(),
    email: String(input.email || '').trim(),
    phone: normalizePhone(input.phone || ''),
    tin: companyTinDigits ? formatTin(companyTinDigits) : '',
    address: String(input.address || '').trim(),
    status: String(input.status || 'active').trim() || 'active',
    notes: String(input.notes || '').trim()
  };
}

function validateCompanyRegistryPayload(payload = {}) {
  if (!payload.company_name) throw new Error('Company name is required.');
  if (!payload.contact_person) throw new Error('Contact Person is required.');
  if (!payload.email) throw new Error('Email is required.');
  if (!isValidEmail(payload.email)) {
    const err = new Error('Please enter a valid email address.');
    err.field = 'email';
    throw err;
  }
  if (!isValidCompanyRegistryPhone(payload.phone)) {
    const err = new Error('Company phone number must be exactly 11 digits and numbers only.');
    err.field = 'phone';
    throw err;
  }
  if (normalizeTin(payload.tin).length !== 12) {
    const err = new Error('TIN must follow 000-000-000-000 format.');
    err.field = 'tin';
    throw err;
  }
  if (!payload.address) throw new Error('Address is required.');
}

function assertCompanyRegistryPayloadUnique(payload = {}) {
  return new Promise((resolve, reject) => {
    findCompanyRegistryDuplicate(payload.company_name, payload.phone, payload.tin, 0, null, (dupErr, duplicate) => {
      if (dupErr) return reject(dupErr);
      if (!duplicate) return resolve();
      const err = new Error(
        duplicate.field === 'tin'
          ? 'TIN already exists in Company Registry.'
          : duplicate.field === 'phone'
            ? 'Company phone already exists in Company Registry.'
            : 'Company name already exists in Company Registry.'
      );
      err.field = duplicate.field;
      reject(err);
    });
  });
}

async function insertApprovedCompanyRegistryFromRequest(payload = {}) {
  let lastErr = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const companyNo = await generateNextCompanyNoPromise();
    try {
      await queryAsync(`
        INSERT INTO company_registry
          (company_no, business_entity_id, branch_code, company_name, address, contact_person, phone, email, tin, industry, status, notes)
        VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
      `, [
        companyNo,
        payload.branch_code || '000',
        payload.company_name,
        payload.address || null,
        payload.contact_person || null,
        payload.phone || null,
        payload.email || null,
        payload.tin || null,
        payload.status || 'active',
        payload.notes || null
      ]);
      return companyNo;
    } catch (err) {
      if (!isPostgresUniqueViolation(err)) throw err;
      lastErr = err;
    }
  }
  throw lastErr || new Error('Unable to assign a company number.');
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
     WHERE COALESCE(is_archived, FALSE) = FALSE
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

  queryAsync(
    `SELECT COALESCE(MAX(CAST(SUBSTRING(vendor_no FROM ?) AS integer)), 0) AS max_seq
     FROM vendors
     WHERE vendor_no LIKE ?`,
    [`^${prefix}-([0-9]+)$`, `${prefix}-%`]
  )
    .then((rows) => {
      const maxSeq = Number(rows?.[0]?.max_seq || 0) || 0;
      callback(null, formatVendorNo(year, maxSeq + 1));
    })
    .catch((err) => callback(err));
}

function generateNextVendorNoPromise() {
  return new Promise((resolve, reject) => {
    generateNextVendorNo((err, vendorNo) => {
      if (err) reject(err);
      else resolve(vendorNo);
    });
  });
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
      SELECT id, project_docno, status, created_at, start_date, project_ar_invoice_no, project_ap_bill_no
      FROM projects
      ORDER BY COALESCE(created_at, start_date::timestamp, to_timestamp(0)) ASC, id ASC
    `);

    if (!Array.isArray(projectRows) || !projectRows.length) {
      projectDocnoMigrationCompleted = true;
      return;
    }

    const usedByMonth = new Map();
    const plan = [];

    for (const row of projectRows) {
      if (['draft', 'submitted'].includes(String(row.status || '').trim().toLowerCase())) continue;
      const createdAt = row.created_at || row.start_date || new Date();
      const monthKey = getProjectMonthKey(createdAt);
      const currentDocno = String(row.project_docno || '').trim();
      const monthSet = usedByMonth.get(monthKey) || new Set();
      usedByMonth.set(monthKey, monthSet);

      let finalDocno = currentDocno;
      // New canonical format PRJ_<code>-<year><5-digit seq> (e.g. PRJ_KVSK-202600001)
      // is kept verbatim — this legacy dated-format migration must never reformat it.
      const isNewProjectDocnoFormat = /^PRJ_[A-Za-z0-9]+-\d{9}$/.test(currentDocno);
      const keepCurrent = isNewProjectDocnoFormat
        || (/^PRJ-\d{4}-\d{2}-\d{2}$/.test(currentDocno) && currentDocno.startsWith(`PRJ-${monthKey}-`));

      if (keepCurrent) {
        if (!isNewProjectDocnoFormat) {
          const suffix = Number(currentDocno.slice(-2));
          if (Number.isInteger(suffix) && suffix > 0) {
            monthSet.add(suffix);
          } else {
            finalDocno = '';
          }
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
    if (isPostgresUndefinedTable(err) && attempt < 12) {
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


app.get('/api/archive-center', protectAdmin, async (req, res) => {
  try {
    const [
      projectRows,
      companyRows,
      receivableRows
    ] = await Promise.all([
      queryAsync(`
        SELECT
          p.id,
          p.project_docno,
          p.project_name,
          p.company_name,
          p.client_name,
          p.status,
          p.archived_at,
          p.created_at,
          p.start_date,
          c.company_name AS registry_company_name
        FROM projects p
        LEFT JOIN company_registry c ON c.id = p.company_id
        WHERE COALESCE(p.is_archived, FALSE) = TRUE
          AND LOWER(COALESCE(p.status, '')) NOT IN ('draft', 'needs_revision')
        ORDER BY COALESCE(p.archived_at, p.created_at) DESC, p.id DESC
      `),
      queryAsync(`
        SELECT id, company_no, company_name, contact_person, phone, email, status, archived_at, created_at
        FROM company_registry
        WHERE COALESCE(archived, FALSE) = TRUE
        ORDER BY COALESCE(archived_at, created_at) DESC, id DESC
      `),
      queryAsync(`
        SELECT id, invoice_number, project_docno, customer_name, status, archived_at, invoice_date, created_at
        FROM accounts_receivable
        WHERE COALESCE(archived, FALSE) = TRUE
        ORDER BY COALESCE(archived_at, invoice_date::timestamp, created_at) DESC, id DESC
      `)
    ]);

    const rows = [
      ...(projectRows || []).map((row) => {
        const title = joinArchiveCenterText(row.project_docno, row.project_name) || `Project #${row.id}`;
        const party = row.registry_company_name || row.company_name || row.client_name || '-';
        return {
          type: 'Project',
          type_key: 'project',
          key: `project:${row.id}`,
          id: Number(row.id || 0),
          restore_url: `/api/projects/${Number(row.id || 0)}/restore`,
          title,
          party,
          status: row.status || 'archived',
          date: formatArchiveCenterDate(row.archived_at, row.created_at, row.start_date),
          search: joinArchiveCenterText(row.project_docno, row.project_name, party, row.status)
        };
      }),
      ...(companyRows || []).map((row) => {
        const title = joinArchiveCenterText(row.company_no, row.company_name) || `Company #${row.id}`;
        const party = row.contact_person || row.phone || row.email || '-';
        return {
          type: 'Company',
          type_key: 'company',
          key: `company:${row.id}`,
          id: Number(row.id || 0),
          restore_url: `/api/company-registry/${Number(row.id || 0)}/restore`,
          title,
          party,
          status: row.status || 'archived',
          date: formatArchiveCenterDate(row.archived_at, row.created_at),
          search: joinArchiveCenterText(row.company_no, row.company_name, row.contact_person, row.phone, row.email, row.status)
        };
      }),
      ...(receivableRows || []).map((row) => {
        const title = joinArchiveCenterText(row.invoice_number, row.project_docno) || `Receivable #${row.id}`;
        return {
          type: 'A/R',
          type_key: 'receivable',
          key: `receivable:${row.id}`,
          id: Number(row.id || 0),
          restore_url: `/api/receivables/${Number(row.id || 0)}/restore`,
          title,
          party: row.customer_name || '-',
          status: row.status || 'archived',
          date: formatArchiveCenterDate(row.archived_at, row.invoice_date, row.created_at),
          search: joinArchiveCenterText(row.invoice_number, row.project_docno, row.customer_name, row.status)
        };
      })
    ];

    // Additional archived sources (procurement, AP, sales, CRM). Each query is best-effort:
    // a missing table/column just yields no rows for that type (never breaks the page).
    const safeArchiveQuery = async (sql) => { try { return await queryAsync(sql); } catch (_) { return []; } };
    const extraSources = [
      { type: 'Purchase Requisition', key: 'purchase-requisition', party: () => 'Procurement', sql: "SELECT id, COALESCE(pr_number, draft_pr_number, 'PR #'||id) AS label, status, archived_at AS dt, created_at FROM purchase_requisitions WHERE COALESCE(archived,FALSE)=TRUE ORDER BY COALESCE(archived_at, created_at) DESC, id DESC" },
      { type: 'Purchase Order', key: 'purchase-order', party: () => 'Procurement', sql: "SELECT id, COALESCE(po_number, draft_po_number, 'PO #'||id) AS label, status, archived_at AS dt, created_at FROM purchase_orders WHERE COALESCE(archived,FALSE)=TRUE ORDER BY COALESCE(archived_at, created_at) DESC, id DESC" },
      { type: 'Goods Receipt', key: 'goods-receipt', party: () => 'Procurement', sql: "SELECT id, grn_number AS label, status, archived_at AS dt, created_at FROM goods_receipts WHERE COALESCE(archived,FALSE)=TRUE ORDER BY COALESCE(archived_at, created_at) DESC, id DESC" },
      { type: 'RFQ / Quotation', key: 'quotation', party: () => 'Procurement', sql: "SELECT id, COALESCE(quote_number, draft_quote_number, 'RFQ #'||id) AS label, status, archived_at AS dt, created_at FROM procurement_quotations WHERE COALESCE(archived,FALSE)=TRUE ORDER BY COALESCE(archived_at, created_at) DESC, id DESC" },
      { type: 'AP Bill', key: 'ap-bill', party: () => 'Accounts Payable', sql: "SELECT id, COALESCE(bill_number, draft_bill_number, invoice_number, 'BILL #'||id) AS label, status, archived_at AS dt, created_at FROM accounts_payable WHERE COALESCE(archived,FALSE)=TRUE ORDER BY COALESCE(archived_at, created_at) DESC, id DESC" },
      { type: 'Sales', key: 'sales', party: () => 'Sales Management', sql: "SELECT id, document_no AS label, status, archived_at AS dt, created_at FROM sales_management_records WHERE COALESCE(archived,FALSE)=TRUE ORDER BY COALESCE(archived_at, created_at) DESC, id DESC" },
      { type: 'Lead', key: 'lead', party: (r) => r.company_name || 'CRM', sql: "SELECT id, COALESCE(lead_docno, lead_name, 'Lead #'||id) AS label, approval_status AS status, updated_at AS dt, created_at, company_name FROM crm_leads WHERE COALESCE(archived,FALSE)=TRUE ORDER BY COALESCE(updated_at, created_at) DESC, id DESC" },
      { type: 'Contact', key: 'contact', party: (r) => r.company_name || 'CRM', sql: "SELECT id, contact_name AS label, 'archived' AS status, updated_at AS dt, created_at, company_name FROM crm_contacts WHERE COALESCE(archived,FALSE)=TRUE ORDER BY COALESCE(updated_at, created_at) DESC, id DESC" }
    ];
    for (const src of extraSources) {
      const srcRows = await safeArchiveQuery(src.sql);
      for (const r of (srcRows || [])) {
        rows.push({
          type: src.type,
          type_key: src.key,
          key: `${src.key}:${Number(r.id || 0)}`,
          id: Number(r.id || 0),
          restore_url: `/api/archive-center/restore/${src.key}/${Number(r.id || 0)}`,
          title: String(r.label || `${src.type} #${r.id}`),
          party: String(src.party(r) || '-'),
          status: String(r.status || 'archived'),
          date: formatArchiveCenterDate(r.dt, r.created_at),
          search: joinArchiveCenterText(r.label, src.party(r), r.status)
        });
      }
    }

    rows.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')) || String(a.type || '').localeCompare(String(b.type || '')));

    // Dynamic counts keyed by type_key — the frontend builds tabs from these.
    const counts = {};
    for (const r of rows) counts[r.type_key] = (counts[r.type_key] || 0) + 1;

    res.json({ counts, rows });
  } catch (err) {
    console.error('Archive center error:', err);
    res.status(500).json({ error: err.message || 'Unable to load archive center.' });
  }
});

// Generic restore-from-archive for the archive-only sources (whitelisted table + flag column).
app.put('/api/archive-center/restore/:type/:id', protectAdminOnly, async (req, res) => {
  const RESTORE_MAP = {
    'purchase-requisition': { table: 'purchase_requisitions', flag: 'archived' },
    'purchase-order': { table: 'purchase_orders', flag: 'archived' },
    'goods-receipt': { table: 'goods_receipts', flag: 'archived' },
    'quotation': { table: 'procurement_quotations', flag: 'archived' },
    'ap-bill': { table: 'accounts_payable', flag: 'archived' },
    'sales': { table: 'sales_management_records', flag: 'archived' },
    'lead': { table: 'crm_leads', flag: 'archived' },
    'contact': { table: 'crm_contacts', flag: 'archived' }
  };
  const cfg = RESTORE_MAP[String(req.params.type || '').toLowerCase()];
  const id = Number(req.params.id || 0) || 0;
  if (!cfg || !id) return res.status(400).json({ error: 'Invalid archive restore target.' });
  try {
    await queryAsync(`UPDATE ${cfg.table} SET ${cfg.flag} = FALSE WHERE id = ?`, [id]);
    logAction(req, 'RESTORE_FROM_ARCHIVE', `Restored ${req.params.type} #${id} from archive`, 'system', { entityId: id });
    res.json({ success: true });
  } catch (err) {
    console.error('Archive restore error:', err);
    res.status(500).json({ error: err.message || 'Unable to restore record.' });
  }
});

// Dashboard reminders — due-date driven counts: overdue AR invoices, AP bills due within 7 days,
// and CRM follow-ups due today/overdue. Best-effort per source so a missing column never 500s.
app.get('/api/alerts', protectAdmin, async (req, res) => {
  const one = async (sql) => { try { const r = await queryAsync(sql); return Number(r?.[0]?.n || 0); } catch (_) { return 0; } };
  const [overdueAr, apDueSoon, crmFollowups] = await Promise.all([
    one("SELECT COUNT(*)::int AS n FROM accounts_receivable WHERE COALESCE(archived,FALSE)=FALSE AND due_date IS NOT NULL AND due_date < CURRENT_DATE AND (COALESCE(total_amount,0) - COALESCE(paid_amount,0)) > 0.005 AND LOWER(COALESCE(status,'')) NOT IN ('paid','cancelled','void')"),
    one("SELECT COUNT(*)::int AS n FROM accounts_payable WHERE due_date IS NOT NULL AND due_date <= CURRENT_DATE + INTERVAL '7 days' AND (COALESCE(total_amount,0) - COALESCE(paid_amount,0)) > 0.005 AND LOWER(COALESCE(status,'')) NOT IN ('paid','cancelled','void')"),
    one("SELECT COUNT(*)::int AS n FROM crm_leads WHERE COALESCE(archived,FALSE)=FALSE AND next_follow_up_date IS NOT NULL AND next_follow_up_date <= CURRENT_DATE AND LOWER(COALESCE(stage,'')) NOT IN ('won','lost')")
  ]);
  res.json({ overdue_ar: overdueAr, ap_due_soon: apDueSoon, crm_followups: crmFollowups });
});

// ==================== EDIT TRANSACTION (PUT) ====================

// ==================== ACCOUNTS PAYABLE API ====================

// Vendors routes (master-data) — extracted to src/modules/master-data/vendors (step 5).
app.use(require('./src/modules/master-data/vendors/vendors.routes')({ generateNextVendorNo, findVendorDuplicate, logAction }));

// company-registry/next-no — moved to module (mount below).

// Company Registry requests (staff draft/approval workflow) — extracted to src/modules/master-data/company-registry (step 6c).
app.use(require('./src/modules/master-data/company-registry/company-registry-requests.routes')({ generateDraftRequestNo, sanitizeCompanyRegistryPayload, validateCompanyRegistryPayload, assertCompanyRegistryPayloadUnique, insertApprovedCompanyRegistryFromRequest, stripDraftRequestNoPrefix, getApprovalActorName, getApprovalComment, appendApprovalComment, logAction }));

function sanitizeVendorRegistryPayload(body = {}) {
  const vendorTinDigits = normalizeTin(body.tin);
  return {
    vendor_no: String(body.vendor_no || '').trim(),
    vendor_name: String(body.vendor_name || '').trim(),
    contact_person: String(body.contact_person || '').trim(),
    email: String(body.email || '').trim(),
    phone: normalizePhone(body.phone),
    address: String(body.address || '').trim(),
    tin: formatTin(vendorTinDigits),
    is_active: 1
  };
}

function validateVendorRegistryPayload(payload = {}) {
  if (!payload.vendor_name) {
    const err = new Error('Vendor name is required.');
    err.field = 'vendor_name';
    throw err;
  }
  if (!payload.contact_person) {
    const err = new Error('Contact person is required.');
    err.field = 'vendor_contact';
    throw err;
  }
  if (!payload.email) {
    const err = new Error('Email is required.');
    err.field = 'vendor_email';
    throw err;
  }
  if (!isValidEmail(payload.email)) {
    const err = new Error('Please enter a valid email address.');
    err.field = 'vendor_email';
    throw err;
  }
  if (!payload.phone) {
    const err = new Error('Vendor phone is required.');
    err.field = 'vendor_phone';
    throw err;
  }
  if (!isValidPhone(payload.phone)) {
    const err = new Error('Vendor phone number must be digits only, 7 to 15 digits.');
    err.field = 'vendor_phone';
    throw err;
  }
  const tinDigits = normalizeTin(payload.tin);
  if (!tinDigits) {
    const err = new Error('TIN is required.');
    err.field = 'vendor_tin';
    throw err;
  }
  if (tinDigits.length !== 12) {
    const err = new Error('TIN must follow 000-000-000-000 format.');
    err.field = 'vendor_tin';
    throw err;
  }
  if (!payload.address) {
    const err = new Error('Address is required.');
    err.field = 'vendor_address';
    throw err;
  }
}

function findVendorDuplicatePromise(phone, tin, email, excludeId = 0) {
  return new Promise((resolve, reject) => {
    findVendorDuplicate(phone, tin, email, excludeId, (err, duplicate) => {
      if (err) reject(err);
      else resolve(duplicate || null);
    });
  });
}

async function assertVendorRegistryPayloadUnique(payload = {}) {
  const duplicate = await findVendorDuplicatePromise(payload.phone, payload.tin, payload.email, 0);
  if (!duplicate) return;
  const err = new Error(duplicate.field === 'tin'
    ? 'TIN already exists in Vendor Directory.'
    : (duplicate.field === 'vendor_email'
      ? 'Email already exists in Vendor Directory.'
      : 'Vendor phone already exists in Vendor Directory.'));
  err.field = duplicate.field;
  throw err;
}

async function insertApprovedVendorRegistryFromRequest(payload = {}) {
  let lastErr = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const vendorNo = await generateNextVendorNoPromise();
    try {
      await queryAsync(`
        INSERT INTO vendors
          (company_id, vendor_no, vendor_name, contact_person, email, phone, address, tin, is_active)
        VALUES (NULL, ?, ?, ?, ?, ?, ?, ?, TRUE)
      `, [
        vendorNo,
        payload.vendor_name,
        payload.contact_person || null,
        payload.email || null,
        payload.phone || null,
        payload.address || null,
        payload.tin || null
      ]);
      return vendorNo;
    } catch (err) {
      if (!isPostgresUniqueViolation(err)) throw err;
      lastErr = err;
    }
  }
  throw lastErr || new Error('Unable to assign a vendor number.');
}

// Vendor registry requests (staff draft/approval workflow) — extracted to src/modules/master-data/vendors (step 10).
app.use(require('./src/modules/master-data/vendors/vendor-registry-requests.routes')({ generateDraftRequestNo, sanitizeVendorRegistryPayload, validateVendorRegistryPayload, assertVendorRegistryPayloadUnique, insertApprovedVendorRegistryFromRequest, stripDraftRequestNoPrefix, getApprovalActorName, getApprovalComment, appendApprovalComment, logAction }));

// Company Registry routes (master-data: CRUD + next-no + history/overview/vendor-profile) — extracted to src/modules/master-data/company-registry (step 6).
app.use(require('./src/modules/master-data/company-registry/company-registry.routes')({ findCompanyRegistryDuplicate, generateNextCompanyNo, findVendorDuplicate, generateNextVendorNo, logAction }));

// Business Entities routes — extracted to src/modules/business-entities (step 4 of modularization).
app.use(require('./src/modules/business-entities/business-entities.routes')({ generateCode, generateNextVendorNo, findVendorDuplicate, logoUpload, LOGO_UPLOAD_DIR, logAction }));


// company-registry detail routes (history/overview/vendor-profile) — moved to module (mount above).



async function syncReceivableBalance(receivableId) {
  const id = Number(receivableId || 0);
  if (!id) return;
  const rows = await queryAsync('SELECT id, total_amount, due_date, archived FROM accounts_receivable WHERE id = ? LIMIT 1', [id]);
  if (!rows.length) return;
  const paidRows = await queryAsync(
    "SELECT COALESCE(SUM(amount), 0) AS paid_amount FROM payments WHERE payment_type = 'ar' AND ar_id = ? AND COALESCE(approval_status, 'approved') = 'approved'",
    [id]
  );
  const paidAmount = Number(paidRows[0]?.paid_amount || 0);
  const status = calculateReceivableStatus(rows[0].total_amount, paidAmount, rows[0].due_date, rows[0].archived);
  await queryAsync(
    'UPDATE accounts_receivable SET paid_amount = ?, status = ? WHERE id = ?',
    [paidAmount, status, id]
  );
}

async function syncPayableBalance(payableId) {
  const id = Number(payableId || 0);
  if (!id) return;
  const rows = await queryAsync('SELECT id, total_amount FROM accounts_payable WHERE id = ? LIMIT 1', [id]);
  if (!rows.length) return;
  const paidRows = await queryAsync(
    "SELECT COALESCE(SUM(amount), 0) AS paid_amount FROM payments WHERE payment_type = 'ap' AND ap_id = ? AND COALESCE(approval_status, 'approved') = 'approved'",
    [id]
  );
  const paidAmount = Number(paidRows[0]?.paid_amount || 0);
  const status = calculatePayableStatus(rows[0].total_amount, paidAmount);
  await queryAsync(
    'UPDATE accounts_payable SET paid_amount = ?, status = ? WHERE id = ?',
    [paidAmount, status, id]
  );
}

async function assertPaymentWithinOpenBalance(payment, { excludePaymentId = 0 } = {}) {
  const paymentType = String(payment?.payment_type || '').trim().toLowerCase();
  const amount = Number(payment?.amount || 0);
  const excludedId = Number(excludePaymentId || 0) || 0;
  if (!paymentType || !(amount > 0)) return;

  const targetId = paymentType === 'ap'
    ? Number(payment?.ap_id || 0)
    : Number(payment?.ar_id || 0);
  if (!targetId) return;

  const tableName = paymentType === 'ap' ? 'accounts_payable' : 'accounts_receivable';
  const paymentColumn = paymentType === 'ap' ? 'ap_id' : 'ar_id';
  const label = paymentType === 'ap' ? 'AP bill' : 'AR invoice';
  const targetRows = await queryAsync(
    `SELECT id, total_amount FROM ${tableName} WHERE id = ? LIMIT 1`,
    [targetId]
  );
  if (!targetRows.length) {
    throw new Error(`Selected ${label} was not found.`);
  }

  const params = [targetId];
  let excludeClause = '';
  if (excludedId) {
    excludeClause = 'AND id <> ?';
    params.push(excludedId);
  }

  const committedRows = await queryAsync(
    `SELECT COALESCE(SUM(amount), 0) AS committed_amount
       FROM payments
      WHERE payment_type = ?
        AND ${paymentColumn} = ?
        AND COALESCE(approval_status, 'approved') IN ('approved', 'pending')
        ${excludeClause}`,
    [paymentType, ...params]
  );

  const totalAmount = Number(targetRows[0]?.total_amount || 0);
  const committedAmount = Number(committedRows[0]?.committed_amount || 0);
  const remainingAmount = Math.max(0, Number((totalAmount - committedAmount).toFixed(2)));

  if (amount - remainingAmount > 0.005) {
    throw new Error(`Payment amount exceeds the remaining ${label} balance of ${remainingAmount.toFixed(2)}.`);
  }
}

async function postApprovedBillJournal(billId, dbClient = null) {
  const id = Number(billId || 0) || 0;
  if (!id) return null;
  const rows = await queryDbAsync(
    dbClient,
    `SELECT id, bill_number, bill_date, total_amount, approval_status
       FROM accounts_payable
      WHERE id = ? LIMIT 1`,
    [id]
  );
  if (!rows.length) return null;
  const bill = rows[0];
  if (normalizeProcurementWorkflowStatus(bill.approval_status || 'pending') !== 'approved') {
    await deleteAutoJournalEntries('ap_bill', id, dbClient);
    return null;
  }
  return postAutoJournalEntry({
    referenceType: 'ap_bill',
    referenceId: id,
    entryDate: bill.bill_date || getManilaYmd(),
    memo: `AP bill ${bill.bill_number || id}`,
    debitAccount: AUTO_GL_ACCOUNTS.operatingExpenses,
    creditAccount: AUTO_GL_ACCOUNTS.accountsPayable,
    amount: Number(bill.total_amount || 0),
    dbClient
  });
}

async function postApprovedPaymentJournal(paymentId, dbClient = null) {
  const id = Number(paymentId || 0) || 0;
  if (!id) return null;
  const rows = await queryDbAsync(
    dbClient,
    `SELECT p.*, ap.bill_number, ar.invoice_number
       FROM payments p
       LEFT JOIN accounts_payable ap ON ap.id = p.ap_id
       LEFT JOIN accounts_receivable ar ON ar.id = p.ar_id
      WHERE p.id = ? LIMIT 1`,
    [id]
  );
  if (!rows.length) return null;

  const payment = rows[0];
  const paymentType = String(payment.payment_type || '').trim().toLowerCase();
  const referenceType = paymentType === 'ap' ? 'ap_payment' : 'ar_payment';
  if (!['ap', 'ar'].includes(paymentType) || normalizeProcurementWorkflowStatus(payment.approval_status || 'approved') !== 'approved') {
    await deleteAutoJournalEntries(referenceType, id, dbClient);
    return null;
  }

  return postAutoJournalEntry({
    referenceType,
    referenceId: id,
    entryDate: payment.payment_date || getManilaYmd(),
    memo: paymentType === 'ap'
      ? `AP payment ${payment.reference_number || id} for ${payment.bill_number || 'bill'}`
      : `AR collection ${payment.reference_number || id} for ${payment.invoice_number || 'invoice'}`,
    debitAccount: paymentType === 'ap' ? AUTO_GL_ACCOUNTS.accountsPayable : AUTO_GL_ACCOUNTS.cash,
    creditAccount: paymentType === 'ap' ? AUTO_GL_ACCOUNTS.cash : AUTO_GL_ACCOUNTS.accountsReceivable,
    amount: Number(payment.amount || 0),
    dbClient
  });
}

// Project-centric sales spine: SI -> SQ -> SO -> DR -> AR (SI/SQ optional).
// The legacy 'proposal-request' (Projects) and 'service-order' types were
// removed — real projects live in the Projects module and every sales record
// links to one via project_id. Existing rows of those types are soft-archived
// by migration (see soft-archive migration below).
const SALES_RECORD_TYPES = Object.freeze({
  'sales-request': { label: 'Sales Inquiry', prefix: 'SR' },
  'sales-order': { label: 'SO', prefix: 'SO' },
  'project-delivery': { label: 'Delivery Receipt', prefix: 'DR' }
});

function normalizeSalesRecordType(value) {
  const type = String(value || '').trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(SALES_RECORD_TYPES, type) ? type : '';
}

function normalizeSalesRecordStatus(value) {
  const status = String(value || '').trim().toLowerCase().replace(/\s+/g, '_');
  const allowed = new Set(['draft', 'submitted', 'in_review', 'sent', 'approved', 'won', 'delivered', 'completed', 'rejected', 'cancelled']);
  return allowed.has(status) ? status : 'draft';
}

function normalizeSalesRecordPayload(body = {}, fallbackType = '') {
  const recordType = normalizeSalesRecordType(body.record_type || fallbackType);
  if (!recordType) {
    const err = new Error('Invalid sales record type.');
    err.statusCode = 400;
    throw err;
  }

  const title = String(body.title || '').trim();
  if (!title) {
    const err = new Error('Title is required.');
    err.statusCode = 400;
    throw err;
  }

  return {
    recordType,
    businessEntityId: Number(body.business_entity_id || 0) || null,
    companyId: Number(body.company_id || 0) || null,
    projectId: Number(body.project_id || 0) || null,
    sourceRecordId: Number(body.source_record_id || 0) || null,
    productId: Number(body.product_id || 0) || null,
    warehouseId: Number(body.warehouse_id || 0) || null,
    quantity: Math.max(0, Number(body.quantity || 0) || 0),
    unitPrice: Math.max(0, Number(body.unit_price || 0) || 0),
    title,
    description: String(body.description || '').trim() || null,
    requestedDate: String(body.requested_date || '').trim() || null,
    targetDate: String(body.target_date || '').trim() || null,
    amount: Math.max(0, Number(body.amount || 0) || 0),
    status: normalizeSalesRecordStatus(body.status),
    contactPerson: String(body.contact_person || '').trim() || null,
    paymentTerms: String(body.payment_terms || '').trim() || null,
    notes: String(body.notes || '').trim() || null,
    quoteValidity: String(body.quote_validity || '').trim() || null,
    downpayment: Math.max(0, Number(body.downpayment || 0) || 0),
    customerPoRef: String(body.customer_po_ref || '').trim() || null,
    receivedBy: String(body.received_by || '').trim() || null,
    deliveryAddress: String(body.delivery_address || '').trim() || null,
    sourcePoId: Number(body.source_po_id || 0) || null
  };
}

// Sequential per-business-entity numbering for sales records (mirrors procurement,
// e.g. SR-KVSK-2026-001). Each record type keeps its own sequence via documentType.
function getSalesDocumentSequenceMeta(recordType) {
  const meta = SALES_RECORD_TYPES[recordType] || SALES_RECORD_TYPES['sales-request'];
  return {
    prefix: meta.prefix,
    documentType: `sales-${String(meta.prefix || 'SR').toLowerCase()}`
  };
}

// ── Project-centric sales auto-sync: SI -> SO -> DR -> AR ──────────────────
// Forward spine and the status on the current stage that auto-creates the
// next-stage draft. SI is optional, so a flow may start at any stage. The
// Sales Quotation (SQ) stage was retired, so SI now advances straight to SO.
const SALES_FLOW_NEXT = Object.freeze({
  'sales-request': 'sales-order',
  'sales-order': 'project-delivery'
});
const SALES_FLOW_ADVANCE_STATUS = Object.freeze({
  'sales-request': ['approved', 'won'],
  'sales-order': ['approved', 'won'],
  'project-delivery': ['delivered', 'completed']
});

// Loads a sales record joined with its company + project context.
async function loadSalesRecordWithContext(connection, recordId) {
  const rows = await queryDbAsync(connection, `
    SELECT smr.*, c.company_name, p.project_docno
    FROM sales_management_records smr
    LEFT JOIN company_registry c ON c.id = smr.company_id
    LEFT JOIN projects p ON p.id = smr.project_id
    WHERE smr.id = ? LIMIT 1
  `, [Number(recordId || 0) || 0]);
  return rows[0] || null;
}

// Creates an AR invoice from a delivered/completed Delivery Receipt row.
// Reused by the manual generate-invoice endpoint AND the auto-sync chain.
// Idempotent — returns the existing invoice if this DR already has one.
// Derive an AR due date from the invoice date + payment terms (e.g. "Net 30",
// "30 days", "COD"/"Due on receipt"). Falls back to Net 30 when no number is found
// so aging/overdue reporting always has a concrete due date to work with.
function deriveReceivableDueDate(invoiceYmd, paymentTerms) {
  const base = String(invoiceYmd || '').slice(0, 10);
  if (!base) return null;
  const terms = String(paymentTerms || '').trim().toLowerCase();
  let days = 30;
  if (/\b(cod|cash|due on receipt|on receipt|upon receipt)\b/.test(terms)) {
    days = 0;
  } else {
    const match = terms.match(/(\d+)/);
    if (match) days = Math.max(0, parseInt(match[1], 10) || 0);
  }
  const d = new Date(`${base}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

async function createReceivableFromDeliveryRecord(connection, record, req) {
  const recordId = Number(record.id || 0) || 0;
  if (!recordId) return null;
  const existing = await queryDbAsync(connection,
    `SELECT id, invoice_number FROM accounts_receivable WHERE sales_record_id = ? AND COALESCE(archived, FALSE) = FALSE LIMIT 1`,
    [recordId]);
  if (existing.length) {
    return { id: existing[0].id, invoice_number: existing[0].invoice_number, existing: true };
  }
  const totalAmount = Number(record.amount || 0);
  const customerName = String(record.company_name || '').trim();
  if (!(totalAmount > 0) || !customerName) return null;

  const businessEntityId = await resolveBusinessEntityId(record.business_entity_id || null);
  const invoiceNumber = generateCode('INV');
  const invoiceDate = String(record.target_date || record.requested_date || '').slice(0, 10) || getManilaYmd();
  const paymentTerms = String(record.payment_terms || 'Net 30').trim();
  const dueDate = deriveReceivableDueDate(invoiceDate, paymentTerms);
  const result = await queryDbAsync(connection, `
    INSERT INTO accounts_receivable
      (customer_name, invoice_number, invoice_date, due_date, payment_terms, total_amount, paid_amount,
       status, business_entity_id, notes, project_id, project_docno,
       sales_record_id, sales_document_no, archived, archived_at)
    VALUES (?, ?, ?, ?, ?, ?, 0, 'draft', ?, ?, ?, ?, ?, ?, FALSE, NULL)
  `, [
    customerName,
    invoiceNumber,
    invoiceDate,
    dueDate,
    paymentTerms,
    totalAmount,
    businessEntityId,
    String(record.notes || '').trim() || `Invoice for ${record.document_no || 'Delivery Receipt'}`,
    Number(record.project_id || 0) || null,
    String(record.project_docno || '').trim() || null,
    recordId,
    String(record.document_no || '').trim() || null
  ]);
  const arId = result.insertId;

  // Apply the agreed downpayment (captured at the SO stage; it is NOT copied onto the
  // DR row, so read it from the source Sales Order). We post a real approved payments
  // row AND set the AR balance/status in the SAME transaction so (a) the balance due is
  // correct immediately and (b) later collections add on top instead of wiping it
  // (paid_amount is otherwise recomputed from the payments ledger by syncReceivableBalance).
  let downpayment = Math.max(0, Number(record.downpayment || 0) || 0);
  if (!(downpayment > 0) && Number(record.source_record_id || 0)) {
    const soRows = await queryDbAsync(connection,
      'SELECT downpayment FROM sales_management_records WHERE id = ? LIMIT 1',
      [Number(record.source_record_id)]);
    downpayment = Math.max(0, Number(soRows[0]?.downpayment || 0) || 0);
  }
  downpayment = Math.min(downpayment, totalAmount);
  if (downpayment > 0) {
    await queryDbAsync(connection,
      'INSERT INTO payments (payment_type, ap_id, ar_id, payment_date, amount, payment_method, reference_number, approval_status, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      ['ar', null, arId, invoiceDate, downpayment, 'downpayment', String(record.document_no || '').trim() || null, 'approved', 'Downpayment carried from Sales Order']);
    const arStatus = calculateReceivableStatus(totalAmount, downpayment, dueDate, 0);
    await queryDbAsync(connection,
      'UPDATE accounts_receivable SET paid_amount = ?, status = ? WHERE id = ?',
      [downpayment, arStatus, arId]);
  }

  return { id: arId, invoice_number: invoiceNumber, created: true };
}

// Auto-advances the flow after a record is created/updated:
//   * keeps a still-draft downstream copy in sync with headline fields;
//   * when the current stage reaches its advance status, auto-creates the
//     next-stage record (idempotent via source_record_id);
//   * when a Delivery Receipt is delivered/completed, auto-creates the AR invoice.
// Staff-created downstream rows stay as DFT drafts for approval; admin-created
// downstream rows are official/approved immediately.
async function advanceSalesRecordFlow(connection, recordId, req) {
  const record = await loadSalesRecordWithContext(connection, recordId);
  if (!record) return;
  const type = normalizeSalesRecordType(record.record_type);
  if (!type) return;
  const status = normalizeSalesRecordStatus(record.status);
  const triggers = SALES_FLOW_ADVANCE_STATUS[type] || [];

  // Delivery Receipt delivered/completed -> AR invoice (terminal stage).
  if (type === 'project-delivery') {
    if (triggers.includes(status)) await createReceivableFromDeliveryRecord(connection, record, req);
    return;
  }

  const nextType = SALES_FLOW_NEXT[type];
  if (!nextType) return;

  // Already has a downstream record: keep it in sync only while it is still a draft.
  const downstream = await queryDbAsync(connection,
    `SELECT id, status FROM sales_management_records WHERE source_record_id = ? AND record_type = ? ORDER BY id ASC LIMIT 1`,
    [Number(record.id || 0), nextType]);
  if (downstream.length) {
    if (normalizeSalesRecordStatus(downstream[0].status) === 'draft') {
      await queryDbAsync(connection,
        `UPDATE sales_management_records SET title = ?, amount = ?, updated_at = NOW() WHERE id = ?`,
        [record.title, Math.max(0, Number(record.amount || 0) || 0), Number(downstream[0].id)]);
    }
    return;
  }

  // Only auto-create the next stage once the current one reaches advance status.
  if (!triggers.includes(status)) return;

  const businessEntityId = await resolveSalesRecordBusinessEntityId(record, connection);
  const seqMeta = getSalesDocumentSequenceMeta(nextType);
  const actor = getAuthenticatedUser(req) || {};
  const actorIsStaff = isStaffRole(actor.role);
  const documentNo = actorIsStaff
    ? await generateNextDraftEntityDocumentNo({
        businessEntityId,
        documentType: seqMeta.documentType,
        prefix: seqMeta.prefix,
        tableName: 'sales_management_records',
        columnName: 'document_no',
        dbClient: connection
      })
    : await generateNextEntityDocumentNo({
        businessEntityId,
        documentType: seqMeta.documentType,
        prefix: seqMeta.prefix,
        tableName: 'sales_management_records',
        columnName: 'document_no',
        dbClient: connection
      });
  const nextStatus = actorIsStaff ? 'draft' : 'approved';
  const insertRes = await queryDbAsync(connection, `
    INSERT INTO sales_management_records (
      record_type, document_no, business_entity_id, company_id, project_id, source_record_id,
      product_id, warehouse_id, quantity, unit_price,
      title, description, requested_date, target_date, amount, status, contact_person,
      payment_terms, notes, created_by
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    nextType,
    documentNo,
    businessEntityId,
    record.company_id,
    record.project_id,
    record.id,
    null,
    null,
    0,
    0,
    record.title || SALES_RECORD_TYPES[nextType].label,
    record.description || null,
    getManilaYmd(),
    null,
    Math.max(0, Number(record.amount || 0) || 0),
    nextStatus,
    record.contact_person || null,
    record.payment_terms || null,
    `Auto-created from ${SALES_RECORD_TYPES[type].label} ${record.document_no || ''}`.trim(),
    getAuthenticatedUser(req)?.id || null
  ]);

  // Carry the source record's multi-item lines forward to the new stage so the
  // SI -> SO -> DR chain keeps the same items without re-encoding them.
  const newId = Number(insertRes?.insertId || 0) || 0;
  if (newId) {
    const srcItems = await getSalesRecordItems(connection, Number(record.id || 0));
    if (srcItems.length) {
      await saveSalesRecordItems(connection, newId, srcItems.map((it) => ({
        product_id: it.product_id,
        warehouse_id: it.warehouse_id,
        item_name: it.description,
        quantity: it.quantity,
        unit_price: it.unit_price
      })));
    }
  }
}

function validateSalesRecordStageRequirements(payload = {}) {
  // Source link is OPTIONAL at every stage (SI/SQ may be skipped) but a
  // linked Project is required everywhere so nothing is left untracked.
  const requiredByType = {
    'sales-request': [
      ['companyId', 'Customer / Company is required for Sales Inquiry.'],
      ['projectId', 'Linked Project is required for Sales Inquiry.'],
      ['title', 'Title is required for Sales Inquiry.'],
      ['requestedDate', 'Inquiry date is required for Sales Inquiry.']
    ],
    'sales-order': [
      ['companyId', 'Customer / Company is required for SO.'],
      ['projectId', 'Linked Project is required for SO.'],
      ['title', 'Title is required for SO.'],
      ['requestedDate', 'SO date is required.']
    ],
    'project-delivery': [
      ['companyId', 'Customer / Company is required for Delivery Receipt.'],
      ['projectId', 'Linked Project is required for Delivery Receipt.'],
      ['title', 'Title is required for Delivery Receipt.'],
      ['targetDate', 'Delivery date is required for Delivery Receipt.']
    ]
  };
  const requirements = requiredByType[payload.recordType] || [];
  const missing = requirements.find(([key, , type]) => (
    type === 'number' ? !(Number(payload[key] || 0) > 0) : !String(payload[key] || '').trim()
  ));
  if (missing) {
    const err = new Error(missing[1]);
    err.statusCode = 400;
    throw err;
  }
}

function salesRecordShouldDeductInventory(row = {}) {
  const type = normalizeSalesRecordType(row.record_type || row.recordType);
  const status = normalizeSalesRecordStatus(row.status);
  const productId = Number(row.product_id || row.productId || 0) || 0;
  const warehouseId = Number(row.warehouse_id || row.warehouseId || 0) || 0;
  const quantity = Number(row.quantity || 0) || 0;
  return type === 'project-delivery'
    && ['delivered', 'completed'].includes(status)
    && productId
    && warehouseId
    && quantity > 0;
}

function salesRecordRequiresInventoryOut(row = {}) {
  const type = normalizeSalesRecordType(row.record_type || row.recordType);
  const status = normalizeSalesRecordStatus(row.status);
  return type === 'project-delivery' && ['delivered', 'completed'].includes(status);
}

function validateSalesDeliveryReceiptInventory(payload = {}, lineItems = null) {
  if (!salesRecordRequiresInventoryOut({
    recordType: payload.recordType,
    status: payload.status
  })) return;

  // Multi-line DR: validate against the line items (each needs product + qty) and
  // the single source warehouse; the legacy single-product checks below are skipped.
  const lines = Array.isArray(lineItems)
    ? lineItems.filter((it) => Number(it.product_id || 0) && Number(it.quantity || 0) > 0)
    : null;
  if (lines && lines.length) {
    if (!Number(payload.warehouseId || 0)) {
      const err = new Error('Source warehouse is required before a Delivery Receipt can post inventory out.');
      err.statusCode = 400;
      throw err;
    }
    return;
  }

  if (!Number(payload.productId || 0)) {
    const err = new Error('Inventory product is required before a Delivery Receipt can post inventory out.');
    err.statusCode = 400;
    throw err;
  }
  if (!Number(payload.warehouseId || 0)) {
    const err = new Error('Source warehouse is required before a Delivery Receipt can post inventory out.');
    err.statusCode = 400;
    throw err;
  }
  if (!(Number(payload.quantity || 0) > 0)) {
    const err = new Error('Quantity must be greater than zero before a Delivery Receipt can post inventory out.');
    err.statusCode = 400;
    throw err;
  }
}

async function resolveSalesRecordBusinessEntityId(record = {}, dbClient = null) {
  if (Number(record.business_entity_id || 0)) return Number(record.business_entity_id || 0);
  if (Number(record.project_id || 0)) {
    const rows = await queryDbAsync(dbClient, 'SELECT business_entity_id FROM projects WHERE id = ? LIMIT 1', [Number(record.project_id || 0)]);
    if (Number(rows[0]?.business_entity_id || 0)) return Number(rows[0].business_entity_id || 0);
  }
  return resolveBusinessEntityId(record.business_entity_id);
}

// Persists the multi-item lines of a sales record. An undefined `items` means the
// caller didn't send the field (leave lines untouched); an array replaces them.
async function saveSalesRecordItems(connection, recordId, items) {
  const id = Number(recordId || 0) || 0;
  if (!id || !Array.isArray(items)) return;
  await queryDbAsync(connection, 'DELETE FROM sales_record_items WHERE sales_record_id = ?', [id]);
  for (const raw of items) {
    const productId = Number(raw?.product_id || 0) || null;
    const quantity = Math.max(0, Number(raw?.quantity || 0) || 0);
    const unitPrice = Math.max(0, Number(raw?.unit_price ?? raw?.estimated_unit_price ?? 0) || 0);
    if (!productId || quantity <= 0) continue;
    await queryDbAsync(connection,
      `INSERT INTO sales_record_items (sales_record_id, product_id, warehouse_id, description, quantity, unit_price, line_total)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, productId, Number(raw?.warehouse_id || 0) || null, String(raw?.item_name || raw?.description || '').trim() || null, quantity, unitPrice, quantity * unitPrice]);
  }
}

// Returns the persisted line items for a record (empty array when none).
async function getSalesRecordItems(connection, recordId) {
  const id = Number(recordId || 0) || 0;
  if (!id) return [];
  return await queryDbAsync(connection,
    'SELECT * FROM sales_record_items WHERE sales_record_id = ? ORDER BY id ASC', [id]);
}

// Multi-line records deduct per line; only DR delivered/completed posts stock.
function salesRecordShouldDeductInventoryMulti(row = {}) {
  const type = normalizeSalesRecordType(row.record_type);
  const status = normalizeSalesRecordStatus(row.status);
  return type === 'project-delivery'
    && ['delivered', 'completed'].includes(status)
    && Number(row.warehouse_id || 0) > 0;
}

// Per-line inventory posting for multi-item records. Isolated from the legacy
// single-product path: reverses any prior per-line stock-out for this document,
// then re-posts fresh for the current lines. Runs inside the caller's transaction.
async function syncSalesRecordLineInventory(record, lineItems, req, dbClient) {
  const id = Number(record.id || 0) || 0;
  const docno = record.document_no;
  const businessEntityId = await resolveSalesRecordBusinessEntityId(record, dbClient);
  const warehouseId = Number(record.warehouse_id || 0) || 0;
  const shouldDeduct = salesRecordShouldDeductInventoryMulti(record);

  // 1) Reverse prior per-line stock-out (add stock back, drop the movement rows).
  const prior = await queryDbAsync(dbClient,
    `SELECT product_id, warehouse_id, quantity FROM stock_movements
     WHERE reference_type = 'sales_management_line' AND reference_no = ? AND movement_type = 'out'`, [docno]);
  for (const mv of prior) {
    await queryDbAsync(dbClient,
      'UPDATE stock SET quantity_on_hand = quantity_on_hand + ?, updated_at = NOW() WHERE product_id = ? AND warehouse_id = ?',
      [Number(mv.quantity || 0), mv.product_id, mv.warehouse_id]);
  }
  await queryDbAsync(dbClient,
    `DELETE FROM stock_movements WHERE reference_type = 'sales_management_line' AND reference_no = ?`, [docno]);

  // Clear any legacy single-product movement if this record used that path before.
  const legacyMovementId = Number(record.inventory_movement_id || 0) || 0;
  if (legacyMovementId) {
    const mvRows = await queryDbAsync(dbClient, 'SELECT * FROM stock_movements WHERE id = ? LIMIT 1', [legacyMovementId]);
    const mv = mvRows[0];
    if (mv && String(mv.movement_type) === 'out') {
      await postSalesInventoryMovement({
        businessEntityId: Number(mv.business_entity_id || businessEntityId), productId: Number(mv.product_id || 0),
        warehouseId: Number(mv.warehouse_id || 0), quantity: Number(mv.quantity || 0), docno,
        movementDate: getManilaYmd(), createdBy: getAuthenticatedUser(req)?.id || null,
        projectId: Number(record.project_id || 0) || null, reverse: true,
        referenceType: 'sales_management_reversal', notes: 'Reversed legacy stock-out (now multi-line)'
      }, dbClient);
    }
    await queryDbAsync(dbClient, 'UPDATE sales_management_records SET inventory_movement_id = NULL WHERE id = ?', [id]);
  }

  if (!shouldDeduct) {
    await queryDbAsync(dbClient, 'UPDATE sales_management_records SET inventory_posted_at = NULL WHERE id = ?', [id]);
    return;
  }

  // 2) Validate all lines have stock, then post each line's stock-out.
  for (const line of lineItems) {
    const pid = Number(line.product_id || 0) || 0;
    const qty = Number(line.quantity || 0) || 0;
    if (!pid || qty <= 0) continue;
    await assertInventorySaleCanPost({ businessEntityId, productId: pid, warehouseId, quantity: qty }, dbClient);
  }
  for (const line of lineItems) {
    const pid = Number(line.product_id || 0) || 0;
    const qty = Number(line.quantity || 0) || 0;
    if (!pid || qty <= 0) continue;
    await postSalesInventoryMovement({
      businessEntityId, productId: pid, warehouseId, quantity: qty, docno,
      movementDate: record.target_date || record.requested_date || getManilaYmd(),
      createdBy: getAuthenticatedUser(req)?.id || null, projectId: Number(record.project_id || 0) || null,
      referenceType: 'sales_management_line',
      notes: `Sales Management line stock-out for ${SALES_RECORD_TYPES[record.record_type]?.label || 'sales record'}`
    }, dbClient);
  }
  await queryDbAsync(dbClient,
    'UPDATE sales_management_records SET business_entity_id = ?, inventory_posted_at = NOW() WHERE id = ?',
    [businessEntityId, id]);
}

async function syncSalesRecordInventory(recordId, req, dbClient = null) {
  const id = Number(recordId || 0) || 0;
  if (!id) return;
  const rows = await queryDbAsync(dbClient, 'SELECT * FROM sales_management_records WHERE id = ? LIMIT 1', [id]);
  if (!rows.length) return;
  const record = rows[0];

  // Records with persisted line items use the per-line path; everything else
  // keeps the proven legacy single-product behavior below, untouched.
  const lineItems = await getSalesRecordItems(dbClient, id);
  if (lineItems.length) {
    return await syncSalesRecordLineInventory(record, lineItems, req, dbClient);
  }

  const existingMovementId = Number(record.inventory_movement_id || 0) || 0;
  const shouldDeduct = salesRecordShouldDeductInventory(record);

  if (existingMovementId) {
    const movementRows = await queryDbAsync(dbClient, 'SELECT * FROM stock_movements WHERE id = ? LIMIT 1', [existingMovementId]);
    const movement = movementRows[0] || null;
    const movementMatches = movement
      && shouldDeduct
      && Number(movement.product_id || 0) === Number(record.product_id || 0)
      && Number(movement.warehouse_id || 0) === Number(record.warehouse_id || 0)
      && Number(movement.quantity || 0) === Number(record.quantity || 0)
      && String(movement.movement_type || '') === 'out';

    if (movementMatches) return;

    if (movement) {
      await postSalesInventoryMovement({
        businessEntityId: Number(movement.business_entity_id || record.business_entity_id || 0),
        productId: Number(movement.product_id || 0),
        warehouseId: Number(movement.warehouse_id || 0),
        quantity: Number(movement.quantity || 0),
        docno: record.document_no,
        movementDate: getManilaYmd(),
        createdBy: getAuthenticatedUser(req)?.id || null,
        projectId: Number(record.project_id || 0) || null,
        reverse: true,
        referenceType: 'sales_management_reversal',
        notes: 'Reversed Sales Management inventory stock-out'
      }, dbClient);
    }
    await queryDbAsync(dbClient, 'UPDATE sales_management_records SET inventory_movement_id = NULL, inventory_posted_at = NULL WHERE id = ?', [id]);
  }

  if (!shouldDeduct) return;

  const businessEntityId = await resolveSalesRecordBusinessEntityId(record, dbClient);
  await assertInventorySaleCanPost({
    businessEntityId,
    productId: Number(record.product_id || 0),
    warehouseId: Number(record.warehouse_id || 0),
    quantity: Number(record.quantity || 0)
  }, dbClient);
  const result = await postSalesInventoryMovement({
    businessEntityId,
    productId: Number(record.product_id || 0),
    warehouseId: Number(record.warehouse_id || 0),
    quantity: Number(record.quantity || 0),
    docno: record.document_no,
    movementDate: record.target_date || record.requested_date || getManilaYmd(),
    createdBy: getAuthenticatedUser(req)?.id || null,
    projectId: Number(record.project_id || 0) || null,
    referenceType: 'sales_management',
    notes: `Sales Management stock-out for ${SALES_RECORD_TYPES[record.record_type]?.label || 'sales record'}`
  }, dbClient);
  await queryDbAsync(
    dbClient,
    'UPDATE sales_management_records SET business_entity_id = ?, inventory_movement_id = ?, inventory_posted_at = NOW() WHERE id = ?',
    [businessEntityId, Number(result?.movement?.id || 0) || null, id]
  );
}

// Links the serial units chosen on a Delivery Receipt and flips their status to
// 'sold' once the DR is delivered/completed. Reconciles on every save so edits
// (adding/removing serials, or reverting a DR to draft) stay consistent. A null
// serialUnitIds means the caller didn't send the field — links are left untouched.
async function syncDeliverySerialUnits(connection, recordId, serialUnitIds, req) {
  const id = Number(recordId || 0) || 0;
  if (!id) return;
  const selected = Array.isArray(serialUnitIds)
    ? [...new Set(serialUnitIds.map((v) => Number(v || 0) || 0).filter(Boolean))]
    : null;
  if (selected === null) return;

  const rows = await queryDbAsync(connection, 'SELECT * FROM sales_management_records WHERE id = ? LIMIT 1', [id]);
  const record = rows[0];
  if (!record || normalizeSalesRecordType(record.record_type) !== 'project-delivery') return;

  const projectId = Number(record.project_id || 0) || null;
  // Multi-line DRs allow serials from any line's product; single-product DRs use
  // the record's product. delivered uses whichever "should deduct" rule applies.
  const lineItems = await getSalesRecordItems(connection, id);
  const allowedProductIds = [...new Set(
    [Number(record.product_id || 0) || 0, ...lineItems.map((l) => Number(l.product_id || 0) || 0)].filter(Boolean)
  )];
  const delivered = lineItems.length
    ? salesRecordShouldDeductInventoryMulti(record)
    : salesRecordShouldDeductInventory(record);

  let customerName = null;
  if (Number(record.company_id || 0)) {
    const compRows = await queryDbAsync(connection, 'SELECT company_name FROM company_registry WHERE id = ? LIMIT 1', [Number(record.company_id)]);
    customerName = String(compRows[0]?.company_name || '').trim() || null;
  }

  // 1) Unlink units previously tied to this DR but no longer selected.
  const linked = await queryDbAsync(connection, 'SELECT id FROM product_units WHERE sales_record_id = ?', [id]);
  const toRevert = linked.map((r) => Number(r.id)).filter((uid) => !selected.includes(uid));
  for (const uid of toRevert) {
    await queryDbAsync(connection,
      `UPDATE product_units SET sales_record_id = NULL, customer_name = NULL,
         status = CASE WHEN status = 'sold' THEN 'in_stock' ELSE status END,
         updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`, [uid]);
  }

  // 2) Link the selected units (only products on this DR, and only if still in
  // stock or already this DR's), flipping to 'sold' only when the DR is delivered.
  if (!allowedProductIds.length) return;
  const productPlaceholders = allowedProductIds.map(() => '?').join(', ');
  const newStatus = delivered ? 'sold' : 'in_stock';
  const linkCustomer = delivered ? customerName : null;
  for (const uid of selected) {
    await queryDbAsync(connection,
      `UPDATE product_units SET sales_record_id = ?, customer_name = ?,
         project_id = COALESCE(?, project_id), status = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND product_id IN (${productPlaceholders}) AND (sales_record_id = ? OR status = 'in_stock')`,
      [id, linkCustomer, projectId, newStatus, uid, ...allowedProductIds, id]);
  }
}

// Sales Management routes (records CRUD + next-number + generate-invoice + approve/reject) — extracted to src/modules/sales (step 12).
app.use(require('./src/modules/sales/sales-management.routes')({ SALES_RECORD_TYPES, normalizeSalesRecordType, normalizeSalesRecordPayload, normalizeSalesRecordStatus, getSalesDocumentSequenceMeta, validateSalesRecordStageRequirements, validateSalesDeliveryReceiptInventory, resolveBusinessEntityId, peekNextDraftEntityDocumentNo, peekNextEntityDocumentNo, generateNextDraftEntityDocumentNo, generateNextEntityDocumentNo, claimEntityDocumentNo, isDraftDocumentNo, withDbTransaction, queryDbAsync, saveSalesRecordItems, syncSalesRecordInventory, syncDeliverySerialUnits, advanceSalesRecordFlow, createReceivableFromDeliveryRecord, getApprovalComment, getApprovalActorName, appendApprovalComment, logAction }));

// Receivables (Accounts Receivable) routes — extracted to src/modules/accounts-receivable (step 7).
app.use(require('./src/modules/accounts-receivable/receivables.routes')({ syncReceivableBalance }));


// ==================== ERP FOUNDATION API ====================

app.get('/api/erp/summary', protectAdmin, async (req, res) => {
  try {
    const actor = getAuthenticatedUser(req) || {};
    const hideDraftRecords = isAdminRole(actor.role);
    const requisitionWhere = hideDraftRecords ? "WHERE LOWER(COALESCE(status, 'draft')) <> 'draft'" : '';
    const purchaseOrderWhere = hideDraftRecords ? "WHERE LOWER(COALESCE(status, 'draft')) <> 'draft'" : '';
    const [
      accounts,
      journals,
      requisitions,
      purchaseOrders,
      bills,
      companies
    ] = await Promise.all([
      queryAsync('SELECT COUNT(*) AS total FROM chart_of_accounts'),
      queryAsync('SELECT COUNT(*) AS total FROM journal_entries'),
      queryAsync(`SELECT COUNT(*) AS total FROM purchase_requisitions ${requisitionWhere}`),
      queryAsync(`SELECT COUNT(*) AS total FROM purchase_orders ${purchaseOrderWhere}`),
      queryAsync('SELECT COUNT(*) AS total FROM accounts_payable'),
      queryAsync('SELECT COUNT(*) AS total FROM company_registry')
    ]);

    const balanceRows = await queryAsync(`
      SELECT
        COALESCE(SUM(debit), 0) AS total_debit,
        COALESCE(SUM(credit), 0) AS total_credit
      FROM journal_lines
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
      companies: Number(companies[0]?.total || 0)
    });
  } catch (err) {
    console.error('ERP summary error:', err);
    res.status(500).json({ error: err.message || 'Unable to load ERP summary.' });
  }
});


function isDuplicateError(err) {
  return String(err?.message || '').toLowerCase().includes('duplicate') || String(err?.code || '') === '23505';
}

// SKU prefix from a category: first 3 alphanumerics, uppercased (e.g. "CCTV Cameras" -> "CCT").
function categorySkuPrefix(category) {
  const letters = String(category || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return letters.slice(0, 3) || 'GEN';
}

// Next running SKU for a category within an operating company, e.g. CCT-00001, CCT-00002.
async function generateProductSku(businessEntityId, category) {
  const prefix = categorySkuPrefix(category);
  const rows = await queryAsync(
    `SELECT sku FROM products WHERE business_entity_id = ? AND sku LIKE ?`,
    [businessEntityId, `${prefix}-%`]
  );
  const re = new RegExp(`^${prefix}-(\\d+)$`);
  let max = 0;
  rows.forEach((row) => {
    const match = String(row.sku || '').trim().toUpperCase().match(re);
    if (match) max = Math.max(max, parseInt(match[1], 10));
  });
  return `${prefix}-${String(max + 1).padStart(5, '0')}`;
}

// Inserts a product, auto-assigning a per-category SKU when none is supplied and
// retrying on collisions so concurrent creates still get a unique sequence.
async function insertProductWithSku(businessEntityId, fields) {
  const providedSku = String(fields.sku || '').trim();
  let lastErr = null;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const sku = (providedSku && attempt === 0)
      ? providedSku
      : await generateProductSku(businessEntityId, fields.category);
    try {
      const rows = await queryAsync(
        `INSERT INTO products (business_entity_id, sku, product_name, category, unit, reorder_level, unit_cost, selling_price)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         RETURNING *`,
        [
          businessEntityId,
          sku,
          fields.product_name,
          fields.category || null,
          fields.unit,
          fields.reorder_level,
          fields.unit_cost,
          fields.selling_price
        ]
      );
      return rows[0];
    } catch (err) {
      lastErr = err;
      // Only retry SKU collisions when we are auto-generating; a user-supplied
      // duplicate should surface as an error instead of being silently changed.
      if (isDuplicateError(err) && !(providedSku && attempt === 0)) continue;
      throw err;
    }
  }
  throw lastErr || new Error('Unable to assign a unique SKU.');
}

// Next running warehouse code within an operating company: fixed WARE- prefix
// + 5-digit sequence, e.g. WARE-00001, WARE-00002.
async function generateWarehouseCode(businessEntityId) {
  const prefix = 'WARE';
  const rows = await queryAsync(
    `SELECT warehouse_code FROM warehouses WHERE business_entity_id = ? AND warehouse_code LIKE ?`,
    [businessEntityId, `${prefix}-%`]
  );
  const re = new RegExp(`^${prefix}-(\\d+)$`);
  let max = 0;
  rows.forEach((row) => {
    const match = String(row.warehouse_code || '').trim().toUpperCase().match(re);
    if (match) max = Math.max(max, parseInt(match[1], 10));
  });
  return `${prefix}-${String(max + 1).padStart(5, '0')}`;
}

// Inserts a warehouse, auto-assigning a per-name code when none is supplied and
// retrying on collisions so concurrent creates still get a unique sequence.
async function insertWarehouseWithCode(businessEntityId, fields) {
  const providedCode = String(fields.warehouse_code || '').trim();
  let lastErr = null;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = (providedCode && attempt === 0)
      ? providedCode
      : await generateWarehouseCode(businessEntityId);
    try {
      const rows = await queryAsync(
        `INSERT INTO warehouses (business_entity_id, warehouse_code, warehouse_name, location)
         VALUES (?, ?, ?, ?)
         RETURNING *`,
        [businessEntityId, code, fields.warehouse_name, fields.location || null]
      );
      return rows[0];
    } catch (err) {
      lastErr = err;
      // Only retry collisions when auto-generating; a user-supplied duplicate surfaces as an error.
      if (isDuplicateError(err) && !(providedCode && attempt === 0)) continue;
      throw err;
    }
  }
  throw lastErr || new Error('Unable to assign a unique warehouse code.');
}


// --- Serial unit (per-unit) tracking for warranty / RMA ---------------------
const PRODUCT_UNIT_STATUSES = ['in_stock', 'sold', 'installed', 'returned', 'rma', 'defective'];

function normalizeUnitStatus(value) {
  const v = String(value || '').trim().toLowerCase();
  return PRODUCT_UNIT_STATUSES.includes(v) ? v : 'in_stock';
}

function normalizeDateOrNull(value) {
  const v = String(value || '').trim();
  return v ? v.slice(0, 10) : null;
}


function normalizeInventoryRequestType(value = '') {
  const type = String(value || '').trim().toLowerCase();
  if (['product', 'warehouse', 'movement'].includes(type)) return type;
  return '';
}

async function applyInventoryRequestPayload(requestType, payload = {}, req = null) {
  const type = normalizeInventoryRequestType(requestType);
  const businessEntityId = await resolveBusinessEntityId(payload.business_entity_id);

  if (type === 'product') {
    const productName = String(payload.product_name || '').trim();
    if (!productName) throw new Error('Product name is required.');
    return await insertProductWithSku(businessEntityId, {
      sku: payload.sku,
      product_name: productName,
      category: String(payload.category || '').trim() || null,
      unit: String(payload.unit || 'pcs').trim() || 'pcs',
      reorder_level: Number(payload.reorder_level || 0) || 0,
      unit_cost: Number(payload.unit_cost || 0) || 0,
      selling_price: Number(payload.selling_price || payload.unit_price || 0) || 0
    });
  }

  if (type === 'warehouse') {
    const warehouseName = String(payload.warehouse_name || '').trim();
    if (!warehouseName) throw new Error('Warehouse name is required.');
    // Blank code → auto-generate from the name, same as the direct admin create.
    return await insertWarehouseWithCode(businessEntityId, {
      warehouse_code: payload.warehouse_code,
      warehouse_name: warehouseName,
      location: String(payload.location || '').trim() || null
    });
  }

  if (type === 'movement') {
    const productId = Number(payload.product_id || 0) || 0;
    const warehouseId = Number(payload.warehouse_id || 0) || 0;
    const projectId = Number(payload.project_id || 0) || null;
    const movementType = String(payload.movement_type || '').trim().toLowerCase();
    const quantity = Number(payload.quantity || 0) || 0;
    if (!productId) throw new Error('Product is required.');
    if (!warehouseId) throw new Error('Warehouse is required.');
    if (!['in', 'out', 'adjustment'].includes(movementType)) throw new Error('Movement type is required.');
    if (quantity <= 0) throw new Error('Quantity must be greater than zero.');

    const [productRows, warehouseRows] = await Promise.all([
      queryAsync('SELECT id FROM products WHERE id = ? AND business_entity_id = ? LIMIT 1', [productId, businessEntityId]),
      queryAsync('SELECT id FROM warehouses WHERE id = ? AND business_entity_id = ? LIMIT 1', [warehouseId, businessEntityId])
    ]);
    if (!productRows.length) throw new Error('Selected product was not found.');
    if (!warehouseRows.length) throw new Error('Selected warehouse was not found.');
    if (projectId) {
      await assertProjectAcceptsNewActivity(projectId);
      const projectRows = await queryAsync('SELECT id FROM projects WHERE id = ? AND business_entity_id = ? LIMIT 1', [projectId, businessEntityId]);
      if (!projectRows.length) throw new Error('Selected project was not found.');
    }

    const signedQty = movementType === 'out' ? -quantity : quantity;
    const stockRows = await queryAsync(
      `INSERT INTO stock (business_entity_id, product_id, warehouse_id, quantity_on_hand, updated_at)
       VALUES (?, ?, ?, ?, NOW())
       ON CONFLICT (product_id, warehouse_id)
       DO UPDATE SET quantity_on_hand = stock.quantity_on_hand + EXCLUDED.quantity_on_hand, updated_at = NOW()
       RETURNING *`,
      [businessEntityId, productId, warehouseId, signedQty]
    );
    if (Number(stockRows[0]?.quantity_on_hand || 0) < 0) {
      await queryAsync(
        `UPDATE stock
         SET quantity_on_hand = quantity_on_hand - ?, updated_at = NOW()
         WHERE product_id = ? AND warehouse_id = ?`,
        [signedQty, productId, warehouseId]
      );
      throw new Error('Stock cannot go below zero.');
    }

    const rows = await queryAsync(
      `INSERT INTO stock_movements (business_entity_id, product_id, warehouse_id, movement_type, quantity, reference_type, reference_no, project_id, notes, movement_date, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       RETURNING *`,
      [
        businessEntityId,
        productId,
        warehouseId,
        movementType,
        quantity,
        String(payload.reference_type || '').trim() || (projectId ? 'project_issue' : null),
        String(payload.reference_no || '').trim() || null,
        projectId,
        String(payload.notes || '').trim() || null,
        payload.movement_date || new Date().toISOString().slice(0, 10),
        req?.session?.user?.fullname || req?.session?.user?.username || null
      ]
    );
    return { movement: rows[0], stock: stockRows[0] };
  }

  throw new Error('Invalid inventory request type.');
}

// Inventory routes (products, warehouses, stock, movements, serial units, requests) — extracted to src/modules/inventory (step 13). Inventory-specific helpers stay in server.js (shared w/ procurement) and are injected.
app.use(require('./src/modules/inventory/inventory.routes')({ normalizeBusinessEntityId, getDefaultBusinessEntityId, resolveBusinessEntityId, assertProjectAcceptsNewActivity, generateInventoryDraftRequestNo, stripDraftRequestNoPrefix, getApprovalActorName, getApprovalComment, appendApprovalComment, logAction, isDuplicateError, insertProductWithSku, insertWarehouseWithCode, PRODUCT_UNIT_STATUSES, normalizeUnitStatus, normalizeDateOrNull, normalizeInventoryRequestType, applyInventoryRequestPayload }));

// Accounting GL routes removed (legacy — no UI). NOTE: the journal_entries/journal_lines/
// chart_of_accounts TABLES are intentionally KEPT — AP/AR auto-post journals into them.


function normalizePurchaseRequisitionLineItems(body = {}) {
  const rawItems = Array.isArray(body.items) ? body.items : [];
  const normalized = rawItems
    .map((item) => ({
      product_id: Number(item?.product_id || item?.productId || 0) || null,
      category: String(item?.category || item?.item_category || '').trim() || null,
      warehouse_id: Number(item?.warehouse_id || item?.warehouseId || 0) || null,
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
      product_id: Number(body.product_id || 0) || null,
      category: String(body.category || body.item_category || '').trim() || null,
      warehouse_id: Number(body.warehouse_id || 0) || null,
      item_name: fallbackName,
      description: fallbackDescription,
      quantity: fallbackQty,
      unit: fallbackUnit,
      estimated_unit_price: fallbackPrice
    }];
  }

  return [];
}


function normalizePurchaseOrderLineItems(body = {}) {
  const rawItems = Array.isArray(body.items) ? body.items : [];
  const normalized = rawItems
    .map((item) => ({
      product_id: Number(item?.product_id || item?.productId || 0) || null,
      description: String(item?.description || item?.item_description || item?.item_name || '').trim(),
      quantity: toNumber(item?.quantity ?? item?.qty, 0),
      unit_price: toNumber(item?.unit_price ?? item?.price, 0)
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
      product_id: Number(body.product_id || 0) || null,
      description: fallbackDescription,
      quantity: fallbackQty,
      unit_price: fallbackPrice
    }];
  }

  return [];
}

function buildPurchaseOrderItemSummary(items = []) {
  return (Array.isArray(items) ? items : [])
    .map((item) => String(item.description || '').trim())
    .filter(Boolean)
    .join(' | ');
}

async function validatePurchaseOrderLineProducts(lineItems = [], businessEntityId = null) {
  const productIds = [...new Set((Array.isArray(lineItems) ? lineItems : [])
    .map((item) => Number(item.product_id || 0) || 0)
    .filter(Boolean))];
  if (!productIds.length) return;

  const placeholders = productIds.map(() => '?').join(', ');
  const rows = await queryAsync(
    `SELECT id FROM products WHERE id IN (${placeholders}) AND business_entity_id = ?`,
    [...productIds, businessEntityId]
  );
  const found = new Set((Array.isArray(rows) ? rows : []).map((row) => Number(row.id || 0)));
  const missing = productIds.filter((id) => !found.has(id));
  if (missing.length) {
    throw new Error('Selected inventory product was not found for this operating company.');
  }
}

async function sanitizePurchaseOrderLineProducts(lineItems = [], businessEntityId = null) {
  const items = Array.isArray(lineItems) ? lineItems : [];
  const productIds = [...new Set(items
    .map((item) => Number(item.product_id || 0) || 0)
    .filter(Boolean))];
  if (!productIds.length) return items;

  const placeholders = productIds.map(() => '?').join(', ');
  const rows = await queryAsync(
    `SELECT id FROM products WHERE id IN (${placeholders}) AND business_entity_id = ?`,
    [...productIds, businessEntityId]
  );
  const valid = new Set((Array.isArray(rows) ? rows : []).map((row) => Number(row.id || 0)));
  return items.map((item) => ({
    ...item,
    product_id: valid.has(Number(item.product_id || 0) || 0) ? item.product_id : null
  }));
}

function normalizeGoodsReceiptProductMappings(body = {}) {
  const rows = Array.isArray(body.product_mappings) ? body.product_mappings : [];
  return rows.map((row) => ({
    po_line_item_id: Number(row?.po_line_item_id || row?.line_item_id || 0) || 0,
    product_id: Number(row?.product_id || 0) || null,
    create_product: row?.create_product !== false && !Number(row?.product_id || 0),
    product_name: String(row?.product_name || row?.name || '').trim(),
    category: String(row?.category || '').trim() || null,
    unit: String(row?.unit || 'pcs').trim() || 'pcs',
    unit_cost: Number(row?.unit_cost || row?.unit_price || 0) || 0
  })).filter((row) => row.po_line_item_id);
}

async function applyGoodsReceiptProductMappings({ poId, businessEntityId, mappings = [] } = {}) {
  const safePoId = Number(poId || 0) || 0;
  const safeBusinessEntityId = Number(businessEntityId || 0) || 0;
  if (!safePoId || !safeBusinessEntityId || !Array.isArray(mappings) || !mappings.length) return;

  const lineItems = await queryAsync(
    'SELECT id, product_id, description, unit_price FROM po_line_items WHERE po_id = ? ORDER BY id ASC',
    [safePoId]
  );
  const lineById = new Map((Array.isArray(lineItems) ? lineItems : []).map((line) => [Number(line.id || 0), line]));

  for (const mapping of mappings) {
    const lineId = Number(mapping.po_line_item_id || 0) || 0;
    const line = lineById.get(lineId);
    if (!line) throw new Error('Selected PO line item was not found.');
    if (Number(line.product_id || 0)) continue;

    let productId = Number(mapping.product_id || 0) || 0;
    if (productId) {
      const productRows = await queryAsync(
        'SELECT id FROM products WHERE id = ? AND business_entity_id = ? AND is_active = TRUE LIMIT 1',
        [productId, safeBusinessEntityId]
      );
      if (!productRows.length) throw new Error('Selected inventory product was not found for this operating company.');
    } else if (mapping.create_product) {
      const productName = String(mapping.product_name || line.description || '').trim();
      if (!productName) throw new Error('Product name is required before receiving goods.');
      const product = await insertProductWithSku(safeBusinessEntityId, {
        sku: mapping.sku || '',
        product_name: productName,
        category: mapping.category || 'Procurement',
        unit: mapping.unit || 'pcs',
        reorder_level: 0,
        unit_cost: Number(mapping.unit_cost || line.unit_price || 0) || 0,
        selling_price: 0
      });
      productId = Number(product?.id || 0) || 0;
    }

    if (!productId) throw new Error('Map all PO line items to inventory products before receiving.');
    await queryAsync('UPDATE po_line_items SET product_id = ? WHERE id = ? AND po_id = ?', [productId, lineId, safePoId]);
  }
}

async function postInventoryReceiptForPurchaseOrder({
  poId,
  receiptId,
  grnNumber,
  businessEntityId,
  warehouseId,
  receivedDate,
  receivedBy,
  notes,
  lineReceipts = null // optional Map(po_line_item_id -> qty to receive now); null = receive all remaining
} = {}) {
  const safePoId = Number(poId || 0) || 0;
  const safeReceiptId = Number(receiptId || 0) || 0;
  const safeWarehouseId = Number(warehouseId || 0) || 0;
  if (!safePoId || !safeReceiptId) throw new Error('Purchase order and receipt are required for inventory receiving.');
  if (!safeWarehouseId) throw new Error('Receiving warehouse is required before goods can update inventory.');

  const warehouseRows = await queryAsync(
    'SELECT id FROM warehouses WHERE id = ? AND business_entity_id = ? LIMIT 1',
    [safeWarehouseId, businessEntityId]
  );
  if (!warehouseRows.length) throw new Error('Selected receiving warehouse was not found for this operating company.');

  const lineItems = await queryAsync(
    `SELECT id, product_id, description, quantity, received_qty
     FROM po_line_items
     WHERE po_id = ?
     ORDER BY id ASC`,
    [safePoId]
  );
  if (!lineItems.length) throw new Error('Purchase order has no line items to receive.');

  const missingProduct = lineItems.find((item) => !Number(item.product_id || 0));
  if (missingProduct) {
    throw new Error(`Map all PO line items to inventory products before receiving. Missing product for: ${missingProduct.description || `Line ${missingProduct.id}`}`);
  }

  await validatePurchaseOrderLineProducts(lineItems, businessEntityId);

  for (const item of lineItems) {
    const productId = Number(item.product_id || 0);
    const orderedQty = Number(item.quantity || 0);
    const alreadyReceived = Number(item.received_qty || 0);
    const remaining = Math.max(0, orderedQty - alreadyReceived);
    // Partial receiving: take the requested qty (capped at remaining); fall back to the
    // full remaining when no per-line quantities were supplied (legacy "receive all").
    let receiveQty = remaining;
    if (lineReceipts) {
      const requested = Number(lineReceipts.get(Number(item.id)));
      receiveQty = Math.max(0, Math.min(Number.isFinite(requested) ? requested : 0, remaining));
    }
    if (receiveQty <= 0) continue;

    await queryAsync(
      `INSERT INTO goods_receipt_items (receipt_id, po_line_item_id, product_id, warehouse_id, received_qty, notes)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [safeReceiptId, item.id, productId, safeWarehouseId, receiveQty, notes || null]
    );

    await queryAsync(
      `INSERT INTO stock (business_entity_id, product_id, warehouse_id, quantity_on_hand, updated_at)
       VALUES (?, ?, ?, ?, NOW())
       ON CONFLICT (product_id, warehouse_id)
       DO UPDATE SET quantity_on_hand = stock.quantity_on_hand + EXCLUDED.quantity_on_hand, updated_at = NOW()`,
      [businessEntityId, productId, safeWarehouseId, receiveQty]
    );

    await queryAsync(
      `INSERT INTO stock_movements (business_entity_id, product_id, warehouse_id, movement_type, quantity, reference_type, reference_no, notes, movement_date, created_by)
       VALUES (?, ?, ?, 'in', ?, 'goods_receipt', ?, ?, ?, ?)`,
      [
        businessEntityId,
        productId,
        safeWarehouseId,
        receiveQty,
        grnNumber || null,
        notes || `Received from PO ${safePoId}`,
        receivedDate || new Date().toISOString().slice(0, 10),
        receivedBy || null
      ]
    );

    await queryAsync(
      'UPDATE po_line_items SET received_qty = COALESCE(received_qty, 0) + ? WHERE id = ?',
      [receiveQty, item.id]
    );
  }
}

// Registers serial units captured during goods receiving. Each serial becomes an
// in-stock product_unit linked to the source PO automatically, so warranty/RMA can
// trace back to the vendor without re-typing. Duplicates are skipped, not fatal.
async function createSerialUnitsFromReceipt({ poId, warehouseId, businessEntityId, serialGroups, receivedBy } = {}) {
  if (!Array.isArray(serialGroups) || !serialGroups.length) return 0;
  let created = 0;
  for (const group of serialGroups) {
    let productId = Number(group?.product_id || 0) || 0;
    // Free-text PO lines have no product at capture time; the GRN's inventory mapping (applied
    // earlier in this request) has since set the line's product_id, so resolve it from the line.
    if (!productId && Number(group?.po_line_item_id || 0)) {
      const lineRows = await queryAsync('SELECT product_id FROM po_line_items WHERE id = ? LIMIT 1', [Number(group.po_line_item_id)]);
      productId = Number(lineRows?.[0]?.product_id || 0) || 0;
    }
    if (!productId) continue;
    const raw = Array.isArray(group?.serials) ? group.serials : String(group?.serials || '').split(/[\r\n,]+/);
    const serials = [...new Set(raw.map((s) => String(s || '').trim()).filter(Boolean))];
    for (const serial of serials) {
      try {
        await queryAsync(
          `INSERT INTO product_units (business_entity_id, product_id, warehouse_id, serial_number, status, source_po_id, created_by)
           VALUES (?, ?, ?, ?, 'in_stock', ?, ?)`,
          [businessEntityId, productId, Number(warehouseId || 0) || null, serial, Number(poId || 0) || null, receivedBy || null]
        );
        created += 1;
      } catch (err) {
        if (isDuplicateError(err)) continue; // serial already registered — skip it
        throw err;
      }
    }
  }
  return created;
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

function procurementRequisitionIsLocked(status) {
  const normalizedStatus = normalizeProcurementWorkflowStatus(status || 'draft') || 'draft';
  return !['draft', 'needs_revision'].includes(normalizedStatus);
}

function resolveProcurementStatusForActor(req, requestedStatus, {
  defaultStatus = 'draft',
  staffAllowed = ['draft'],
  adminAllowed = ['draft'],
  label = 'record'
} = {}) {
  const requested = normalizeProcurementWorkflowStatus(requestedStatus || defaultStatus) || defaultStatus;
  const allowed = isAdminRole(getAuthenticatedUser(req)?.role) ? adminAllowed : staffAllowed;
  if (!allowed.includes(requested)) {
    const err = new Error(`Staff cannot set ${label} to ${requested}. Submit it for admin approval instead.`);
    err.statusCode = 403;
    throw err;
  }
  return requested;
}

function getApprovalActorName(req) {
  const actor = getAuthenticatedUser(req) || {};
  return String(actor.fullname || actor.username || 'Admin').trim() || 'Admin';
}

function getApprovalActorLabel(req) {
  const actor = getAuthenticatedUser(req) || {};
  const name = getApprovalActorName(req);
  const role = formatAccessRoleLabel(actor.role || 'user');
  return `${name} (${role})`;
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

// True only when every PO line has been fully received (received_qty >= ordered qty).
async function isPurchaseOrderFullyReceived(poId) {
  const id = Number(poId || 0) || 0;
  if (!id) return false;
  const rows = await queryAsync('SELECT quantity, COALESCE(received_qty, 0) AS received_qty FROM po_line_items WHERE po_id = ?', [id]);
  if (!Array.isArray(rows) || !rows.length) return false;
  return rows.every((r) => Number(r.received_qty || 0) >= Number(r.quantity || 0));
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

  const percentTotal = schedule.reduce((sum, item) => sum + Number(item.percent || 0), 0);
  if (schedule.length && Math.abs(percentTotal - 100) <= 0.05) {
    const beforeLastTotal = schedule.slice(0, -1).reduce((sum, item) => sum + Number(item.amount || 0), 0);
    schedule[schedule.length - 1].amount = Number((total - beforeLastTotal).toFixed(2));
  }

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
      `SELECT r.id, r.pr_number, r.business_entity_id, r.company_id, r.project_id, r.status
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
    `SELECT id, project_docno, project_name, business_entity_id, company_id, status,
            created_by, assigned_to, project_manager, members,
            project_members, project_members_2, project_members_3,
            COALESCE(is_archived, FALSE) AS is_archived
     FROM projects WHERE id = ? LIMIT 1`,
    [normalizedProjectId]
  );
  if (!Array.isArray(rows) || !rows.length) {
    throw new Error('Selected project was not found.');
  }

  const project = rows[0];
  if (project.is_archived === true || Number(project.is_archived || 0) === 1) {
    throw new Error('Selected project is archived. Restore the project before creating new activity.');
  }
  if (isProjectAwaitingApprovalStatus(project.status)) {
    throw new Error(getProjectAwaitingApprovalMessage('creating procurement records'));
  }
  const projectCompanyId = Number(project.company_id || 0) || 0;
  const normalizedCompanyId = Number(companyId || 0) || 0;
  if (projectCompanyId && normalizedCompanyId && projectCompanyId !== normalizedCompanyId) {
    throw new Error('Selected project must belong to the same company.');
  }

  return project;
}


async function resolvePurchaseOrderQuotationContext(quotationId = 0, requisitionId = 0, vendorId = 0) {
  const normalizedQuotationId = Number(quotationId || 0) || 0;
  if (!normalizedQuotationId) return null;

  const rows = await queryAsync(
    `SELECT id, quote_number, requisition_id, vendor_id, status
     FROM procurement_quotations
     WHERE id = ? LIMIT 1`,
    [normalizedQuotationId]
  );
  if (!Array.isArray(rows) || !rows.length) {
    throw new Error('Selected quotation was not found.');
  }

  const quote = rows[0];
  const quoteRequisitionId = Number(quote.requisition_id || 0) || 0;
  const quoteVendorId = Number(quote.vendor_id || 0) || 0;
  if (requisitionId && quoteRequisitionId && Number(requisitionId) !== quoteRequisitionId) {
    throw new Error('Selected quotation must match the selected requisition.');
  }
  if (vendorId && quoteVendorId && Number(vendorId) !== quoteVendorId) {
    throw new Error('Selected quotation must match the selected vendor.');
  }
  if (!isFinalAwardedQuotationStatus(quote.status)) {
    throw new Error('Select the winning quotation before converting it to a purchase order.');
  }

  return quote;
}





function normalizeQuotationStatus(status) {
  const safeStatus = String(status || 'draft').trim().toLowerCase();
  if (['selected', 'awarded', 'approved'].includes(safeStatus)) return 'selected';
  return ['draft', 'submitted', 'selected', 'rejected'].includes(safeStatus) ? safeStatus : 'draft';
}


// Email a Request for Quotation (with a PDF of the PR items) to one or more vendors.

// ===================== Public Vendor RFQ Portal (token, no login) =====================
function rfqLinkIsExpired(deadline) {
  if (!deadline) return false;
  const d = new Date(deadline);
  if (Number.isNaN(d.getTime())) return false;
  // Deadline is inclusive — valid through the end of that calendar day.
  const end = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
  return Date.now() > end.getTime();
}

function isFinalAwardedQuotationStatus(status) {
  return ['selected', 'awarded', 'approved'].includes(normalizeQuotationStatus(status));
}

async function loadRfqPortalContext(token) {
  const linkRows = await queryAsync('SELECT * FROM rfq_vendor_links WHERE token = ? LIMIT 1', [String(token || '').trim()]);
  if (!linkRows.length) return null;
  const link = linkRows[0];
  const [prRows, vendorRows, itemRows, quotationRows, selectedRows, poRows] = await Promise.all([
    queryAsync(`
      SELECT pr.id, pr.pr_number, pr.status, be.company_name AS business_entity_name
      FROM purchase_requisitions pr
      LEFT JOIN business_entities be ON be.id = pr.business_entity_id
      WHERE pr.id = ? LIMIT 1
    `, [link.requisition_id]),
    queryAsync('SELECT id, vendor_name FROM vendors WHERE id = ? LIMIT 1', [link.vendor_id]),
    queryAsync('SELECT id, item_name, description, quantity, unit FROM purchase_requisition_items WHERE pr_id = ? ORDER BY id ASC', [link.requisition_id]),
    queryAsync(
      'SELECT id, status, quote_number FROM procurement_quotations WHERE id = ? OR (requisition_id = ? AND vendor_id = ?) ORDER BY id DESC LIMIT 1',
      [Number(link.quotation_id || 0) || 0, link.requisition_id, link.vendor_id]
    ),
    queryAsync(
      "SELECT id, quote_number, status FROM procurement_quotations WHERE requisition_id = ? AND LOWER(COALESCE(status, '')) IN ('selected', 'awarded', 'approved') LIMIT 1",
      [link.requisition_id]
    ),
    queryAsync('SELECT id, po_number FROM purchase_orders WHERE requisition_id = ? LIMIT 1', [link.requisition_id])
  ]);
  const quotation = quotationRows[0] || null;
  const selectedQuotation = selectedRows[0] || null;
  const purchaseOrder = poRows[0] || null;
  const quoteStatus = normalizeQuotationStatus(quotation?.status || '');
  const selectedQuoteId = Number(selectedQuotation?.id || 0) || 0;
  const currentQuoteId = Number(quotation?.id || link.quotation_id || 0) || 0;
  const prStatus = String(prRows[0]?.status || '').trim().toLowerCase();
  const finalStatus = purchaseOrder
    ? 'ordered'
    : ['ordered', 'received'].includes(prStatus)
      ? 'ordered'
    : selectedQuoteId
      ? (selectedQuoteId === currentQuoteId ? 'awarded' : 'closed')
      : isFinalAwardedQuotationStatus(quoteStatus)
        ? 'awarded'
        : quoteStatus === 'rejected'
          ? 'rejected'
          : prStatus === 'cancelled'
            ? 'cancelled'
            : '';
  return {
    link,
    pr: prRows[0] || null,
    vendor: vendorRows[0] || null,
    items: Array.isArray(itemRows) ? itemRows : [],
    quotation,
    selectedQuotation,
    purchaseOrder,
    finalStatus
  };
}

app.get('/rfq/:token', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'rfq-portal.html'));
});

app.get('/api/public/rfq/:token', async (req, res) => {
  try {
    const ctx = await loadRfqPortalContext(req.params.token);
    if (!ctx || !ctx.pr) return res.status(404).json({ ok: false, error: 'This RFQ link is invalid.' });
    let submission = null;
    try { submission = ctx.link.submission ? JSON.parse(ctx.link.submission) : null; } catch (_) { submission = null; }
    res.json({
      ok: true,
      expired: rfqLinkIsExpired(ctx.link.deadline),
      locked: Boolean(ctx.finalStatus),
      final_status: ctx.finalStatus || '',
      pr_number: ctx.pr.pr_number || `PR-${ctx.pr.id}`,
      company_name: ctx.pr.business_entity_name || 'Kinaadman ERP',
      vendor_name: ctx.vendor ? ctx.vendor.vendor_name : '',
      deadline: ctx.link.deadline || null,
      submitted_at: ctx.link.submitted_at || null,
      items: ctx.items.map((it) => ({
        id: it.id,
        name: String(it.item_name || it.description || 'Item'),
        qty: Number(it.quantity || 0),
        unit: String(it.unit || 'pcs')
      })),
      submission
    });
  } catch (err) {
    console.error('RFQ portal load error:', err);
    res.status(500).json({ ok: false, error: 'Unable to load this RFQ.' });
  }
});

// Optional vendor PDF on the public RFQ submit: run the PDF multer but never hard-fail
// the request — surface any error gently as req.fileUploadError.
function publicQuotePdfUpload(req, res, next) {
  upload.single('quote_pdf')(req, res, (err) => {
    if (err) req.fileUploadError = err;
    next();
  });
}

app.post('/api/public/rfq/:token', publicQuotePdfUpload, async (req, res) => {
  const dropFile = () => { if (req.file && req.file.path) fs.unlink(req.file.path, () => {}); };
  if (req.fileUploadError) {
    dropFile();
    return res.status(400).json({ ok: false, error: 'Attachment must be a PDF file (max 10MB).' });
  }
  try {
    const ctx = await loadRfqPortalContext(req.params.token);
    if (!ctx || !ctx.pr) { dropFile(); return res.status(404).json({ ok: false, error: 'This RFQ link is invalid.' }); }
    if (ctx.finalStatus) {
      dropFile();
      return res.status(400).json({ ok: false, error: 'A final decision has already been made on this RFQ. This link is now read-only.' });
    }
    if (rfqLinkIsExpired(ctx.link.deadline)) {
      dropFile();
      return res.status(400).json({ ok: false, error: 'The deadline for this RFQ has passed. Please contact us directly.' });
    }
    if (String(ctx.pr.status || '').toLowerCase() === 'cancelled') {
      dropFile();
      return res.status(400).json({ ok: false, error: 'This request is no longer open for quotation.' });
    }

    let bodyLines = req.body.lines;
    if (typeof bodyLines === 'string') { try { bodyLines = JSON.parse(bodyLines); } catch (_) { bodyLines = []; } }
    if (!Array.isArray(bodyLines)) bodyLines = [];

    const priceById = new Map();
    bodyLines.forEach((line) => {
      const id = Number(line && line.id) || 0;
      if (id) priceById.set(id, Math.max(0, Number(line && line.unit_price) || 0));
    });

    let quotedTotal = 0;
    const summaryLines = [];
    const storedLines = [];
    ctx.items.forEach((it) => {
      const unitPrice = priceById.get(Number(it.id)) || 0;
      const qty = Number(it.quantity || 0);
      const lineTotal = qty * unitPrice;
      quotedTotal += lineTotal;
      const name = String(it.item_name || it.description || 'Item');
      summaryLines.push(`${name}: ${qty} x ${formatPdfMoney(unitPrice)} = ${formatPdfMoney(lineTotal)}`);
      storedLines.push({ item_id: it.id, name, qty, unit: String(it.unit || 'pcs'), unit_price: unitPrice });
    });

    if (quotedTotal <= 0) {
      dropFile();
      return res.status(400).json({ ok: false, error: 'Please enter a unit price for at least one item.' });
    }

    const deliveryDays = Math.max(0, Number(req.body.delivery_days || 0) || 0);
    const paymentTerms = String(req.body.payment_terms || '').trim().slice(0, 100) || null;
    const warrantyTerms = String(req.body.warranty_terms || '').trim().slice(0, 255) || null;
    const vendorRemarks = String(req.body.remarks || '').trim().slice(0, 1000) || null;
    const businessEntityId = await resolveBusinessEntityId(ctx.link.business_entity_id);
    const remarksSummary = [
      'Submitted via vendor portal.',
      summaryLines.join('; '),
      vendorRemarks ? `Vendor note: ${vendorRemarks}` : ''
    ].filter(Boolean).join(' | ').slice(0, 1500);

    // Find the quotation for this PR+vendor — linked, or created manually. A unique
    // constraint on (requisition_id, vendor_id) guarantees at most one exists, so we
    // must reuse it instead of inserting a duplicate.
    let quotationId = Number(ctx.link.quotation_id || 0) || 0;
    if (!quotationId) {
      const existingByPair = await queryAsync(
        'SELECT id FROM procurement_quotations WHERE requisition_id = ? AND vendor_id = ? LIMIT 1',
        [ctx.link.requisition_id, ctx.link.vendor_id]
      );
      if (existingByPair.length) quotationId = Number(existingByPair[0].id) || 0;
    }
    if (quotationId) {
      const qRows = await queryAsync('SELECT id, status FROM procurement_quotations WHERE id = ? LIMIT 1', [quotationId]);
      const st = qRows.length ? normalizeQuotationStatus(qRows[0].status) : '';
      const poRows = await queryAsync('SELECT id FROM purchase_orders WHERE requisition_id = ? LIMIT 1', [ctx.link.requisition_id]);
      if (!qRows.length) {
        quotationId = 0; // record vanished — fall through to insert
      } else if (isFinalAwardedQuotationStatus(st) || st === 'rejected' || poRows.length) {
        dropFile();
        return res.status(400).json({ ok: false, error: 'A final decision has already been made on this request. Please contact us directly.' });
      }
    }

    if (quotationId) {
      await queryAsync(
        `UPDATE procurement_quotations
         SET quoted_total = ?, delivery_days = ?, payment_terms = ?, warranty_terms = ?, status = 'submitted', remarks = ?, quote_date = CURRENT_DATE
         WHERE id = ?`,
        [quotedTotal, deliveryDays, paymentTerms, warrantyTerms, remarksSummary, quotationId]
      );
    } else {
      const quoteNumber = await generateNextDraftEntityDocumentNo({
        businessEntityId,
        documentType: 'procurement-quotation',
        prefix: 'RFQ',
        tableName: 'procurement_quotations',
        columnName: 'quote_number'
      });
      const insertRes = await queryAsync(
        'INSERT INTO procurement_quotations (quote_number, requisition_id, vendor_id, quote_date, quoted_total, delivery_days, payment_terms, warranty_terms, status, remarks) VALUES (?, ?, ?, CURRENT_DATE, ?, ?, ?, ?, ?, ?)',
        [quoteNumber, ctx.link.requisition_id, ctx.link.vendor_id, quotedTotal, deliveryDays, paymentTerms, warrantyTerms, 'submitted', remarksSummary]
      );
      quotationId = Number(insertRes.insertId || 0) || 0;
      await claimEntityDocumentNo({ businessEntityId, documentType: 'procurement-quotation', prefix: 'RFQ', documentNo: quoteNumber });
    }

    // Save the vendor's uploaded PDF (optional) onto the quotation.
    let vendorPdfFilename = null;
    if (req.file && req.file.filename && quotationId) {
      vendorPdfFilename = req.file.filename;
      await queryAsync('UPDATE procurement_quotations SET vendor_pdf = ? WHERE id = ?', [vendorPdfFilename, quotationId]);
    }

    const submissionJson = JSON.stringify({
      lines: storedLines,
      delivery_days: deliveryDays,
      payment_terms: paymentTerms,
      warranty_terms: warrantyTerms,
      remarks: vendorRemarks,
      quoted_total: quotedTotal,
      vendor_pdf: vendorPdfFilename
    });
    await queryAsync(
      'UPDATE rfq_vendor_links SET quotation_id = ?, submission = ?, submitted_at = NOW() WHERE id = ?',
      [quotationId || null, submissionJson, ctx.link.id]
    );

    const prNumber = ctx.pr.pr_number || `PR-${ctx.pr.id}`;
    const vendorName = ctx.vendor ? ctx.vendor.vendor_name : `Vendor ${ctx.link.vendor_id}`;

    // In-system notification (surfaces in the admin bell via the audit feed) + audit log.
    logAction(req, 'VENDOR_QUOTE_SUBMITTED', `PR: ${prNumber} | Vendor: ${vendorName} | Total: ${formatPdfMoney(quotedTotal)} | Submitted via vendor portal.`, 'procurement');

    // Email notification to KVSK admins — with the generated quotation PDF (and the
    // vendor's own uploaded PDF, if they attached one) so the email itself carries it.
    try {
      const recipients = await getApprovalNotificationRecipients();
      if (recipients.length && (hasEmailConfig || RESEND_API_KEY)) {
        const emailAttachments = [];
        try {
          const quotePdf = await buildQuotationPdfAttachment(quotationId);
          emailAttachments.push({ filename: quotePdf.filename, content: quotePdf.content, contentType: 'application/pdf' });
        } catch (pdfErr) { console.error('Quotation PDF for email error:', pdfErr); }
        if (vendorPdfFilename) {
          const vpath = path.join(UPLOAD_DIR, path.basename(vendorPdfFilename));
          if (fs.existsSync(vpath)) emailAttachments.push({ filename: `vendor-quote-${prNumber}.pdf`, path: vpath, contentType: 'application/pdf' });
        }
        await sendSystemEmail({
          from: `Kinaadman ERP <${SMTP_FROM}>`,
          to: recipients.join(','),
          subject: `Vendor quotation received — ${prNumber}`,
          attachments: emailAttachments,
          text: `${vendorName} submitted a quotation for ${prNumber}.\nTotal: ${formatPdfMoney(quotedTotal)}\nReview it in Procurement → RFQ / Quotations.`,
          html: `
            <div style="font-family:Arial,sans-serif;color:#1f2937;line-height:1.55;">
              <h2 style="margin:0 0 12px;">Vendor Quotation Received</h2>
              <p style="margin:0 0 8px;"><strong>${htmlEscape(vendorName)}</strong> submitted a quotation for <strong>${htmlEscape(prNumber)}</strong>.</p>
              <p style="margin:0 0 8px;">Total: <strong>${htmlEscape(formatPdfMoney(quotedTotal))}</strong></p>
              <p style="margin:16px 0 0;"><a href="${htmlEscape(buildAppUrl('/procurement?tab=quotations'))}" style="background:#b42318;color:#fff;text-decoration:none;padding:10px 14px;border-radius:6px;display:inline-block;">Review in ERP</a></p>
            </div>
          `
        });
      }
    } catch (notifyErr) {
      console.error('RFQ submit notify error:', notifyErr);
    }

    res.json({ ok: true, message: 'Quotation submitted. Thank you!' });
  } catch (err) {
    dropFile();
    console.error('RFQ portal submit error:', err);
    res.status(500).json({ ok: false, error: 'Unable to submit your quotation. Please try again or contact us.' });
  }
});

// Serve the vendor-uploaded quotation PDF (from the public portal) to admins.







// HR module removed (legacy — not in current UI). Tables dropped in the legacy-cleanup block.

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
    const rows = await queryAsync('SELECT id, approval_status FROM accounts_payable WHERE id = ? LIMIT 1', [apId]);
    if (!rows.length) throw new Error('Selected accounts payable bill was not found.');
    if (normalizeProcurementWorkflowStatus(rows[0].approval_status || 'approved') !== 'approved') {
      throw new Error('Approve this AP bill before recording a payment.');
    }
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

// Payments (AP/AR) routes — extracted to src/modules/accounts-payable (step 8).
app.use(require('./src/modules/accounts-payable/payments.routes')({ normalizePaymentPayload, assertPaymentWithinOpenBalance, syncPayableBalance, syncReceivableBalance, postApprovedPaymentJournal, deleteAutoJournalEntries, sendBackgroundNotification, notifyPaymentApprovalRequest, notifyFinanceApproval, getApprovalActorName, getApprovalActorLabel, getApprovalComment, appendApprovalComment, logAction }));

// AP bills (vendor invoices). Like procurement, this router was extracted to bills.routes.js but
// its app.use mount was missing, 404'ing every /api/bills/* route ("Unable to load bills").
app.use(require('./src/modules/accounts-payable/bills.routes')({
  upload, UPLOAD_DIR, resolveBusinessEntityId, isDraftDocumentNo, generateNextDraftEntityDocumentNo,
  generateNextEntityDocumentNo, peekNextDraftEntityDocumentNo, peekNextEntityDocumentNo,
  claimEntityDocumentNo, sendBackgroundNotification, notifyBillApprovalRequest, syncPayableBalance,
  postApprovedBillJournal, sendBillPdf, getApprovalActorName, getApprovalComment, appendApprovalComment,
  notifyFinanceApproval, getApprovalActorLabel, logAction
}));

app.get('/api/notifications', protectAdmin, async (req, res) => {
  runArchiveMaintenance((maintenanceErr) => {
    if (maintenanceErr) {
      console.error('Notifications maintenance warning:', maintenanceErr);
    }
  });

  try {
    const actor = getAuthenticatedUser(req) || {};
    const [
      projectRows,
      auditRows,
      requisitionRows,
      purchaseOrderRows,
      billRows,
      paymentRows,
      companyRequestRows,
      vendorRequestRows,
      inventoryRequestRows,
      receivableRows,
      payableDueRows,
      inventoryRows
    ] = await Promise.all([
      queryAsync(
        `SELECT id, project_docno, source_docno, project_name, project_manager, start_date, end_date, status, COALESCE(is_archived, FALSE) AS is_archived
         FROM projects
         ORDER BY end_date ASC, start_date ASC`
      ),
      queryAsync(
        `SELECT
           l.id,
           l.module,
           l.action,
           l.details,
           l.created_at,
           l.ip_address,
           COALESCE(u.fullname, u.username, 'System') AS actor_name,
           COALESCE(u.role, 'system') AS actor_role
         FROM system_logs l
         LEFT JOIN users u ON u.id = l.user_id
         ORDER BY l.created_at DESC, l.id DESC
         LIMIT 10`
      ),
      queryAsync(
        `SELECT id, pr_number, request_date, needed_by, requested_by, status
         FROM purchase_requisitions
         WHERE status IN ('submitted', 'pending')
         ORDER BY COALESCE(needed_by, request_date, created_at) ASC
         LIMIT 8`
      ).catch(() => []),
      queryAsync(
        `SELECT id, po_number, po_date, delivery_date, total_amount, status
         FROM purchase_orders
         WHERE status = 'pending'
         ORDER BY COALESCE(delivery_date, po_date, created_at) ASC
         LIMIT 8`
      ).catch(() => []),
      queryAsync(
        `SELECT id, bill_number, bill_date, due_date, total_amount, approval_status
         FROM accounts_payable
         WHERE COALESCE(approval_status, 'approved') = 'pending'
         ORDER BY COALESCE(due_date, bill_date, created_at) ASC
         LIMIT 8`
      ).catch(() => []),
      queryAsync(
        `SELECT id, payment_type, payment_date, amount, approval_status
         FROM payments
         WHERE COALESCE(approval_status, 'approved') = 'pending'
         ORDER BY payment_date ASC, id ASC
         LIMIT 8`
      ).catch(() => []),
      queryAsync(
        `SELECT id, request_no, payload, requested_by, requested_by_email, submitted_at, created_at, status
         FROM company_registry_requests
         WHERE status = 'submitted'
         ORDER BY COALESCE(submitted_at, created_at) ASC
         LIMIT 8`
      ).catch(() => []),
      queryAsync(
        `SELECT id, request_no, payload, requested_by, requested_by_email, submitted_at, created_at, status
         FROM vendor_registry_requests
         WHERE status = 'submitted'
         ORDER BY COALESCE(submitted_at, created_at) ASC
         LIMIT 8`
      ).catch(() => []),
      queryAsync(
        `SELECT id, request_no, request_type, payload, requested_by, requested_by_email, submitted_at, created_at, status
         FROM inventory_requests
         WHERE status = 'submitted'
         ORDER BY COALESCE(submitted_at, created_at) ASC
         LIMIT 8`
      ).catch(() => []),
      queryAsync(
        `SELECT id, invoice_number, customer_name, due_date, total_amount, paid_amount, status
         FROM accounts_receivable
         WHERE COALESCE(archived, FALSE) = FALSE
           AND status IN ('sent', 'partial', 'overdue')
           AND due_date IS NOT NULL
           AND due_date <= CURRENT_DATE + INTERVAL '7 days'
         ORDER BY due_date ASC, id ASC
         LIMIT 12`
      ).catch(() => []),
      queryAsync(
        `SELECT id, bill_number, due_date, total_amount, paid_amount, status, approval_status
         FROM accounts_payable
         WHERE COALESCE(approval_status, 'approved') = 'approved'
           AND status IN ('pending', 'partially_paid')
           AND due_date IS NOT NULL
           AND due_date <= CURRENT_DATE + INTERVAL '7 days'
         ORDER BY due_date ASC, id ASC
         LIMIT 12`
      ).catch(() => []),
      queryAsync(
        `SELECT s.id, p.product_name, p.sku, p.reorder_level, s.quantity_on_hand, w.warehouse_name
         FROM stock s
         JOIN products p ON p.id = s.product_id
         JOIN warehouses w ON w.id = s.warehouse_id
         WHERE p.is_active = TRUE
           AND p.reorder_level > 0
           AND s.quantity_on_hand <= p.reorder_level
         ORDER BY (s.quantity_on_hand - p.reorder_level) ASC, p.product_name ASC
         LIMIT 10`
      ).catch(() => [])
    ]);

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const soonMs = 7 * 24 * 60 * 60 * 1000;
    const dateLevel = (value) => {
      if (!value) return 'info';
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return 'info';
      date.setHours(0, 0, 0, 0);
      if (date < today) return 'danger';
      if (date.getTime() === today.getTime()) return 'warning';
      return 'info';
    };

    const projectItems = (projectRows || [])
      .filter((project) => Number(project.is_archived || 0) === 0)
      .filter((project) => !isAdminRole(actor.role) || String(project.status || '').trim().toLowerCase() !== 'draft')
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
            category: 'System',
            href: `/admin?panel=project-records&search=${encodeURIComponent(project.project_docno || project.source_docno || project.project_name || '')}`,
            project_id: project.id,
            title: project.project_name || 'Untitled Project',
            message: 'Project completed successfully.',
            meta: `Managed by ${project.project_manager || 'Unknown'}`,
            date: project.end_date || project.start_date || null,
            source_docno: project.project_docno || project.source_docno || ''
          };
        }

        if (!['cancelled', 'on_hold'].includes(status) && endDate && endDate < today) {
          return {
            id: `project-${project.id}-overdue`,
            level: 'danger',
            type: 'overdue',
            category: 'Due Dates',
            href: `/admin?panel=project-records&search=${encodeURIComponent(project.project_docno || project.source_docno || project.project_name || '')}`,
            project_id: project.id,
            title: project.project_name || 'Untitled Project',
            message: 'Project is overdue and still open.',
            meta: `Ended on ${formatNotificationDate(project.end_date)}`,
            date: project.end_date,
            source_docno: project.project_docno || project.source_docno || ''
          };
        }

        if (!['cancelled', 'on_hold'].includes(status) && endDate && (endDate - today) <= soonMs) {
          return {
            id: `project-${project.id}-deadline`,
            level: 'warning',
            type: 'deadline',
            category: 'Due Dates',
            href: `/admin?panel=project-records&search=${encodeURIComponent(project.project_docno || project.source_docno || project.project_name || '')}`,
            project_id: project.id,
            title: project.project_name || 'Untitled Project',
            message: 'Deadline is coming soon.',
            meta: `Due on ${formatNotificationDate(project.end_date)}`,
            date: project.end_date,
            source_docno: project.project_docno || project.source_docno || ''
          };
        }

        if (['planning', 'on_hold'].includes(status)) {
          return {
            id: `project-${project.id}-pending`,
            level: 'info',
            type: 'pending',
            category: 'System',
            href: `/admin?panel=project-records&search=${encodeURIComponent(project.project_docno || project.source_docno || project.project_name || '')}`,
            project_id: project.id,
            title: project.project_name || 'Untitled Project',
            message: 'Project is pending action or start confirmation.',
            meta: `Status: ${capitalizeProjectStatus(project.status)}`,
            date: project.start_date || project.end_date || null,
            source_docno: project.project_docno || project.source_docno || ''
          };
        }

        if (status === 'active' && startDate && (startDate - today) <= soonMs && startDate >= today) {
          return {
            id: `project-${project.id}-upcoming`,
            level: 'info',
            type: 'pending',
            category: 'System',
            href: `/admin?panel=project-records&search=${encodeURIComponent(project.project_docno || project.source_docno || project.project_name || '')}`,
            project_id: project.id,
            title: project.project_name || 'Untitled Project',
            message: 'Project is starting soon.',
            meta: `Starts on ${formatNotificationDate(project.start_date)}`,
            date: project.start_date,
            source_docno: project.project_docno || project.source_docno || ''
          };
        }

        return null;
      })
      .filter(Boolean)
      .slice(0, 12);

    const approvalItems = [
      ...(requisitionRows || []).map((row) => ({
        id: `approval-pr-${row.id}`,
        level: 'warning',
        type: 'approval',
        category: 'Approvals',
        href: '/procurement?tab=requisitions',
        title: row.pr_number || 'Purchase Requisition',
        message: 'Purchase requisition is waiting for approval.',
        meta: `Requested by ${row.requested_by || 'Unknown'}`,
        date: row.needed_by || row.request_date || null
      })),
      ...(purchaseOrderRows || []).map((row) => ({
        id: `approval-po-${row.id}`,
        level: 'warning',
        type: 'approval',
        category: 'Approvals',
        href: '/procurement?tab=purchase-orders',
        title: row.po_number || 'Purchase Order',
        message: 'Purchase order is waiting for approval.',
        meta: `Amount PHP ${Number(row.total_amount || 0).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`,
        date: row.delivery_date || row.po_date || null
      })),
      ...(billRows || []).map((row) => ({
        id: `approval-ap-bill-${row.id}`,
        level: 'warning',
        type: 'approval',
        category: 'Approvals',
        href: '/accounts-payable?tab=bills',
        title: row.bill_number || 'AP Bill',
        message: 'AP bill needs review and approval.',
        meta: `Amount PHP ${Number(row.total_amount || 0).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`,
        date: row.due_date || row.bill_date || null
      })),
      ...(paymentRows || []).map((row) => ({
        id: `approval-payment-${row.id}`,
        level: 'warning',
        type: 'approval',
        category: 'Approvals',
        href: '/accounts-payable?tab=payments',
        title: `${String(row.payment_type || '').toUpperCase()} Payment`,
        message: 'Payment is waiting for approval.',
        meta: `Amount PHP ${Number(row.amount || 0).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`,
        date: row.payment_date || null
      })),
      ...(companyRequestRows || []).map((row) => {
        let payload = {};
        try { payload = JSON.parse(row.payload || '{}'); } catch (_) {}
        return {
          id: `approval-company-${row.id}`,
          level: 'warning',
          type: 'approval',
          category: 'Approvals',
          href: '/master-data?tab=requests',
          title: row.request_no || payload.company_name || 'Company Registry Request',
          message: 'Company registry request is waiting for approval.',
          meta: `Requested by ${row.requested_by || row.requested_by_email || 'Staff'}`,
          date: row.submitted_at || row.created_at || null
        };
      }),
      ...(vendorRequestRows || []).map((row) => {
        let payload = {};
        try { payload = JSON.parse(row.payload || '{}'); } catch (_) {}
        return {
          id: `approval-vendor-${row.id}`,
          level: 'warning',
          type: 'approval',
          category: 'Approvals',
          href: '/master-data?tab=requests',
          title: row.request_no || payload.vendor_name || 'Vendor Registry Request',
          message: 'Vendor registry request is waiting for approval.',
          meta: `Requested by ${row.requested_by || row.requested_by_email || 'Staff'}`,
          date: row.submitted_at || row.created_at || null
        };
      }),
      ...(inventoryRequestRows || []).map((row) => ({
        id: `approval-inventory-${row.id}`,
        level: 'warning',
        type: 'approval',
        category: 'Approvals',
        href: '/inventory?tab=requests',
        title: row.request_no || 'Inventory Request',
        message: 'Inventory request is waiting for approval.',
        meta: `${row.request_type || 'inventory'} requested by ${row.requested_by || row.requested_by_email || 'Staff'}`,
        date: row.submitted_at || row.created_at || null
      }))
    ];

    const dueItems = [
      ...(receivableRows || []).map((row) => ({
        id: `due-ar-${row.id}`,
        level: dateLevel(row.due_date),
        type: 'due',
        category: 'Due Dates',
        href: '/accounts-receivable?tab=customer-balances',
        title: row.invoice_number || 'Customer Invoice',
        message: `${row.customer_name || 'Customer'} invoice is ${dateLevel(row.due_date) === 'danger' ? 'overdue' : 'due soon'}.`,
        meta: `Balance PHP ${Math.max(0, Number(row.total_amount || 0) - Number(row.paid_amount || 0)).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`,
        date: row.due_date || null
      })),
      ...(payableDueRows || []).map((row) => ({
        id: `due-ap-${row.id}`,
        level: dateLevel(row.due_date),
        type: 'due',
        category: 'Due Dates',
        href: '/accounts-payable?tab=bills',
        title: row.bill_number || 'Vendor Bill',
        message: `Vendor bill is ${dateLevel(row.due_date) === 'danger' ? 'overdue' : 'due soon'}.`,
        meta: `Balance PHP ${Math.max(0, Number(row.total_amount || 0) - Number(row.paid_amount || 0)).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`,
        date: row.due_date || null
      }))
    ];

    const inventoryItems = (inventoryRows || []).map((row) => ({
      id: `inventory-low-${row.id}`,
      level: 'danger',
      type: 'inventory',
      category: 'Inventory',
      href: '/inventory',
      title: row.product_name || row.sku || 'Low Stock Item',
      message: 'Stock is at or below reorder level.',
      meta: `${row.warehouse_name || 'Warehouse'} | On hand ${Number(row.quantity_on_hand || 0)} / Reorder ${Number(row.reorder_level || 0)}`,
      date: new Date().toISOString()
    }));

    const auditItems = (auditRows || []).map((row) => {
      const actorRole = formatAccessRoleLabel(row.actor_role);
      return {
        id: `audit-${row.id}`,
        level: ['DELETE', 'REJECT', 'CANCEL', 'ARCHIVE', 'BLOCKED'].some((word) => String(row.action || '').includes(word)) ? 'warning' : 'info',
        type: 'audit',
        category: 'System',
        href: '/admin?panel=system-logs',
        title: 'Audit Activity',
        message: `${row.actor_name || 'System'} (${actorRole}) - ${String(row.action || '').replace(/_/g, ' ')}`,
        meta: `${row.module || 'system'}${row.ip_address ? ` | IP ${row.ip_address}` : ''}`,
        date: row.created_at,
        action: row.action,
        actor_name: row.actor_name,
        actor_role: row.actor_role,
        details: row.details || ''
      };
    });

    let staffDecisionItems = [];
    if (isStaffRole(actor.role)) {
      const staffTerms = [actor.fullname, actor.username, actor.email]
        .map((value) => String(value || '').trim().toLowerCase())
        .filter((value) => value.length >= 3);
      const makeLikeParams = (fieldsPerTerm) => staffTerms.flatMap((term) => Array(fieldsPerTerm).fill(`%${term}%`));
      const staffWhere = staffTerms.length
        ? staffTerms.map(() => `(LOWER(COALESCE(requested_by, '')) LIKE ? OR LOWER(COALESCE(requested_by_email, '')) LIKE ? OR LOWER(COALESCE(submitted_by, '')) LIKE ?)`).join(' OR ')
        : '1=0';
      const requestWhere = staffTerms.length
        ? staffTerms.map(() => `(LOWER(COALESCE(requested_by, '')) LIKE ? OR LOWER(COALESCE(requested_by_email, '')) LIKE ?)`).join(' OR ')
        : '1=0';
      const projectWhere = staffTerms.length
        ? staffTerms.map(() => `(LOWER(COALESCE(project_manager, '')) LIKE ? OR LOWER(COALESCE(members, '')) LIKE ? OR LOWER(COALESCE(project_members, '')) LIKE ?)`).join(' OR ')
        : '1=0';
      const makeRequestLikeParams = () => staffTerms.flatMap((term) => [`%${term}%`, `%${term}%`]);

      const [staffPrRows, staffProjectRows, staffCompanyRows, staffVendorRows, staffInventoryRows] = await Promise.all([
        queryAsync(
          `SELECT id, pr_number, requested_by, requested_by_email, submitted_by, status, cancel_reason, approved_by, approved_at, cancelled_by, cancelled_at, submitted_at, created_at
           FROM purchase_requisitions
           WHERE (${staffWhere})
             AND (status = 'approved' OR status = 'needs_revision' OR (status = 'draft' AND cancel_reason IS NOT NULL) OR status = 'cancelled')
           ORDER BY COALESCE(approved_at, cancelled_at, submitted_at, created_at) DESC
           LIMIT 12`,
          makeLikeParams(3)
        ).catch(() => []),
        queryAsync(
          `SELECT id, project_docno, draft_docno, project_name, project_manager, status, status_reason, approved_by, approved_at, created_at
           FROM projects
           WHERE (${projectWhere})
             AND (status = 'planning' OR status = 'needs_revision' OR (status = 'draft' AND status_reason IS NOT NULL))
           ORDER BY COALESCE(approved_at, created_at) DESC
           LIMIT 12`,
          makeLikeParams(3)
        ).catch(() => []),
        queryAsync(
          `SELECT id, request_no, payload, status, reject_reason, approval_comment, approved_by, approved_at, submitted_at, created_at
           FROM company_registry_requests
           WHERE (${requestWhere})
             AND status IN ('approved', 'rejected')
           ORDER BY COALESCE(approved_at, submitted_at, created_at) DESC
           LIMIT 12`,
          makeRequestLikeParams()
        ).catch(() => []),
        queryAsync(
          `SELECT id, request_no, payload, status, reject_reason, approval_comment, approved_by, approved_at, submitted_at, created_at
           FROM vendor_registry_requests
           WHERE (${requestWhere})
             AND status IN ('approved', 'rejected')
           ORDER BY COALESCE(approved_at, submitted_at, created_at) DESC
           LIMIT 12`,
          makeRequestLikeParams()
        ).catch(() => []),
        queryAsync(
          `SELECT id, request_no, request_type, status, reject_reason, approval_comment, approved_by, approved_at, submitted_at, created_at
           FROM inventory_requests
           WHERE (${requestWhere})
             AND status IN ('approved', 'rejected')
           ORDER BY COALESCE(approved_at, submitted_at, created_at) DESC
           LIMIT 12`,
          makeRequestLikeParams()
        ).catch(() => [])
      ]);

      staffDecisionItems = [
        ...(staffPrRows || []).map((row) => {
          const status = String(row.status || '').toLowerCase();
          const rejected = status === 'needs_revision' || (status === 'draft' && row.cancel_reason);
          return {
            id: `staff-pr-${row.id}-${rejected ? 'revision' : status}`,
            level: rejected || status === 'cancelled' ? 'warning' : 'success',
            type: 'staff-pr',
            category: 'My Work',
            href: '/procurement?tab=requisitions',
            title: row.pr_number || 'Purchase Request',
            message: rejected ? 'PR needs revision from admin.' : status === 'cancelled' ? 'PR was rejected/cancelled.' : 'PR approved by admin.',
            meta: rejected ? (row.cancel_reason || 'Please review admin note.') : `Reviewed by ${row.approved_by || row.cancelled_by || 'Admin'}`,
            date: row.approved_at || row.cancelled_at || row.submitted_at || row.created_at || null
          };
        }),
        ...(staffProjectRows || []).map((row) => {
          const status = String(row.status || '').toLowerCase();
          const needsRevision = status === 'needs_revision' || (status === 'draft' && row.status_reason);
          return {
            id: `staff-project-${row.id}-${needsRevision ? 'revision' : 'approved'}`,
            level: needsRevision ? 'warning' : 'success',
            type: 'staff-project',
            category: 'My Work',
            href: `/staff?panel=project-records&tab=projects&search=${encodeURIComponent(row.project_docno || row.draft_docno || row.project_name || '')}`,
            title: row.project_docno || row.draft_docno || row.project_name || 'Project',
            message: needsRevision ? 'Project needs revision from admin.' : 'Project approved by admin.',
            meta: needsRevision ? (row.status_reason || 'Please review admin note.') : `Reviewed by ${row.approved_by || 'Admin'}`,
            date: row.approved_at || row.created_at || null
          };
        }),
        ...(staffCompanyRows || []).map((row) => ({
          id: `staff-company-${row.id}-${row.status}`,
          level: String(row.status || '').toLowerCase() === 'rejected' ? 'warning' : 'success',
          type: 'staff-company',
          category: 'My Work',
          href: '/master-data?tab=requests',
          title: row.request_no || 'Company Registry Request',
          message: String(row.status || '').toLowerCase() === 'rejected'
            ? 'Company request needs revision from admin.'
            : 'Company request approved by admin.',
          meta: row.approval_comment || row.reject_reason || `Reviewed by ${row.approved_by || 'Admin'}`,
          date: row.approved_at || row.submitted_at || row.created_at || null
        })),
        ...(staffVendorRows || []).map((row) => ({
          id: `staff-vendor-${row.id}-${row.status}`,
          level: String(row.status || '').toLowerCase() === 'rejected' ? 'warning' : 'success',
          type: 'staff-vendor',
          category: 'My Work',
          href: '/master-data?tab=requests',
          title: row.request_no || 'Vendor Registry Request',
          message: String(row.status || '').toLowerCase() === 'rejected'
            ? 'Vendor request needs revision from admin.'
            : 'Vendor request approved by admin.',
          meta: row.approval_comment || row.reject_reason || `Reviewed by ${row.approved_by || 'Admin'}`,
          date: row.approved_at || row.submitted_at || row.created_at || null
        })),
        ...(staffInventoryRows || []).map((row) => ({
          id: `staff-inventory-${row.id}-${row.status}`,
          level: String(row.status || '').toLowerCase() === 'rejected' ? 'warning' : 'success',
          type: 'staff-inventory',
          category: 'My Work',
          href: '/inventory?tab=requests',
          title: row.request_no || 'Inventory Request',
          message: String(row.status || '').toLowerCase() === 'rejected'
            ? 'Inventory request needs revision from admin.'
            : 'Inventory request approved by admin.',
          meta: row.approval_comment || row.reject_reason || `${row.request_type || 'inventory'} reviewed by ${row.approved_by || 'Admin'}`,
          date: row.approved_at || row.submitted_at || row.created_at || null
        }))
      ];
    }

    const items = [
      ...(isStaffRole(actor.role) ? staffDecisionItems : approvalItems),
      ...dueItems,
      ...inventoryItems,
      ...projectItems,
      ...(isStaffRole(actor.role) ? [] : auditItems)
    ]
      .sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0))
      .slice(0, 80);

    res.json({
      count: items.length,
      items
    });
  } catch (err) {
    console.error('Notifications error:', err);
    res.status(500).json({ error: err.message || 'Unable to load notifications.' });
  }
});


function getMissingProjectRequiredFields(input = {}) {
  const requiredFields = [
    ['project_name', 'Project name'],
    ['company_id', 'Company'],
    ['description', 'Description'],
    ['service_type', 'Service type'],
    ['start_date', 'Planned start date'],
    ['end_date', 'Planned end date'],
    ['budget', 'Contract amount']
  ];

  return requiredFields
    .filter(([key]) => {
      if (key === 'company_id') return !Number(input[key] || 0);
      if (key === 'budget') {
        const raw = String(input[key] ?? '').trim();
        if (raw === '' || Number.isNaN(Number(raw))) return true;
        return Number(raw) <= 0;
      }
      return !String(input[key] || '').trim();
    })
    .map(([, label]) => label);
}




// Projects routes (built up chunk by chunk) — extracted to src/modules/projects (step 26+).
app.use(require('./src/modules/projects/projects.routes')({ projectRowMatchesStaffActor, sendStaffRecordAccessDenied, sendProjectPdf, generateNextProjectDocnoAsync, getProjectInvoiceNumber, getProjectBillNumber, getApprovalActorName, getApprovalActorLabel, getApprovalComment, appendApprovalComment, notifyProjectRequester, notifyProjectApprovalRequest, sendBackgroundNotification, assertProjectAcceptsNewActivity, isProjectAwaitingApprovalStatus, getProjectAwaitingApprovalMessage, peekNextProjectDocnoAsync, peekNextDraftProjectDocnoAsync, runArchiveMaintenance, normalizeBusinessEntityId, upload, UPLOAD_DIR, toNumber, resolveBusinessEntityId, resolveProjectAssignedStaffId, deleteUploadedPdfIfPresent, computeProjectPriority, getMissingProjectRequiredFields, resolveCompanyRegistryReference, findProjectDuplicateByIdentity, sendProjectDuplicateResponse, ensureCompanyRegistryForProject, ensureDefaultProjectTasks, generateNextDraftProjectDocnoAsync, normalizeProjectStatusForSave, generateNextProjectDocno, logAction }));


// ==================== PROCUREMENT (PR -> RFQ -> PO -> GRN) ====================
// Mounts the extracted procurement router. This app.use was missing after the procurement
// routes were moved out of server.js into procurement.routes.js, which 404'd EVERY
// /api/procurement/* endpoint (PR next-number preview, requisitions, RFQ, PO, GRN). All deps
// below are existing server.js scope helpers (verified present).
app.use(require('./src/modules/procurement/procurement.routes')({
  resolveBusinessEntityId, peekNextDraftEntityDocumentNo, peekNextEntityDocumentNo,
  requisitionRowMatchesStaffActor, sendStaffRecordAccessDenied, assertStatusTransition,
  getAuthenticatedUserEmail, isDraftDocumentNo, generateNextEntityDocumentNo,
  generatePurchaseRequisitionPdfFile, sendBackgroundNotification, notifyApprovalRequest,
  notifyPurchaseRequisitionRequester, getApprovalActorName, getApprovalActorLabel,
  getApprovalComment, appendApprovalComment, buildPurchaseOrderPdfAttachment,
  notifyPurchaseOrderRequester, notifyPurchaseOrderVendor, publicQuotePdfUpload, UPLOAD_DIR,
  getManilaYmd, toNumber, normalizeProcurementWorkflowStatus, normalizeQuotationStatus,
  generateNextDraftEntityDocumentNo, claimEntityDocumentNo, notifyRfqAwardedRequester,
  notifyRfqAwardedVendor, isFinalAwardedQuotationStatus, buildQuotationPdfAttachment,
  formatPdfStatusLabel, normalizeGoodsReceiptProductMappings, applyGoodsReceiptProductMappings,
  postInventoryReceiptForPurchaseOrder, isPurchaseOrderFullyReceived, markPurchaseOrderReceived,
  createSerialUnitsFromReceipt, buildPurchaseOrderItemSummary, normalizePurchaseRequisitionLineItems,
  resolvePurchaseOrderProjectContext, resolvePurchaseRequisitionContext, procurementRequisitionIsLocked,
  projectRowMatchesStaffActor, normalizePurchaseOrderLineItems, resolvePurchaseOrderRequisitionContext,
  resolvePurchaseOrderQuotationContext, sanitizePurchaseOrderLineProducts, markRequisitionOrdered,
  withDbTransaction, connectionQueryAsync, parsePurchaseOrderPaymentTerms, resolveTermDueDate,
  hasEmailConfig, RESEND_API_KEY, APP_BASE_URL, SMTP_FROM, ensureRfqVendorLink,
  buildRfqRequestPdfAttachment, sendSystemEmail, htmlEscape, shouldRegenerateErpPdfFile, logAction
}));


// ==================== CRM (Customer Relationship Management) ====================
// Leads/pipeline + contacts. Self-contained module (creates its own tables on mount).
app.use(require('./src/modules/crm/crm.routes')({ resolveBusinessEntityId, normalizeBusinessEntityId, getDefaultBusinessEntityId, generateNextProjectDocnoAsync, getBusinessEntitySequenceCode, logAction }));

// ==================== GLOBAL SEARCH (dashboard) ====================
// /api/search?q= — finds PR/PO/GRN/Quote/Bill/Invoice/Project/Company/Vendor/Sales by number/name.
app.use(require('./src/modules/search/search.routes')());


// ==================== USER MANAGEMENT (ADMIN ONLY) ====================
app.get('/api/admin/users', protectAdminOnly, (req, res) => {
  db.query(`
    SELECT
      u.id,
      u.username,
      u.fullname,
      u.email,
      u.role,
      u.active,
      COALESCE(NULLIF(u.approval_status, ''), 'approved') AS approval_status,
      u.approved_at,
      u.approved_by,
      approver.username AS approved_by_username,
      approver.fullname AS approved_by_fullname,
      u.last_login,
      u.created_at
    FROM users u
    LEFT JOIN users approver ON approver.id = u.approved_by
    ORDER BY
      CASE COALESCE(NULLIF(u.approval_status, ''), 'approved') WHEN 'pending' THEN 0 ELSE 1 END,
      u.created_at DESC,
      u.id DESC
  `, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

app.post('/api/admin/users', protectAdminOnly, async (req, res) => {
  return res.status(403).json({ error: 'Use the registration flow for new accounts. Admins cannot create user passwords.' });
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
      'INSERT INTO users (fullname, username, email, password, role, active, approval_status, approved_by, approved_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())',
      [name, normalizedUsername, normalizedEmail, hashedPassword, role || 'staff', isActive, 'approved', req.session.user.id],
      (err) => {
        if (err) {
          if (isPostgresUniqueViolation(err)) {
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

  const userId = Number(req.params.id || 0);
  const { name, username, email, role, active, adminPassword } = req.body;
  const normalizedUsername = String(username || '').trim();
  const normalizedEmail = String(email || '').trim().toLowerCase();
  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const rawRole = String(role || '').trim().toLowerCase();
  const safeRole = ['super_admin', 'admin', 'staff'].includes(rawRole) ? rawRole : null;
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
    const existing = await queryAsync('SELECT id, username, role, active, approval_status FROM users WHERE id = ?', [userId]);
    if (!existing.length) {
      return res.status(404).json({ error: 'User not found.' });
    }

    const target = existing[0];
    const isSelf = Number(req.session.user.id || 0) === userId;
    const updateRole = isSelf ? target.role : (safeRole || target.role);
    const updateActive = isSelf ? Number(target.active || 1) : (Number.isNaN(nextActive) ? Number(target.active || 1) : (nextActive ? 1 : 0));
    const previousRole = normalizeAccessRole(target.role);
    const previousApprovalStatus = String(target.approval_status || 'approved');
    const nextApprovalStatus = updateActive === 1 ? 'approved' : previousApprovalStatus;
    const actorIsSuperAdmin = canManageSuperAdmin(req);
    const isPrivilegeChange = !isSelf && isPrivilegedRole(updateRole) && updateRole !== previousRole;
    const isApprovingAsPrivileged = !isSelf && previousApprovalStatus === 'pending' && updateActive === 1 && isPrivilegedRole(updateRole);

    if (!isSelf) {
      assertCanManageUserTarget(req, previousRole, 'edit');
    }
    if (!actorIsSuperAdmin && updateRole !== previousRole) {
      return res.status(403).json({ error: 'Only Super Admin can change user roles.' });
    }

    if (!isSelf && (previousRole === 'super_admin' || updateRole === 'super_admin') && !actorIsSuperAdmin) {
      return res.status(403).json({ error: 'Super admin access can only be managed by another super admin.' });
    }

    if (isPrivilegeChange || isApprovingAsPrivileged) {
      const confirmed = await verifyCurrentAdminPassword(req, adminPassword);
      if (!confirmed) {
        return res.status(403).json({ error: 'Current admin password is required before assigning privileged access.' });
      }
    }

    if (!isSelf && isAdminRole(updateRole) && updateActive === 0) {
      const adminCountRows = await queryAsync(
        "SELECT COUNT(*) AS total FROM users WHERE role IN ('super_admin', 'admin') AND active = TRUE AND id <> ?",
        [userId]
      );
      const activeAdminCount = Number(adminCountRows[0]?.total || 0);
      if (activeAdminCount === 0) {
        return res.status(400).json({ error: 'Hindi puwedeng i-disable ang huling active admin.' });
      }
    }

    if (!isSelf && previousRole === 'super_admin' && (updateRole !== 'super_admin' || updateActive === 0)) {
      const superAdminRows = await queryAsync(
        "SELECT COUNT(*) AS total FROM users WHERE role = 'super_admin' AND active = TRUE AND id <> ?",
        [userId]
      );
      const activeSuperAdminCount = Number(superAdminRows[0]?.total || 0);
      if (activeSuperAdminCount === 0) {
        return res.status(400).json({ error: 'Hindi puwedeng alisin o i-disable ang huling active super admin.' });
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

    const fields = ['fullname = ?', 'username = ?', 'email = ?', 'role = ?', 'active = ?', 'approval_status = ?'];
    const values = [name, normalizedUsername, normalizedEmail, updateRole, updateActive, nextApprovalStatus];

    if (!isSelf && nextApprovalStatus === 'approved' && previousApprovalStatus !== 'approved') {
      fields.push('approved_by = ?', 'approved_at = NOW()');
      values.push(req.session.user.id);
    }

    values.push(userId);

    db.query(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`, values, (err) => {
      if (err) {
        if (isPostgresUniqueViolation(err)) {
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
    res.status(e.statusCode || 500).json({ error: e.message });
  }
});

app.get('/api/admin/logs', protectSuperAdmin, (req, res) => {
  if (!isAdminRole(req.session.user.role)) {
    return res.status(403).json({ error: 'Access denied' });
  }

  const search = String(req.query.q || '').trim().toLowerCase();
  const action = String(req.query.action || '').trim();
  const moduleName = String(req.query.module || '').trim().toLowerCase();
  const userId = Number(req.query.user_id || 0) || null;
  const dateFrom = String(req.query.date_from || '').trim();
  const dateTo = String(req.query.date_to || '').trim();
  const limit = Math.max(25, Math.min(500, Number(req.query.limit || 200) || 200));
  const where = [];
  const params = [];

  if (search) {
    where.push(`(
      LOWER(COALESCE(l.module, '')) LIKE ?
      OR LOWER(COALESCE(l.action, '')) LIKE ?
      OR LOWER(COALESCE(l.details, '')) LIKE ?
      OR LOWER(COALESCE(l.ip_address, '')) LIKE ?
      OR LOWER(COALESCE(u.fullname, '')) LIKE ?
      OR LOWER(COALESCE(u.username, '')) LIKE ?
      OR LOWER(COALESCE(u.role, '')) LIKE ?
    )`);
    const like = `%${search}%`;
    params.push(like, like, like, like, like, like, like);
  }
  if (action) {
    where.push('l.action = ?');
    params.push(action);
  }
  if (moduleName) {
    where.push("LOWER(COALESCE(l.module, 'system')) = ?");
    params.push(moduleName);
  }
  if (userId) {
    where.push('l.user_id = ?');
    params.push(userId);
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateFrom)) {
    where.push('l.created_at::date >= ?');
    params.push(dateFrom);
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateTo)) {
    where.push('l.created_at::date <= ?');
    params.push(dateTo);
  }
  params.push(limit);

  db.query(`
    SELECT
      l.id,
      l.module,
      l.action,
      l.details,
      l.ip_address,
      l.created_at,
      u.fullname,
      u.username,
      COALESCE(u.role, 'system') AS user_role
    FROM system_logs l
    LEFT JOIN users u ON u.id = l.user_id
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY l.created_at DESC, l.id DESC
    LIMIT ?
  `, params, (err, rows) => {
    if (err) {
      console.error('Load logs error:', err);
      return res.status(500).json({ error: err.message });
    }
    res.json(rows);
  });
});

// Per-record audit timeline — every log row touching one record (entity_type + entity_id),
// newest first. Powers the shared "Record History" modal. Admin + super-admin only.
app.get('/api/audit', protectAdminOnly, (req, res) => {
  const entityType = String(req.query.entity_type || '').trim().toLowerCase();
  const entityId = Number(req.query.entity_id || 0) || 0;
  if (!entityType || !entityId) return res.json({ entries: [] });
  const limit = Math.max(1, Math.min(200, Number(req.query.limit || 100) || 100));
  db.query(`
    SELECT
      l.id, l.module, l.action, l.details, l.changed_fields, l.severity,
      l.ip_address, l.created_at,
      u.fullname, u.username, COALESCE(u.role, 'system') AS user_role
    FROM system_logs l
    LEFT JOIN users u ON u.id = l.user_id
    WHERE LOWER(COALESCE(l.entity_type, '')) = ? AND l.entity_id = ?
    ORDER BY l.created_at DESC, l.id DESC
    LIMIT ?
  `, [entityType, entityId, limit], (err, rows) => {
    if (err) {
      console.error('Audit history error:', err);
      return res.status(500).json({ error: err.message });
    }
    res.json({ entries: rows || [] });
  });
});

app.patch('/api/admin/users/:id/approve', protectAdminOnly, async (req, res) => {

  const userId = Number(req.params.id || 0);
  const requestedRole = normalizeAccessRole(req.body?.role);
  const role = ['super_admin', 'admin', 'staff'].includes(requestedRole) ? requestedRole : 'staff';
  const adminPassword = String(req.body?.adminPassword || '');

  if (!Number.isInteger(userId) || userId <= 0) {
    return res.status(400).json({ error: 'Invalid user ID.' });
  }
  if (userId === Number(req.session.user.id || 0)) {
    return res.status(400).json({ error: 'Hindi puwedeng i-approve ang sarili mong account dito.' });
  }

  try {
    const rows = await queryAsync('SELECT id, username, fullname, email, role, approval_status FROM users WHERE id = ? LIMIT 1', [userId]);
    if (!rows.length) return res.status(404).json({ error: 'User not found.' });
    const previousRole = normalizeAccessRole(rows[0].role);
    const actorIsSuperAdmin = canManageSuperAdmin(req);

    assertCanManageUserTarget(req, previousRole, 'approve');

    if (!actorIsSuperAdmin && role !== 'staff') {
      return res.status(403).json({ error: 'Admin can approve staff accounts only.' });
    }

    if (previousRole === 'super_admin' && role !== 'super_admin' && !actorIsSuperAdmin) {
      return res.status(403).json({ error: 'Super admin access can only be managed by another super admin.' });
    }

    if (role === 'super_admin' && !actorIsSuperAdmin) {
      return res.status(403).json({ error: 'Super admin access can only be assigned by another super admin.' });
    }

    if (actorIsSuperAdmin && isPrivilegedRole(role)) {
      const confirmed = await verifyCurrentAdminPassword(req, adminPassword);
      if (!confirmed) {
        return res.status(403).json({ error: 'Current admin password is required before assigning privileged access.' });
      }
    }

    await queryAsync(
      "UPDATE users SET role = ?, active = TRUE, approval_status = 'approved', approved_by = ?, approved_at = NOW() WHERE id = ?",
      [role, req.session.user.id, userId]
    );
    logAction(req, 'APPROVE_USER', `Approved account: ${rows[0].username} as ${role}`);
    sendBackgroundNotification(() => notifyUserAccountDecision(rows[0], 'approved', role, {
      baseUrl: getRequestBaseUrl(req),
      approvedBy: getApprovalActorLabel(req)
    }), 'user approval result email');
    res.json({ success: true });
  } catch (err) {
    console.error('Approve User Error:', err);
    res.status(err.statusCode || 500).json({ error: err.message || 'Unable to approve user.' });
  }
});

app.patch('/api/admin/users/:id/reject', protectAdminOnly, async (req, res) => {

  const userId = Number(req.params.id || 0);
  if (!Number.isInteger(userId) || userId <= 0) {
    return res.status(400).json({ error: 'Invalid user ID.' });
  }
  if (userId === Number(req.session.user.id || 0)) {
    return res.status(400).json({ error: 'Hindi puwedeng i-reject ang sarili mong account dito.' });
  }

  try {
    const rows = await queryAsync('SELECT id, username, fullname, email, role FROM users WHERE id = ? LIMIT 1', [userId]);
    if (!rows.length) return res.status(404).json({ error: 'User not found.' });
    assertCanManageUserTarget(req, rows[0].role, 'reject');
    if (normalizeAccessRole(rows[0].role) === 'super_admin' && !canManageSuperAdmin(req)) {
      return res.status(403).json({ error: 'Super admin access can only be managed by another super admin.' });
    }

    await queryAsync(
      "UPDATE users SET active = FALSE, approval_status = 'rejected', approved_by = ?, approved_at = NOW() WHERE id = ?",
      [req.session.user.id, userId]
    );
    logAction(req, 'REJECT_USER', `Rejected account request: ${rows[0].username} (${rows[0].role})`);
    sendBackgroundNotification(() => notifyUserAccountDecision(rows[0], 'rejected', rows[0].role, {
      baseUrl: getRequestBaseUrl(req),
      decidedBy: getApprovalActorLabel(req)
    }), 'user rejection result email');
    res.json({ success: true });
  } catch (err) {
    console.error('Reject User Error:', err);
    res.status(err.statusCode || 500).json({ error: err.message || 'Unable to reject user.' });
  }
});

app.get('/api/admin/logs/export', protectSuperAdmin, async (req, res) => {
  if (!isAdminRole(req.session.user.role)) {
    return res.status(403).json({ error: 'Access denied' });
  }

  try {
    const format = String(req.query.format || 'csv').toLowerCase();
    const search = String(req.query.q || '').trim().toLowerCase();
    const action = String(req.query.action || '').trim();
    const moduleName = String(req.query.module || '').trim().toLowerCase();
    const userId = Number(req.query.user_id || 0) || null;
    const dateFrom = String(req.query.date_from || '').trim();
    const dateTo = String(req.query.date_to || '').trim();
    const where = [];
    const params = [];

    if (search) {
      where.push(`(
        LOWER(COALESCE(l.module, '')) LIKE ?
        OR LOWER(COALESCE(l.action, '')) LIKE ?
        OR LOWER(COALESCE(l.details, '')) LIKE ?
        OR LOWER(COALESCE(l.ip_address, '')) LIKE ?
        OR LOWER(COALESCE(u.fullname, '')) LIKE ?
        OR LOWER(COALESCE(u.username, '')) LIKE ?
        OR LOWER(COALESCE(u.role, '')) LIKE ?
      )`);
      const like = `%${search}%`;
      params.push(like, like, like, like, like, like, like);
    }
    if (action) {
      where.push('l.action = ?');
      params.push(action);
    }
    if (moduleName) {
      where.push("LOWER(COALESCE(l.module, 'system')) = ?");
      params.push(moduleName);
    }
    if (userId) {
      where.push('l.user_id = ?');
      params.push(userId);
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateFrom)) {
      where.push('l.created_at::date >= ?');
      params.push(dateFrom);
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateTo)) {
      where.push('l.created_at::date <= ?');
      params.push(dateTo);
    }

    const rows = await queryAsync(`
      SELECT
        l.module,
        COALESCE(u.fullname, u.username, 'System') AS user_name,
        COALESCE(u.role, 'system') AS user_role,
        l.action,
        l.details,
        to_char(l.created_at, 'YYYY-MM-DD HH24:MI:SS') AS created_at,
        COALESCE(l.ip_address, '') AS ip_address
      FROM system_logs l
      LEFT JOIN users u ON u.id = l.user_id
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY l.created_at DESC, l.id DESC
      LIMIT 500
    `, params);

    const filenameBase = `system-logs-${new Date().toISOString().slice(0, 10)}`;
    logAction(req, 'EXPORT_SYSTEM_LOGS', `Exported system logs as ${format.toUpperCase()} | Filters: ${search || 'none'} | Action: ${action || 'all'} | Module: ${moduleName || 'all'}`, 'audit');

    const exportRows = rows.map((row) => ({
      created_at: row.created_at,
      module: row.module || '',
      user_name: row.user_name,
      user_role: row.user_role || '',
      action: row.action,
      details: row.details,
      ip_address: row.ip_address || ''
    }));
    const headers = ['created_at', 'module', 'user_name', 'user_role', 'action', 'details', 'ip_address'];

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


app.patch('/api/admin/users/:id/toggle', protectAdminOnly, (req, res) => {

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
    const targetRole = normalizeAccessRole(target.role);
    try {
      assertCanManageUserTarget(req, targetRole, 'enable or disable');
    } catch (accessErr) {
      return res.status(accessErr.statusCode || 403).json({ error: accessErr.message });
    }
    if (targetRole === 'super_admin' && !canManageSuperAdmin(req)) {
      return res.status(403).json({ error: 'Super admin access can only be managed by another super admin.' });
    }
    const applyToggle = () => {
      db.query('UPDATE users SET active = NOT active WHERE id = ?', [userId], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        logAction(req, 'TOGGLE_USER_STATUS', `Toggled account status: ${target.username} (${target.role})`);
        res.json({ success: true });
      });
    };

    if (!isAdminRole(targetRole) || Number(target.active || 0) === 0) {
      applyToggle();
      return;
    }

    db.query(
      "SELECT COUNT(*) AS total FROM users WHERE role IN ('super_admin', 'admin') AND active = TRUE AND id <> ?",
      [userId],
      (countErr, countRows) => {
        if (countErr) return res.status(500).json({ error: countErr.message });
        if ((countRows[0]?.total || 0) < 1) {
          return res.status(400).json({ error: 'Hindi puwedeng i-disable ang huling active admin.' });
        }
        if (targetRole === 'super_admin') {
          db.query(
            "SELECT COUNT(*) AS total FROM users WHERE role = 'super_admin' AND active = TRUE AND id <> ?",
            [userId],
            (superCountErr, superCountRows) => {
              if (superCountErr) return res.status(500).json({ error: superCountErr.message });
              if ((superCountRows[0]?.total || 0) < 1) {
                return res.status(400).json({ error: 'Hindi puwedeng i-disable ang huling active super admin.' });
              }
              applyToggle();
            }
          );
          return;
        }
        applyToggle();
      }
    );
  });
});

app.delete('/api/admin/users/:id', protectAdminOnly, (req, res) => {

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
    const targetRole = normalizeAccessRole(target.role);
    try {
      assertCanManageUserTarget(req, targetRole, 'delete');
    } catch (accessErr) {
      return res.status(accessErr.statusCode || 403).json({ error: accessErr.message });
    }
    if (targetRole === 'super_admin' && !canManageSuperAdmin(req)) {
      return res.status(403).json({ error: 'Super admin access can only be managed by another super admin.' });
    }
    const deleteTarget = () => {
      db.query('DELETE FROM users WHERE id = ?', [userId], (deleteErr, result) => {
        if (deleteErr) return res.status(500).json({ error: deleteErr.message });
        if (result.affectedRows === 0) return res.status(404).json({ error: 'User not found.' });

        logAction(req, 'DELETE_USER', `Deleted account: ${target.username} (${target.role})`);
        res.json({ success: true });
      });
    };

    if (!isAdminRole(targetRole)) {
      deleteTarget();
      return;
    }

    db.query(
      "SELECT COUNT(*) AS total FROM users WHERE role IN ('super_admin', 'admin') AND id <> ?",
      [userId],
      (countErr, countRows) => {
        if (countErr) return res.status(500).json({ error: countErr.message });
        if ((countRows[0]?.total || 0) < 1) {
          return res.status(400).json({ error: 'Hindi puwedeng i-delete ang huling admin account.' });
        }
        if (targetRole === 'super_admin') {
          db.query(
            "SELECT COUNT(*) AS total FROM users WHERE role = 'super_admin' AND id <> ?",
            [userId],
            (superCountErr, superCountRows) => {
              if (superCountErr) return res.status(500).json({ error: superCountErr.message });
              if ((superCountRows[0]?.total || 0) < 1) {
                return res.status(400).json({ error: 'Hindi puwedeng i-delete ang huling super admin account.' });
              }
              deleteTarget();
            }
          );
          return;
        }
        deleteTarget();
      }
    );
  });
});

app.patch('/api/admin/users/:id/reset-password', protectAdminOnly, async (req, res) => {
  return res.status(403).json({ error: 'Admins cannot set user passwords. Use forgot password / reset link flow.' });

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
const server = app.listen(PORT, () => {
  console.log(`\nâœ… Server running at http://localhost:${PORT}`);
  console.log(`   â†’ Login Page  : http://localhost:${PORT}/`);
  console.log(`   â†’ Admin Panel : http://localhost:${PORT}/admin`);
  console.log(`   â†’ Public View : http://localhost:${PORT}/status\n`);
});


// ==================== PROCESS SAFETY NETS ====================
// Log instead of letting a stray rejection/exception kill the server silently.
process.on("unhandledRejection", (reason) => {
  console.error("[unhandledRejection]", reason && reason.stack ? reason.stack : reason);
});
process.on("uncaughtException", (err) => {
  console.error("[uncaughtException]", err && err.stack ? err.stack : err);
});

// Graceful shutdown: stop accepting connections, then drain the DB pool so a
// deploy/restart does not leave half-open Postgres connections behind.
let shuttingDown = false;
function gracefulShutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`
[${signal}] shutting down...`);
  const done = () => process.exit(0);
  const force = setTimeout(() => process.exit(1), 10000);
  force.unref();
  server.close(() => {
    if (db && typeof db.end === "function") {
      db.end(() => done());
    } else {
      done();
    }
  });
}
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));
