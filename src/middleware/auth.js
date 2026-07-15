const jwt = require('jsonwebtoken');
const { config } = require('../config/env');

function signAccess(payload) {
  return jwt.sign(payload, config.jwt.accessSecret, {
    expiresIn: config.jwt.accessTtl,
  });
}

function signRefresh(payload) {
  return jwt.sign(payload, config.jwt.refreshSecret, {
    expiresIn: config.jwt.refreshTtl,
  });
}

function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) {
    return res.status(401).json({ ok: false, error: 'UNAUTHORIZED' });
  }
  try {
    const decoded = jwt.verify(token, config.jwt.accessSecret);
    req.user = {
      id: decoded.sub,
      role: decoded.role,
      loginId: decoded.loginId,
    };
    return next();
  } catch {
    return res.status(401).json({ ok: false, error: 'INVALID_TOKEN' });
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ ok: false, error: 'FORBIDDEN' });
    }
    return next();
  };
}

module.exports = {
  signAccess,
  signRefresh,
  requireAuth,
  requireRole,
};
