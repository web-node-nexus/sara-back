const express = require('express');
const { getAppSettings, withdrawPublicConfig, bidPublicConfig } = require('../../services/appSettings');
const { listAllRates, publicByKind } = require('../../services/gameRates');
const { requireAuth } = require('../../middleware/auth');
const { getPublicNotices } = require('../../services/noticeService');
const {
  getCalculatorGateSettings,
  publicConfig,
} = require('../../services/calculatorGate');

const router = express.Router();

/** Public app config — contact links shown in player app */
router.get('/config', async (_req, res, next) => {
  try {
    const s = await getAppSettings();
    const gameRates = publicByKind(await listAllRates());
    res.json({
      ok: true,
      config: {
        callNumber: s.callNumber,
        whatsappNumber: s.whatsappNumber,
        telegramLink: s.telegramLink,
        website: s.website,
        gameStatus: s.gameStatus,
        welcomeBonus: s.welcomeBonus,
        deposit: {
          autoDepositStatus: s.autoDepositStatus,
          autoDepositText: s.autoDepositText,
          minDeposit: s.minDeposit,
          maxDeposit: s.maxDeposit,
          merchantCode: s.merchantCode,
          merchantName: s.merchantName,
          offlinePaymentStatus: s.offlinePaymentStatus,
          offlineUpiId: s.offlineUpiId,
          offlineInstructions: s.offlineInstructions,
          offlineQrUrl: s.offlineQrUrl,
          offlineTips: s.offlineTips,
        },
        withdraw: withdrawPublicConfig(s),
        bid: bidPublicConfig(s),
        gameRates,
      },
    });
  } catch (err) {
    next(err);
  }
});

/** Admin app lock — public, needed before login */
router.get('/calculator-gate', async (_req, res, next) => {
  try {
    const settings = await getCalculatorGateSettings();
    res.json({ ok: true, calculatorGate: publicConfig(settings) });
  } catch (err) {
    next(err);
  }
});

/** Player app — flash popup, marquee, notice board */
router.get('/notices', requireAuth, async (_req, res, next) => {
  try {
    const notices = await getPublicNotices();
    res.json({ ok: true, notices });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
