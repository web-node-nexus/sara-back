const { query } = require('../config/db');
const cache = require('../config/redis');

const CACHE_KEY = 'app:settings';

const DEFAULTS = {
  callNumber: '',
  whatsappNumber: '',
  telegramLink: '',
  website: '',
  welcomeBonus: 0,
  gameStatus: true,
  autoApprove: true,
  autoResult: true,
  disawarAutoResult: true,
  starlineAutoResult: true,
  autoDepositStatus: true,
  autoDepositText: '',
  minDeposit: 200,
  maxDeposit: 100000,
  merchantCode: '',
  merchantName: '',
  offlinePaymentStatus: false,
  offlineUpiId: '',
  offlineInstructions: '',
  offlineQrUrl: '',
  offlineTips: '',
  withdrawStatus: true,
  withdrawAllowedPerDay: 1,
  withdrawMinAmount: 1000,
  withdrawMaxAmount: 100000,
  withdrawOpenTime: '10:00:00',
  withdrawCloseTime: '18:00:00',
  withdrawInstruction: '',
  withdrawCloseText: 'Cannot withdraw at this time',
  withdrawUpiStatus: true,
  withdrawPaymentMethods: {
    bank: true,
    upi: true,
    gpay: true,
    phonepe: true,
    paytm: true,
  },
  withdrawTerms: '',
  bidStatus: true,
  minBid: 5,
  maxBid: 100000,
};

const DEFAULT_WITHDRAW_METHODS = {
  bank: true,
  upi: true,
  gpay: true,
  phonepe: true,
  paytm: true,
};

function mapPaymentMethods(raw) {
  if (!raw) return { ...DEFAULT_WITHDRAW_METHODS };
  let obj = raw;
  if (typeof raw === 'string') {
    try {
      obj = JSON.parse(raw);
    } catch {
      return { ...DEFAULT_WITHDRAW_METHODS };
    }
  }
  return {
    bank: obj.bank !== false,
    upi: obj.upi !== false,
    gpay: obj.gpay !== false,
    phonepe: obj.phonepe !== false,
    paytm: obj.paytm !== false,
  };
}

function formatTimeVal(val) {
  if (!val) return '10:00:00';
  const s = String(val);
  if (/^\d{2}:\d{2}(:\d{2})?$/.test(s)) {
    return s.length === 5 ? `${s}:00` : s;
  }
  return '10:00:00';
}

