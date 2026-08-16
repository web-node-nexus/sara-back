const express = require('express');
const { z } = require('zod');
const { requireAuth, requireRole } = require('../../middleware/auth');
const {
  getAppSettings,
  updateProfile,
  updateAppSettings,
  updateDepositAuto,
  updateDepositLimits,
  updateMerchant,
  updateOfflinePayment,
  updateWithdrawSettings,
  updateWithdrawPaymentMethods,
  updateWithdrawTerms,
  updateBidSettings,
  withdrawPublicConfig,
  bidPublicConfig,
} = require('../../services/appSettings');
const {
  getCalculatorGateSettings,
  updateCalculatorGateSettings,
  logAttempt,
} = require('../../services/calculatorGate');

const router = express.Router();

router.get(
  '/',
  requireAuth,
  requireRole('admin'),
  async (_req, res, next) => {
    try {
      const settings = await getAppSettings();
      res.json({ ok: true, settings });
    } catch (err) {
      next(err);
    }
  }
);

router.patch(
  '/profile',
  requireAuth,
  requireRole('admin'),
  async (req, res, next) => {
    try {
      const body = z
        .object({
          callNumber: z.string().max(20).optional(),
          whatsappNumber: z.string().max(24).optional(),
          telegramLink: z.string().max(255).optional(),
          website: z.string().max(255).optional(),
        })
        .parse(req.body);

      const settings = await updateProfile(body);
      res.json({ ok: true, settings, message: 'Profile updated' });
    } catch (err) {
      next(err);
    }
  }
);

router.patch(
  '/app',
  requireAuth,
  requireRole('admin'),
  async (req, res, next) => {
    try {
      const body = z
        .object({
          welcomeBonus: z.number().min(0).max(1000000).optional(),
          gameStatus: z.boolean().optional(),
          autoApprove: z.boolean().optional(),
          autoResult: z.boolean().optional(),
          disawarAutoResult: z.boolean().optional(),
          starlineAutoResult: z.boolean().optional(),
        })
        .parse(req.body);

      const settings = await updateAppSettings(body);
      res.json({ ok: true, settings });
    } catch (err) {
      next(err);
    }
  }
);

router.patch(
  '/deposit/auto',
  requireAuth,
  requireRole('admin'),
  async (req, res, next) => {
    try {
      const body = z
        .object({
          autoDepositStatus: z.boolean(),
          autoDepositText: z.string().max(4000).optional(),
        })
        .parse(req.body);
      const settings = await updateDepositAuto(body);
      res.json({ ok: true, settings, message: 'Auto deposit updated' });
    } catch (err) {
      next(err);
    }
  }
);

router.patch(
  '/deposit/limits',
  requireAuth,
  requireRole('admin'),
  async (req, res, next) => {
    try {
      const body = z
        .object({
          minDeposit: z.number().min(1).max(1000000),
          maxDeposit: z.number().min(1).max(1000000),
        })
        .parse(req.body);
      const settings = await updateDepositLimits(body);
      res.json({ ok: true, settings, message: 'Deposit limits updated' });
    } catch (err) {
      next(err);
    }
  }
);

router.patch(
  '/deposit/merchant',
  requireAuth,
  requireRole('admin'),
  async (req, res, next) => {
    try {
      const body = z
        .object({
          merchantCode: z.string().max(64).optional(),
          merchantName: z.string().max(120).optional(),
        })
        .parse(req.body);
      const settings = await updateMerchant(body);
      res.json({ ok: true, settings, message: 'Merchant info updated' });
    } catch (err) {
      next(err);
    }
  }
);

router.patch(
  '/deposit/offline',
  requireAuth,
  requireRole('admin'),
  async (req, res, next) => {
    try {
      const body = z
        .object({
          offlinePaymentStatus: z.boolean(),
          offlineUpiId: z.string().max(120).optional(),
          offlineInstructions: z.string().max(4000).optional(),
          offlineQrUrl: z.string().max(2000).optional(),
          offlineTips: z.string().max(4000).optional(),
        })
        .parse(req.body);
      const settings = await updateOfflinePayment(body);
      res.json({ ok: true, settings, message: 'Offline payment updated' });
    } catch (err) {
      next(err);
    }
  }
);

