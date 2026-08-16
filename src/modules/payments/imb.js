const { config } = require('../../config/env');

function formBody(fields) {
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(fields)) {
    if (v == null || v === '') continue;
    body.set(k, String(v));
  }
  return body;
}

function buildRedirectUrl(orderId) {
  const base = String(config.imb.redirectUrl || '')
    .trim()
    .replace(/[?#].*$/, '');
  const url = base || 'http://127.0.0.1:4000/deposit/done';
  return `${url}?order_id=${encodeURIComponent(String(orderId))}`;
}

async function postForm(url, fields, timeoutMs = 20000, retries = 1) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: formBody(fields),
        signal: AbortSignal.timeout(timeoutMs),
      });
      const text = await res.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        data = { raw: text };
      }
      return { ok: res.ok, status: res.status, data };
    } catch (err) {
      lastErr = err;
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
      }
    }
  }
  throw lastErr;
}

async function postJson(url, payload, headers = {}, timeoutMs = 20000) {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }
  return { ok: res.ok, status: res.status, data };
}

/**
 * Create IMB deposit order (UPI / payment page).
 * Docs: POST https://api.imbpay.in/v2/create-order (form-urlencoded)
 */
async function createPayment({
  orderId,
  amount,
  userId,
  customerMobile,
  remark1,
  remark2,
}) {
  if (config.imb.mock) {
    const imbRef = `IMB_MOCK_${orderId}`;
    return {
      imbRef,
      payUrl: `sara567://deposit/mock?orderId=${orderId}&amount=${amount}`,
      qrPayload: `upi://pay?pa=merchant@imb&am=${amount}&tn=SARA567-${orderId}`,
      phonepeLink: null,
      paytmLink: null,
      checkLink: null,
      merchantId: config.imb.merchantId,
      mock: true,
    };
  }

  const token = String(config.imb.apiKey || '').trim();
  if (
    !token ||
    token === 'demo-api-key' ||
    token === 'REPLACE_WITH_IMB_USER_TOKEN' ||
    token === 'your-imb-user-token'
  ) {
    const err = new Error(
      'IMB API token missing. Set IMB_API_KEY from merchant dashboard → API Credentials, then restart server.'
    );
    err.status = 500;
    err.code = 'IMB_CONFIG';
    throw err;
  }

  const { data } = await postForm(`${config.imb.baseUrl}/create-order`, {
    user_token: token,
    amount: String(amount),
    order_id: String(orderId),
    customer_mobile: String(customerMobile || '9999999999'),
    // Include order_id so /deposit/done can verify + credit after payment-link redirect
    redirect_url: buildRedirectUrl(orderId),
    remark1: remark1 || `user:${userId}`,
    remark2: remark2 || `SARA567 deposit ${orderId}`,
  });

  const result = data?.result || data?.data || {};
  const statusOk =
    data?.status === true ||
    data?.status === 'true' ||
    data?.status === 'SUCCESS' ||
    Boolean(result.payment_url || result.paymentUrl);

  if (!statusOk) {
    const err = new Error(
      data?.message || data?.raw || 'IMB create-order failed'
    );
    err.status = 502;
    err.code = 'IMB_ERROR';
    throw err;
  }

  return {
    imbRef:
      result.orderId ||
      result.order_id ||
      String(orderId),
    payUrl: result.payment_url || result.paymentUrl || null,
    qrPayload: result.bhim_link || result.upi_intent || null,
    phonepeLink: result.phonepe_link || null,
    paytmLink: result.paytm_link || null,
    checkLink: result.check_link || result.checkLink || null,
    merchantId: config.imb.merchantId,
    mock: false,
  };
}

