const path = require('path');
require('dotenv').config({
  path: path.join(__dirname, '../../.env'),
  override: true,
});

function required(name, fallback) {
  const v = process.env[name] ?? fallback;
  if (v === undefined || v === '') {
    throw new Error(`Missing env ${name}`);
  }
  return v;
}

const config = {
  env: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT || 4000),
  apiTimeoutMs: Number(process.env.API_TIMEOUT_MS || 2000),
  mysql: {
    host: process.env.MYSQL_HOST || '127.0.0.1',
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER || 'root',
    password: process.env.MYSQL_PASSWORD || '',
    database: process.env.MYSQL_DATABASE || 'sara567',
    connectionLimit: Number(process.env.MYSQL_POOL || 20),
  },
  jwt: {
    accessSecret: required(
      'JWT_ACCESS_SECRET',
      'dev-access-secret-change-in-prod-32chars'
    ),
    refreshSecret: required(
      'JWT_REFRESH_SECRET',
      'dev-refresh-secret-change-in-prod-32chars'
    ),
    accessTtl: process.env.JWT_ACCESS_TTL || '15m',
    refreshTtl: process.env.JWT_REFRESH_TTL || '30d',
  },
  imb: {
    merchantId: process.env.IMB_MERCHANT_ID || 'demo-merchant',
    /** PG Create Order / Check Status — API Credentials → user_token */
    apiKey: process.env.IMB_API_KEY || 'demo-api-key',
    webhookSecret: process.env.IMB_WEBHOOK_SECRET || 'demo-webhook-secret',
    baseUrl: process.env.IMB_BASE_URL || 'https://api.imbpay.in/v2',
    redirectUrl:
      process.env.IMB_REDIRECT_URL ||
      (process.env.PUBLIC_BASE_URL
        ? `${String(process.env.PUBLIC_BASE_URL).replace(/\/$/, '')}/deposit/done`
        : 'http://127.0.0.1:4000/deposit/done'),
    payoutBaseUrl:
      process.env.IMB_PAYOUT_BASE_URL ||
      'https://secure.imbpayment.com/api/v1',
    payoutToken: process.env.IMB_PAYOUT_TOKEN || '',
    senderName: process.env.IMB_SENDER_NAME || 'SARA567',
    mock: String(process.env.IMB_MOCK || 'true') === 'true',
  },
  otp: {
    mock: String(process.env.OTP_MOCK || 'true') === 'true',
    smsUrl: process.env.OTP_SMS_URL || '',
    apiKey: process.env.OTP_SMS_API_KEY || '',
    senderId: process.env.OTP_SMS_SENDER_ID || 'PTPSMS',
    dltTemplateId: process.env.OTP_SMS_DLT_TEMPLATE_ID || '',
    messageTemplate:
      process.env.OTP_SMS_MESSAGE ||
      'Hi Your User OTP is: {otp} Thank you ! COMPANY NAME PTPSMS',
    sendTimeoutMs: Number(process.env.OTP_SMS_TIMEOUT_MS || 8000),
    ttlSeconds: Number(process.env.OTP_TTL_SECONDS || 300),
    ticketTtlSeconds: Number(process.env.OTP_TICKET_TTL_SECONDS || 600),
  },
  redisUrl: process.env.REDIS_URL || '',
  publicBaseUrl: process.env.PUBLIC_BASE_URL || 'http://127.0.0.1:4000',
  scrapeUrl: process.env.SCRAPE_URL || '',
  firebase: {
    projectId: process.env.FIREBASE_PROJECT_ID || '',
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL || '',
    privateKey: process.env.FIREBASE_PRIVATE_KEY || '',
  },
};

module.exports = { config };
