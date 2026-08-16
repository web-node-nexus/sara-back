const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const { config } = require('./config/env');
const { createApp } = require('./app');
const { startScrapeJob } = require('./jobs/scrapeMarkets');
const { startStarlineJob } = require('./jobs/starlineResults');
const { startDepositReconcileJob } = require('./jobs/reconcileDeposits');

const app = createApp();
app.listen(config.port, () => {
  console.log(
    `SARA567 API listening on :${config.port} (timeout ${config.apiTimeoutMs}ms)`
  );
  startScrapeJob();
  startStarlineJob();
  startDepositReconcileJob();
});
