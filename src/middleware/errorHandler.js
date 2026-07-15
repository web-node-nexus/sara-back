function errorHandler(err, req, res, _next) {
  console.error('[api-error]', err);
  const status = err.status || 500;
  res.status(status).json({
    ok: false,
    error: err.code || 'INTERNAL_ERROR',
    message: err.message || 'Something went wrong',
  });
}

module.exports = { errorHandler };
