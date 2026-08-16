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
const imbPayoutWebhook = require('./modules/payments/payoutWebhook');
const marketsRoutes = require('./modules/markets/routes');
const bidsRoutes = require('./modules/bids/routes');
const starlineRoutes = require('./modules/starline/routes');
const jackpotRoutes = require('./modules/jackpot/routes');
const chatRoutes = require('./modules/chat/routes');
const adminRoutes = require('./modules/admin/routes');
const adminMarketsRoutes = require('./modules/admin/markets');
const adminUsersRoutes = require('./modules/admin/users');
const adminReportsRoutes = require('./modules/admin/reports');
  const adminDepositCallsRoutes = require('./modules/admin/depositCalls');
  const adminWithdrawCallsRoutes = require('./modules/admin/withdrawCalls');
  const adminAllUsersCallsRoutes = require('./modules/admin/allUsersCalls');
const adminSettingsRoutes = require('./modules/admin/settings');
const adminSlotGameOnOffRoutes = require('./modules/admin/slotGameOnOff');
const adminNoticesRoutes = require('./modules/admin/notices');
const adminNotificationsRoutes = require('./modules/admin/notifications');
const notificationsRoutes = require('./modules/notifications/routes');
const appPublicRoutes = require('./modules/app/routes');
const mediaRoutes = require('./modules/media/routes');
const devicesRoutes = require('./modules/devices/routes');

function createApp() {
  const app = express();
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.use(cors());
  app.use(morgan('dev'));
  app.use(requestTimeout);

  // IMB callbacks before global JSON parser (form / json / text)
  app.use('/api/v1/wallet/imb/webhook', imbWebhook);
  app.use('/api/v1/wallet/imb/payout-webhook', imbPayoutWebhook);
  app.use(express.json({ limit: '1mb' }));

  // IMB payment-link return URL — verify + credit, then show status page.
  // Expo openAuthSessionAsync dismisses when this URL is hit.
  app.get('/deposit/done', async (req, res) => {
    const { tryCreditIfImbPaid } = require('./modules/wallet/service');
    const orderIdRaw =
      req.query.order_id ||
      req.query.orderId ||
      req.query.txnid ||
      req.query.txnId;
    const orderId = orderIdRaw != null ? Number(orderIdRaw) : NaN;

    let title = 'Payment received';
    let subtitle = 'Return to the SARA app — wallet will update automatically.';
    let tone = '#3ddc84';

    if (Number.isFinite(orderId) && orderId > 0) {
      try {
        const out = await tryCreditIfImbPaid(orderId);
        if (out.paid) {
          title = 'Payment successful';
          subtitle = `₹${out.amount != null ? out.amount : ''} credited. You can close this and return to SARA.`;
          tone = '#3ddc84';
        } else if (out.failed) {
          title = 'Payment failed';
          subtitle = out.message || 'Transaction was not completed. Try again from the app.';
          tone = '#ff6b6b';
        } else {
          title = 'Confirming payment…';
          subtitle = `Order #${orderId} is still ${out.status || 'PENDING'}. Keep the SARA app open — it will credit when IMB confirms.`;
          tone = '#f5d76e';
        }
      } catch (err) {
        title = 'Confirming payment…';
        subtitle = `Order #${orderId}. Return to SARA — status will refresh automatically.`;
        tone = '#f5d76e';
        console.error('[deposit/done]', err.message || err);
      }
    }

    res.type('html').send(`<!doctype html>
<html><head><meta name="viewport" content="width=device-width,initial-scale=1"/>
<meta charset="utf-8"/></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,sans-serif;background:#0b1220;color:#fff;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:24px;box-sizing:border-box">
<div style="max-width:360px;text-align:center">
  <div style="width:64px;height:64px;border-radius:20px;background:${tone}22;border:1px solid ${tone}55;margin:0 auto 16px;display:flex;align-items:center;justify-content:center;font-size:28px">✓</div>
  <h2 style="margin:0 0 8px;font-size:22px;color:${tone}">${title}</h2>
  <p style="margin:0;color:#9aa4b2;line-height:1.45;font-size:15px">${subtitle}</p>
</div></body></html>`);
  });
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
  app.use('/api/v1/starline', starlineRoutes);
  app.use('/api/v1/jackpot', jackpotRoutes);
  app.use('/api/v1/chat', chatRoutes);
  app.use('/api/v1/admin', adminRoutes);
  app.use('/api/v1/admin/markets', adminMarketsRoutes);
  app.use('/api/v1/admin/players', adminUsersRoutes);
  app.use('/api/v1/admin/reports', adminReportsRoutes);
  app.use('/api/v1/admin/deposit-calls', adminDepositCallsRoutes);
  app.use('/api/v1/admin/withdraw-calls', adminWithdrawCallsRoutes);
  app.use('/api/v1/admin/all-users-calls', adminAllUsersCallsRoutes);
  app.use('/api/v1/admin/settings', adminSettingsRoutes);
  app.use('/api/v1/admin/slots', adminSlotGameOnOffRoutes);
  app.use('/api/v1/admin/notices', adminNoticesRoutes);
  app.use('/api/v1/admin/notifications', adminNotificationsRoutes);
  app.use('/api/v1/notifications', notificationsRoutes);
  app.use('/api/v1/app', appPublicRoutes);
  app.use('/api/v1/media', mediaRoutes);
  app.use('/api/v1/devices', devicesRoutes);
  app.use('/api/v1/calls', require('./modules/calls/routes'));

  app.get('/api/v1/secure-ping', requireAuth, (req, res) => {
    res.json({ ok: true, user: req.user });
  });

  app.use(errorHandler);
  return app;
}

module.exports = { createApp };
