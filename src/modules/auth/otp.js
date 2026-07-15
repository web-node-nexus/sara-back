const crypto = require('crypto');
const { config } = require('../../config/env');

/**
 * SMS / OTP sender — plug your provider via env.
 * OTP_SMS_URL + OTP_SMS_API_KEY: POST JSON { phone, message, otp }
 * OTP_MOCK=true: console log OTP (dev)
 */
async function sendSmsOtp(phone, otp, purpose) {
  const message = `SARA 567 OTP: ${otp}. Purpose: ${purpose}. Valid 5 min. Do not share.`;

  if (config.otp.mock) {
    console.log(`[OTP MOCK] phone=${phone} purpose=${purpose} otp=${otp}`);
    return { mock: true, otp: config.env === 'development' ? otp : undefined };
  }

  if (!config.otp.smsUrl) {
    const err = new Error('OTP SMS provider not configured');
    err.status = 503;
    err.code = 'OTP_PROVIDER_MISSING';
    throw err;
  }

  const res = await fetch(config.otp.smsUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.otp.apiKey}`,
      ...(config.otp.extraHeaders || {}),
    },
    body: JSON.stringify({
      phone,
      mobile: phone,
      otp,
      message,
      purpose,
      ...(config.otp.extraBody || {}),
    }),
    signal: AbortSignal.timeout(1500),
  });

  if (!res.ok) {
    const text = await res.text();
    const err = new Error(`SMS send failed: ${text}`);
    err.status = 502;
    err.code = 'SMS_FAILED';
    throw err;
  }

  return { ok: true };
}

function hashOtp(code) {
  return crypto.createHash('sha256').update(String(code)).digest('hex');
}

function generateOtp() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function normalizePhone(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('91')) return digits.slice(2);
  if (digits.length === 10) return digits;
  return null;
}

module.exports = {
  sendSmsOtp,
  hashOtp,
  generateOtp,
  normalizePhone,
};