function parseCheckLinkPayload(data) {
  const statusRaw =
    data?.status ??
    data?.txnStatus ??
    data?.txn_status ??
    data?.result?.status ??
    data?.result?.txnStatus;
  if (statusRaw === false || statusRaw === 0) {
    return {
      paid: false,
      failed: true,
      status: 'FALSE',
      message: String(data?.message || 'Payment failed or expired'),
      utr: null,
      raw: data,
    };
  }
  const token = normalizeStatusToken(statusRaw);
  const message = String(
    data?.message || data?.resultInfo || data?.result?.resultInfo || ''
  );
  const utr =
    data?.utr ||
    data?.result?.utr ||
    data?.utr_number ||
    null;

  if (
    token === 'SUCCESS' ||
    token === 'COMPLETED' ||
    token === 'PAID' ||
    token === 'TRUE'
  ) {
    return {
      paid: true,
      failed: false,
      status: token,
      message: message || 'Payment completed successfully',
      utr: utr ? String(utr).trim() : null,
      raw: data,
    };
  }

  if (
    token === 'FAILED' ||
    token === 'FAIL' ||
    token === 'FAILURE' ||
    token === 'EXPIRED' ||
    token === 'CANCELLED' ||
    token === 'CANCELED' ||
    token === 'FALSE'
  ) {
    return {
      paid: false,
      failed: true,
      status: token || 'FAILED',
      message: message || 'Payment failed or expired',
      utr: utr ? String(utr).trim() : null,
      raw: data,
    };
  }

  return {
    paid: false,
    failed: false,
    status: token || 'PENDING',
    message: message || 'Customer has not completed payment yet',
    utr: utr ? String(utr).trim() : null,
    raw: data,
  };
}

