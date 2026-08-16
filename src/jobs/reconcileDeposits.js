const { query } = require('../config/db');
const { tryCreditIfImbPaid } = require('../modules/wallet/service');
const { config } = require('../config/env');

const INTERVAL_MS = 15_000;
const LOOKBACK_HOURS = 48;
const BATCH = 40;

/**
 * Fallback when IMB webhook cannot reach this server (localhost / LAN).
 * Polls pending deposits; credits wallet ONLY when IMB status is Success.
 */
async function reconcilePendingDepositsOnce() {
  if (config.imb.mock) return { skipped: true, reason: 'mock' };

  const rows = await query(
    `SELECT id FROM payment_orders
     WHERE status = 'pending'
       AND created_at >= DATE_SUB(NOW(), INTERVAL ${LOOKBACK_HOURS} HOUR)
     ORDER BY id ASC
     LIMIT ${BATCH}`
  );

  let credited = 0;
  let failed = 0;
  let pending = 0;

  for (const row of rows) {
    try {
      const out = await tryCreditIfImbPaid(row.id);
      if (out.paid) {
        if (out.credited) {
          credited += 1;
          console.log(
            `[deposit-reconcile] credited order ${row.id} amount=${out.amount}`
          );
        }
      } else if (out.failed) {
        await query(
          `UPDATE payment_orders SET status = 'failed' WHERE id = :id AND status = 'pending'`,
          { id: row.id }
        );
        failed += 1;
      } else {
        pending += 1;
      }
    } catch (err) {
      console.error(
        `[deposit-reconcile] order ${row.id}:`,
        err.message || err
      );
    }
  }

  return { checked: rows.length, credited, failed, pending };
}

function startDepositReconcileJob() {
  const tick = () => {
    void reconcilePendingDepositsOnce().catch((err) =>
      console.error('[deposit-reconcile] job error:', err.message)
    );
  };
  tick();
  setInterval(tick, INTERVAL_MS);
  console.log(
    `[deposit-reconcile] polling pending deposits every ${INTERVAL_MS / 1000}s (Success → wallet credit)`
  );
}

module.exports = {
  startDepositReconcileJob,
  reconcilePendingDepositsOnce,
};
