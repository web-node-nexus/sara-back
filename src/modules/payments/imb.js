const crypto = require('crypto');
const { config } = require('../../config/env');

/**
 * IMB single-merchant payment adapter.
 * When IMB_MOCK=true (default), creates a local mock order for development.
 * Swap createPayment/verifyWebhook with real IMB HTTP calls when credentials arrive.
 */
async function createPayment({ orderId, amount, userId, returnUrl }) {
  if (config.imb.mock) {
    const imbRef = `IMB_MOCK_${orderId}`;
    return {
      imbRef,
      payUrl: `sara567://deposit/mock?orderId=${orderId}&amount=${amount}`,
      qrPayload: `upi://pay?pa=merchant@imb&am=${amount}&tn=SARA567-${orderId}`,
      merchantId: config.imb.merchantId,
    };
  }

  const res = await fetch(`${config.imb.baseUrl}/payments`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Merchant-Id': config.imb.merchantId,
      Authorization: `Bearer ${config.imb.apiKey}`,
    },
    body: JSON.stringify({
      order_id: String(orderId),
      amount,
      user_id: String(userId),
      return_url: returnUrl,
      merchant_id: config.imb.merchantId,
    }),
    signal: AbortSignal.timeout(1500),
  });

  if (!res.ok) {
    const text = await res.text();
    const err = new Error(`IMB create failed: ${text}`);
    err.status = 502;
    err.code = 'IMB_ERROR';
    throw err;
  }

  const data = await res.json();
  return {
    imbRef: data.ref || data.transaction_id,
    payUrl: data.pay_url || data.payment_url,
    qrPayload: data.qr_payload || data.upi_intent || null,
    merchantId: config.imb.merchantId,
  };
}

function verifyWebhookSignature(rawBody, signatureHeader) {
  const expected = crypto
    .createHmac('sha256', config.imb.webhookSecret)
    .update(rawBody)
    .digest('hex');
  if (!signatureHeader) return config.imb.mock;
  try {
    return crypto.timingSafeEqual(
      Buffer.from(expected),
      Buffer.from(String(signatureHeader))
    );
  } catch {
    return false;
  }
}

module.exports = { createPayment, verifyWebhookSignature };
