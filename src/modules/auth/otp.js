const crypto = require('crypto');
const { config } = require('../../config/env');

/**
 * Jaipur SMS Hub (sms.jaipurmshub.in) — multipart/form-data:
 *   sender_id, message, mobile_no, dlt_template_id
 *   Authorization: Bearer <token>
 */
async function sendSmsOtp(phone, otp, purpose) {
  const message = (
    config.otp.messageTemplate ||
    'Hi Your User OTP is: {otp} Thank you ! COMPANY NAME PTPSMS'
  ).replace(/\{otp\}/g, otp);

  if (config.otp.mock) {
    console.log(`[OTP MOCK] phone=${phone} purpose=${purpose} otp=${otp}`);
    return { mock: true, otp: config.env === 'development' ? otp : undefined };
  }

  if (!config.otp.smsUrl || !config.otp.apiKey) {
    const err = new Error('OTP SMS provider not configured');
    err.status = 503;
    err.code = 'OTP_PROVIDER_MISSING';
    throw err;
  }

  const form = new FormData();
  form.append('sender_id', config.otp.senderId || 'PTPSMS');
  form.append('message', message);
  form.append('mobile_no', phone);
  form.append('dlt_template_id', config.otp.dltTemplateId || '');

  let res;
  try {
    res = await fetch(config.otp.smsUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.otp.apiKey}`,
      },
      body: form,
      signal: AbortSignal.timeout(config.otp.sendTimeoutMs || 8000),
    });
  } catch (fetchErr) {
    const err = new Error(`SMS network error: ${fetchErr.message}`);
    err.status = 502;
    err.code = 'SMS_NETWORK';
    throw err;
  }

  const text = await res.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {
    // plain text response
  }

  if (!res.ok) {
    const err = new Error(`SMS send failed (${res.status}): ${text}`);
    err.status = 502;
    err.code = 'SMS_FAILED';
    throw err;
  }

  console.log(`[OTP] SMS sent to ${phone} purpose=${purpose}`);
  return { ok: true, provider: data };
}

function hashOtp(code) {
  return crypto.createHash('sha256').update(String(code)).digest('hex');
}

/** 4-digit OTP — matches DLT template sample */
function generateOtp() {
  return String(Math.floor(1000 + Math.random() * 9000));
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