/** Realtime IMB check_link (GET every ~2s). */
async function checkLinkStatus(checkLink) {
  if (!checkLink) return null;
  const res = await fetch(String(checkLink), {
    method: 'GET',
    headers: { Accept: 'application/json, text/plain, */*' },
    signal: AbortSignal.timeout(12000),
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    const lower = String(text || '').toLowerCase();
    if (/\bsuccess\b|\bcompleted\b/.test(lower) && !/\bpending\b/.test(lower)) {
      data = { status: 'success', message: 'Payment completed successfully' };
    } else if (/\bfail|\bexpired|\bcancel/.test(lower) && !/\bpending\b/.test(lower)) {
      data = { status: 'failed', message: 'Payment failed or expired' };
    } else {
      data = { status: 'pending', message: 'Customer has not completed payment yet' };
    }
  }
  return parseCheckLinkPayload(data);
}

/**
 * Verify deposit via Check Status API before crediting wallet.
 * Docs: POST https://api.imbpay.in/v2/check-order-status
 */
function normalizeStatusToken(value) {
  if (value === true || value === 1) return 'TRUE';
  if (value === false || value === 0) return '';
  return String(value || '')
    .trim()
    .toUpperCase();
}

async function checkOrderStatus(orderId, { checkLink } = {}) {
  if (config.imb.mock) {
    return {
      paid: true,
      failed: false,
      status: 'COMPLETED',
      amount: null,
      utr: null,
      message: 'mock',
      raw: { mock: true },
    };
  }

  if (checkLink) {
    try {
      const fromLink = await checkLinkStatus(checkLink);
      if (fromLink && (fromLink.paid || fromLink.failed)) {
        return fromLink;
      }
      if (fromLink) return fromLink;
    } catch (err) {
      console.warn(
        `[imb] check_link failed for order ${orderId}:`,
        err.message || err
      );
    }
  }

  const { data } = await postForm(
    `${config.imb.baseUrl}/check-order-status`,
    {
      user_token: config.imb.apiKey,
      order_id: String(orderId),
    }
  );

  const result = data?.result || data?.data || {};
  const top = normalizeStatusToken(data?.status);
  const txn = normalizeStatusToken(
    result.txnStatus || result.txn_status || result.status
  );
  const info = String(result.resultInfo || data?.message || '');
  const utr =
    result.utr != null && String(result.utr).trim() !== ''
      ? String(result.utr).trim()
      : null;

  // Explicit fail tokens only (do not treat boolean false / "Transaction Failed!" while PENDING)
  const failedTokens = new Set([
    'FAILED',
    'FAIL',
    'FAILURE',
    'CANCELLED',
    'CANCELED',
    'EXPIRED',
    'REJECTED',
    'ERROR',
  ]);
  const failed = failedTokens.has(top) || failedTokens.has(txn);

  // Credit ONLY when IMB marks COMPLETED/SUCCESS (docs). UTR alone is not enough while PENDING.
  const successTokens = new Set([
    'COMPLETED',
    'SUCCESS',
    'PAID',
    'TRUE',
  ]);
  const paid =
    !failed && (successTokens.has(top) || successTokens.has(txn));

  if (paid) {
    console.log(`[imb] order ${orderId} SUCCESS utr=${utr || '-'}`);
  }

  return {
    paid,
    failed,
    status: top || txn || 'UNKNOWN',
    message: info || data?.message || null,
    amount: result.amount != null ? Number(result.amount) : null,
    utr,
    raw: data,
  };
}

/**
 * Initiate bank/UPI payout.
 * Docs: POST https://secure.imbpayment.com/api/v1/payout/doTxn
 */
async function createPayout({
  amount,
  clientRef,
  accountNumber,
  ifsc,
  accountName,
  bankName,
  upiId,
  tag,
}) {
  if (config.imb.mock) {
    return {
      mock: true,
      responseCode: 111,
      txnId: `MOCK_PAYOUT_${clientRef}`,
      clientRef,
      status: 'Initiated',
    };
  }

  const token = config.imb.payoutToken || config.imb.apiKey;
  if (!token) {
    const err = new Error('IMB payout token missing');
    err.status = 500;
    err.code = 'IMB_PAYOUT_CONFIG';
    throw err;
  }

  const account = accountNumber || upiId;
  if (!account || !accountName) {
    const err = new Error('Payout needs account/UPI and account name');
    err.status = 400;
    err.code = 'PAYOUT_DETAILS';
    throw err;
  }

  const { data } = await postJson(
    `${config.imb.payoutBaseUrl}/payout/doTxn`,
    {
      sender_name: config.imb.senderName,
      account,
      bank_name: bankName || (upiId && !accountNumber ? 'UPI' : 'BANK'),
      ifsc: ifsc || (upiId && !accountNumber ? 'UPI0000000' : undefined),
      payment_mode: 5, // IMPS
      amount: Number(amount),
      customer_name: accountName,
      refrence: String(clientRef),
      account_type: 1,
      tag: tag || 'SARA567 withdraw',
    },
    { Token: token }
  );

  const code = Number(data?.response_code);
  const inner = data?.data || {};
  if (code === 113 || String(inner.status || '').toLowerCase() === 'fail') {
    const err = new Error(data?.message || 'IMB payout failed');
    err.status = 502;
    err.code = 'IMB_PAYOUT_FAILED';
    err.payload = data;
    throw err;
  }

  return {
    mock: false,
    responseCode: code,
    txnId: inner.txn_id || inner.txnId || null,
    clientRef: data?.RequestId || clientRef,
    status: inner.status || 'Initiated',
    raw: data,
  };
}

async function checkPayoutStatus(clientRef) {
  if (config.imb.mock) {
    return { status: 'Success', paid: true, failed: false, raw: { mock: true } };
  }
  const token = config.imb.payoutToken || config.imb.apiKey;
  const { data } = await postJson(
    `${config.imb.payoutBaseUrl}/payout/CheckStatus`,
    { refrence: String(clientRef) },
    { Token: token }
  );
  const inner = data?.data || data || {};
  const st = String(inner.status || data?.status || '').toLowerCase();
  return {
    status: inner.status || data?.status,
    paid: st === 'success',
    failed: st === 'fail' || st === 'failed' || st === 'reversed',
    raw: data,
  };
}

/** @deprecated kept for optional header checks; IMB PG webhooks often unsigned */
function verifyWebhookSignature(_rawBody, _signatureHeader) {
  return true;
}

module.exports = {
  createPayment,
  checkOrderStatus,
  checkLinkStatus,
  createPayout,
  checkPayoutStatus,
  verifyWebhookSignature,
};
