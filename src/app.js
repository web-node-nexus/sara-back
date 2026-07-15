const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const path = require('path');
const rateLimit = require('express-rate-limit');
const { requestTimeout } = require('./middleware/timeout');
const { errorHandler } = require('./middleware/errorHandler');
const { requireAuth } = require('./middleware/auth');

const authRoutes = require('./modules/auth/routes');
const walletRoutes = require('./modules/wallet/routes');
const imbWebhook = require('./modules/payments/webhook');
const marketsRoutes = require('./modules/markets/routes');
const bidsRoutes = require('./modules/bids/routes');
const chatRoutes = require('./modules/chat/routes');
const adminRoutes = require('./modules/admin/routes');
const mediaRoutes = require('./modules/media/routes');

function createApp() {
  const app = express();
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.use(cors());
  app.use(morgan('dev'));
  app.use(requestTimeout);

  app.use('/api/v1/wallet/imb/webhook', imbWebhook);
  app.use(express.json({ limit: '1mb' }));
  app.use(
    '/uploads',
    express.static(path.join(__dirname, '../uploads'), { maxAge: '7d' })
  );

  app.get('/health', (_req, res) => {
    res.json({ ok: true, service: 'sara567-api', ts: Date.now() });
  });

  const limiter = rateLimit({
    windowMs: 60_000,
    max: 180,
    standardHeaders: true,
    legacyHeaders: false,
  });
  app.use('/api/', limiter);

  app.use('/api/v1/auth', authRoutes);
  app.use('/api/v1/wallet', walletRoutes);
  app.use('/api/v1/markets', marketsRoutes);
  app.use('/api/v1/bids', bidsRoutes);
  app.use('/api/v1/chat', chatRoutes);
  app.use('/api/v1/admin', adminRoutes);
  app.use('/api/v1/media', mediaRoutes);

  app.get('/api/v1/secure-ping', requireAuth, (req, res) => {
    res.json({ ok: true, user: req.user });
  });

  app.use(errorHandler);
  return app;
}

module.exports = { createApp };