function timeToMinutes(timeStr) {
  const s = formatTimeVal(timeStr);
  const [h, m] = s.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

function mapRow(row) {
  if (!row) return { ...DEFAULTS };
  return {
    callNumber: row.call_number || '',
    whatsappNumber: row.whatsapp_number || '',
    telegramLink: row.telegram_link || '',
    website: row.website || '',
    welcomeBonus: Number(row.welcome_bonus || 0),
    gameStatus: !!row.game_status,
    autoApprove: !!row.auto_approve,
    autoResult: !!row.auto_result,
    disawarAutoResult: !!row.disawar_auto_result,
    starlineAutoResult: !!row.starline_auto_result,
    autoDepositStatus: row.auto_deposit_status == null ? true : !!row.auto_deposit_status,
    autoDepositText: row.auto_deposit_text || '',
    minDeposit: Number(row.min_deposit ?? 200),
    maxDeposit: Number(row.max_deposit ?? 100000),
    merchantCode: row.merchant_code || '',
    merchantName: row.merchant_name || '',
    offlinePaymentStatus: !!row.offline_payment_status,
    offlineUpiId: row.offline_upi_id || '',
    offlineInstructions: row.offline_instructions || '',
    offlineQrUrl: row.offline_qr_url || '',
    offlineTips: row.offline_tips || '',
    withdrawStatus: row.withdraw_status == null ? true : !!row.withdraw_status,
    withdrawAllowedPerDay: Number(row.withdraw_allowed_per_day ?? 1),
    withdrawMinAmount: Number(row.withdraw_min_amount ?? 1000),
    withdrawMaxAmount: Number(row.withdraw_max_amount ?? 100000),
    withdrawOpenTime: formatTimeVal(row.withdraw_open_time || '10:00:00'),
    withdrawCloseTime: formatTimeVal(row.withdraw_close_time || '18:00:00'),
    withdrawInstruction: row.withdraw_instruction || '',
    withdrawCloseText: row.withdraw_close_text || 'Cannot withdraw at this time',
    withdrawUpiStatus: row.withdraw_upi_status == null ? true : !!row.withdraw_upi_status,
    withdrawPaymentMethods: mapPaymentMethods(row.withdraw_payment_methods),
    withdrawTerms: row.withdraw_terms || '',
    bidStatus: row.bid_status == null ? true : !!row.bid_status,
    minBid: Number(row.min_bid ?? 5),
    maxBid: Number(row.max_bid ?? 100000),
    updatedAt: row.updated_at || null,
  };
}

async function invalidateCache() {
  await cache.del(CACHE_KEY);
}

async function getAppSettings() {
  const cached = await cache.get(CACHE_KEY);
  if (cached) return cached;

  const rows = await query(`SELECT * FROM app_settings WHERE id = 1 LIMIT 1`);
  const settings = mapRow(rows[0]);
  await cache.set(CACHE_KEY, settings, 60);
  return settings;
}

async function updateProfile(fields) {
  await query(
    `UPDATE app_settings SET
       call_number = :callNumber,
       whatsapp_number = :whatsappNumber,
       telegram_link = :telegramLink,
       website = :website
     WHERE id = 1`,
    {
      callNumber: fields.callNumber?.trim() || null,
      whatsappNumber: fields.whatsappNumber?.trim() || null,
      telegramLink: fields.telegramLink?.trim() || null,
      website: fields.website?.trim() || null,
    }
  );
  await invalidateCache();
  return getAppSettings();
}

async function updateAppSettings(fields) {
  const sets = [];
  const params = {};

  if (fields.welcomeBonus !== undefined) {
    sets.push('welcome_bonus = :welcomeBonus');
    params.welcomeBonus = Math.max(0, Number(fields.welcomeBonus) || 0);
  }
  if (fields.gameStatus !== undefined) {
    sets.push('game_status = :gameStatus');
    params.gameStatus = fields.gameStatus ? 1 : 0;
  }
  if (fields.autoApprove !== undefined) {
    sets.push('auto_approve = :autoApprove');
    params.autoApprove = fields.autoApprove ? 1 : 0;
  }
  if (fields.autoResult !== undefined) {
    sets.push('auto_result = :autoResult');
    params.autoResult = fields.autoResult ? 1 : 0;
  }
  if (fields.disawarAutoResult !== undefined) {
    sets.push('disawar_auto_result = :disawarAutoResult');
    params.disawarAutoResult = fields.disawarAutoResult ? 1 : 0;
  }
  if (fields.starlineAutoResult !== undefined) {
    sets.push('starline_auto_result = :starlineAutoResult');
    params.starlineAutoResult = fields.starlineAutoResult ? 1 : 0;
  }

  if (!sets.length) return getAppSettings();

  await query(`UPDATE app_settings SET ${sets.join(', ')} WHERE id = 1`, params);
  await invalidateCache();
  return getAppSettings();
}

async function updateDepositAuto(fields) {
  await query(
    `UPDATE app_settings SET
       auto_deposit_status = :status,
       auto_deposit_text = :text
     WHERE id = 1`,
    {
      status: fields.autoDepositStatus ? 1 : 0,
      text: fields.autoDepositText?.trim() || null,
    }
  );
  await invalidateCache();
  return getAppSettings();
}

async function updateDepositLimits(fields) {
  const min = Math.max(1, Number(fields.minDeposit) || 1);
  const max = Math.max(min, Number(fields.maxDeposit) || min);
  await query(
    `UPDATE app_settings SET min_deposit = :min, max_deposit = :max WHERE id = 1`,
    { min, max }
  );
  await invalidateCache();
  return getAppSettings();
}

async function updateMerchant(fields) {
  await query(
    `UPDATE app_settings SET
       merchant_code = :code,
       merchant_name = :name
     WHERE id = 1`,
    {
      code: fields.merchantCode?.trim() || null,
      name: fields.merchantName?.trim() || null,
    }
  );
  await invalidateCache();
  return getAppSettings();
}

async function updateOfflinePayment(fields) {
  await query(
    `UPDATE app_settings SET
       offline_payment_status = :status,
       offline_upi_id = :upiId,
       offline_instructions = :instructions,
       offline_qr_url = :qrUrl,
       offline_tips = :tips
     WHERE id = 1`,
    {
      status: fields.offlinePaymentStatus ? 1 : 0,
      upiId: fields.offlineUpiId?.trim() || null,
      instructions: fields.offlineInstructions?.trim() || null,
      qrUrl: fields.offlineQrUrl?.trim() || null,
      tips: fields.offlineTips?.trim() || null,
    }
  );
  await invalidateCache();
  return getAppSettings();
}

function validateDepositAmount(settings, amount) {
  const n = Number(amount);
  const min = Number(settings.minDeposit || 200);
  const max = Number(settings.maxDeposit || 100000);
  if (!Number.isFinite(n) || n <= 0) {
    return { ok: false, message: 'Enter a valid amount' };
  }
  if (n < min || n > max) {
    return {
      ok: false,
      message: `Amount must be between ₹${min} and ₹${max}`,
      min,
      max,
    };
  }
  return { ok: true, min, max };
}

async function updateWithdrawSettings(fields) {
  const min = Math.max(1, Number(fields.withdrawMinAmount) || 1);
  const max = Math.max(min, Number(fields.withdrawMaxAmount) || min);
  await query(
    `UPDATE app_settings SET
       withdraw_status = :status,
       withdraw_allowed_per_day = :allowed,
       withdraw_min_amount = :min,
       withdraw_max_amount = :max,
       withdraw_open_time = :openTime,
       withdraw_close_time = :closeTime,
       withdraw_instruction = :instruction,
       withdraw_close_text = :closeText,
       withdraw_upi_status = :upiStatus
     WHERE id = 1`,
    {
      status: fields.withdrawStatus ? 1 : 0,
      allowed: Math.max(1, Math.min(20, Number(fields.withdrawAllowedPerDay) || 1)),
      min,
      max,
      openTime: formatTimeVal(fields.withdrawOpenTime),
      closeTime: formatTimeVal(fields.withdrawCloseTime),
      instruction: fields.withdrawInstruction?.trim() || null,
      closeText: fields.withdrawCloseText?.trim() || null,
      upiStatus: fields.withdrawUpiStatus ? 1 : 0,
    }
  );
  await invalidateCache();
  return getAppSettings();
}

async function updateWithdrawPaymentMethods(methods) {
  const payload = mapPaymentMethods(methods);
  await query(
    `UPDATE app_settings SET withdraw_payment_methods = :json WHERE id = 1`,
    { json: JSON.stringify(payload) }
  );
  await invalidateCache();
  return getAppSettings();
}

async function updateWithdrawTerms(terms) {
  await query(`UPDATE app_settings SET withdraw_terms = :terms WHERE id = 1`, {
    terms: terms?.trim() || null,
  });
  await invalidateCache();
  return getAppSettings();
}

function isWithdrawTimeOpen(settings, now = new Date()) {
  const { nowMinutesIST } = require('../utils/istTime');
  const nowM = nowMinutesIST(now);
  const openM = timeToMinutes(settings.withdrawOpenTime);
  const closeM = timeToMinutes(settings.withdrawCloseTime);
  if (closeM > openM) return nowM >= openM && nowM < closeM;
  return nowM >= openM || nowM < closeM;
}

function withdrawPublicConfig(settings) {
  return {
    status: settings.withdrawStatus,
    allowedPerDay: settings.withdrawAllowedPerDay,
    minAmount: settings.withdrawMinAmount,
    maxAmount: settings.withdrawMaxAmount,
    openTime: settings.withdrawOpenTime,
    closeTime: settings.withdrawCloseTime,
    instruction: settings.withdrawInstruction,
    closeText: settings.withdrawCloseText,
    upiStatus: settings.withdrawUpiStatus,
    paymentMethods: settings.withdrawPaymentMethods,
    terms: settings.withdrawTerms,
    isOpenNow: settings.withdrawStatus && isWithdrawTimeOpen(settings),
  };
}

async function countUserWithdrawsToday(userId) {
  const { todayStrIST } = require('../utils/istTime');
  const today = todayStrIST();
  const rows = await query(
    `SELECT COUNT(*) AS cnt FROM withdraw_requests
     WHERE user_id = :userId
       AND DATE(CONVERT_TZ(created_at, '+00:00', '+05:30')) = :today
       AND status <> 'rejected'`,
    { userId, today }
  );
  return Number(rows[0]?.cnt || 0);
}

async function validateWithdrawRequest(settings, input, userId) {
  const closeMsg =
    settings.withdrawCloseText || 'Cannot withdraw at this time';

  if (!settings.withdrawStatus) {
    return { ok: false, message: closeMsg, code: 'WITHDRAW_DISABLED' };
  }
  if (!isWithdrawTimeOpen(settings)) {
    return {
      ok: false,
      message: closeMsg,
      code: 'WITHDRAW_CLOSED_HOURS',
    };
  }

  const todayCount = await countUserWithdrawsToday(userId);
  if (todayCount >= Number(settings.withdrawAllowedPerDay || 1)) {
    return {
      ok: false,
      message: `Daily limit reached (${settings.withdrawAllowedPerDay} per day)`,
      code: 'WITHDRAW_DAILY_LIMIT',
      todayCount,
    };
  }

  const amount = Number(input.amount);
  const min = Number(settings.withdrawMinAmount || 1000);
  const max = Number(settings.withdrawMaxAmount || 100000);
  if (!Number.isFinite(amount) || amount <= 0) {
    return { ok: false, message: 'Enter a valid amount', code: 'INVALID_AMOUNT' };
  }
  if (amount < min || amount > max) {
    return {
      ok: false,
      message: `Amount must be between ₹${min} and ₹${max}`,
      code: 'AMOUNT_OUT_OF_RANGE',
    };
  }

  const methods = settings.withdrawPaymentMethods || DEFAULT_WITHDRAW_METHODS;
  const upi = (input.upiId || '').trim();
  const hasBank =
    (input.accountNumber || '').trim() &&
    (input.ifsc || '').trim() &&
    (input.accountName || '').trim();

  if (upi) {
    const upiAllowed =
      settings.withdrawUpiStatus &&
      (methods.upi || methods.gpay || methods.phonepe || methods.paytm);
    if (!upiAllowed) {
      return {
        ok: false,
        message: 'UPI withdrawal is not available',
        code: 'UPI_DISABLED',
      };
    }
  } else if (hasBank) {
    if (!methods.bank) {
      return {
        ok: false,
        message: 'Bank withdrawal is not available',
        code: 'BANK_DISABLED',
      };
    }
  } else {
    return {
      ok: false,
      message: 'Provide UPI ID or bank account details',
      code: 'PAYOUT_DETAILS_REQUIRED',
    };
  }

  return { ok: true, todayCount };
}

async function updateBidSettings(fields) {
  const min = Math.max(1, Number(fields.minBid) || 1);
  const max = Math.max(min, Number(fields.maxBid) || min);
  await query(
    `UPDATE app_settings SET
       bid_status = :status,
       min_bid = :min,
       max_bid = :max
     WHERE id = 1`,
    {
      status: fields.bidStatus ? 1 : 0,
      min,
      max,
    }
  );
  await invalidateCache();
  return getAppSettings();
}

function bidPublicConfig(settings) {
  const canBid = !!settings.bidStatus && !!settings.gameStatus;
  return {
    status: settings.bidStatus,
    minBid: settings.minBid,
    maxBid: settings.maxBid,
    canBid,
    gameStatus: settings.gameStatus,
  };
}

function validateBidPoints(settings, points) {
  if (!settings.bidStatus) {
    return {
      ok: false,
      message: 'Bidding is currently disabled',
      code: 'BIDS_DISABLED',
    };
  }
  if (!settings.gameStatus) {
    return {
      ok: false,
      message: 'Games are temporarily disabled',
      code: 'GAMES_DISABLED',
    };
  }
  const min = Number(settings.minBid || 5);
  const max = Number(settings.maxBid || 100000);
  const n = Number(points);
  if (!Number.isFinite(n) || n <= 0) {
    return { ok: false, message: 'Enter valid bid points', code: 'INVALID_BID' };
  }
  if (n < min || n > max) {
    return {
      ok: false,
      message: `Each bid must be between ₹${min} and ₹${max}`,
      code: 'BID_AMOUNT_OUT_OF_RANGE',
      min,
      max,
    };
  }
  return { ok: true, min, max };
}

function validateBidsPayload(settings, bids) {
  if (!Array.isArray(bids) || !bids.length) {
    return { ok: false, message: 'No bids to place', code: 'NO_BIDS' };
  }
  for (const b of bids) {
    const check = validateBidPoints(settings, b.points);
    if (!check.ok) return check;
  }
  return { ok: true };
}

function isDisawarMarket(nameOrId) {
  return String(nameOrId || '')
    .toLowerCase()
    .includes('disawar');
}

function canAutoResultForMarket(settings, marketName, marketId) {
  if (!settings.autoResult) return false;
  if (isDisawarMarket(marketName) || isDisawarMarket(marketId)) {
    return settings.disawarAutoResult;
  }
  return true;
}

module.exports = {
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
  validateDepositAmount,
  validateWithdrawRequest,
  validateBidPoints,
  validateBidsPayload,
  bidPublicConfig,
  countUserWithdrawsToday,
  isWithdrawTimeOpen,
  withdrawPublicConfig,
  mapPaymentMethods,
  invalidateCache,
  isDisawarMarket,
  canAutoResultForMarket,
  DEFAULTS,
};
