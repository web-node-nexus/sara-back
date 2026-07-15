const { config } = require('../config/env');

/** Hard SLA: every request must finish under API_TIMEOUT_MS (default 2s) */
function requestTimeout(req, res, next) {
  const ms = config.apiTimeoutMs;
  const started = Date.now();
  res.setHeader('X-Request-Timeout-Ms', String(ms));

  const timer = setTimeout(() => {
    if (res.headersSent) return;
    res.status(504).json({
      ok: false,
      error: 'REQUEST_TIMEOUT',
      message: `API must respond within ${ms}ms`,
      elapsedMs: Date.now() - started,
    });
  }, ms);

  const end = res.end.bind(res);
  res.end = (...args) => {
    clearTimeout(timer);
    res.setHeader('X-Response-Time-Ms', String(Date.now() - started));
    return end(...args);
  };

  next();
}

module.exports = { requestTimeout };