router.patch(
  '/withdraw',
  requireAuth,
  requireRole('admin'),
  async (req, res, next) => {
    try {
      const body = z
        .object({
          withdrawStatus: z.boolean(),
          withdrawAllowedPerDay: z.number().int().min(1).max(20),
          withdrawMinAmount: z.number().min(1).max(10000000),
          withdrawMaxAmount: z.number().min(1).max(10000000),
          withdrawOpenTime: z.string().max(12),
          withdrawCloseTime: z.string().max(12),
          withdrawInstruction: z.string().max(4000).optional(),
          withdrawCloseText: z.string().max(255).optional(),
          withdrawUpiStatus: z.boolean(),
        })
        .parse(req.body);
      const settings = await updateWithdrawSettings(body);
      res.json({ ok: true, settings, message: 'Withdrawal settings updated' });
    } catch (err) {
      next(err);
    }
  }
);

router.patch(
  '/withdraw/payment-methods',
  requireAuth,
  requireRole('admin'),
  async (req, res, next) => {
    try {
      const body = z
        .object({
          bank: z.boolean(),
          upi: z.boolean(),
          gpay: z.boolean(),
          phonepe: z.boolean(),
          paytm: z.boolean(),
        })
        .parse(req.body);
      const settings = await updateWithdrawPaymentMethods(body);
      res.json({ ok: true, settings, message: 'Payment methods updated' });
    } catch (err) {
      next(err);
    }
  }
);

router.patch(
  '/withdraw/terms',
  requireAuth,
  requireRole('admin'),
  async (req, res, next) => {
    try {
      const body = z.object({ withdrawTerms: z.string().max(8000) }).parse(req.body);
      const settings = await updateWithdrawTerms(body.withdrawTerms);
      res.json({ ok: true, settings, message: 'Withdrawal terms updated' });
    } catch (err) {
      next(err);
    }
  }
);

router.patch(
  '/bid',
  requireAuth,
  requireRole('admin'),
  async (req, res, next) => {
    try {
      const body = z
        .object({
          bidStatus: z.boolean(),
          minBid: z.number().min(1).max(1000000),
          maxBid: z.number().min(1).max(1000000),
        })
        .parse(req.body);
      if (body.minBid >= body.maxBid) {
        return res.status(400).json({
          ok: false,
          error: 'INVALID_RANGE',
          message: 'Min bid must be less than max bid amount',
        });
      }
      const settings = await updateBidSettings(body);
      res.json({ ok: true, settings, message: 'Bid settings updated' });
    } catch (err) {
      next(err);
    }
  }
);

router.get(
  '/calculator',
  requireAuth,
  requireRole('admin'),
  async (_req, res, next) => {
    try {
      const settings = await getCalculatorGateSettings();
      res.json({ ok: true, settings });
    } catch (err) {
      next(err);
    }
  }
);

router.patch(
  '/calculator',
  requireAuth,
  requireRole('admin'),
  async (req, res, next) => {
    try {
      const body = z
        .object({
          gateEnabled: z.boolean().optional(),
          triggerValue: z.number().finite().optional(),
          unlockAction: z.enum(['app', 'secret']).optional(),
          allowAdd: z.boolean().optional(),
          allowSub: z.boolean().optional(),
          allowMul: z.boolean().optional(),
          allowDiv: z.boolean().optional(),
          maxAttempts: z.number().int().min(0).max(999).optional(),
          lockMinutes: z.number().int().min(1).max(120).optional(),
          showOnResume: z.boolean().optional(),
          superadminOnly: z.boolean().optional(),
          visualTheme: z.enum(['neon', 'classic', 'dark']).optional(),
          displayMode: z.enum(['fullscreen', 'modal']).optional(),
        })
        .parse(req.body);
      const settings = await updateCalculatorGateSettings(body);
      res.json({ ok: true, settings, message: 'Calculator settings saved' });
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/calculator/log',
  requireAuth,
  requireRole('admin'),
  async (req, res, next) => {
    try {
      const body = z
        .object({
          success: z.boolean(),
          displayValue: z.string().max(64).optional(),
          deviceHint: z.string().max(120).optional(),
        })
        .parse(req.body);
      await logAttempt({
        userId: req.user.id,
        deviceHint: body.deviceHint,
        success: body.success,
        displayValue: body.displayValue,
      });
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
