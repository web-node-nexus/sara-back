/** Assignable admin sidebar screens (matches Add Users UI). */
const ADMIN_SCREENS = [
  { key: 'dashboard', label: 'Dashboard', icon: 'home-outline' },
  { key: 'users', label: 'User List', icon: 'people-outline' },
  { key: 'inactive', label: 'Inactive Users', icon: 'person-remove-outline' },
  { key: 'playerAdd', label: 'Player Add/Details', icon: 'person-add-outline' },
  { key: 'markets', label: 'Add New Game', icon: 'add-circle-outline' },
  { key: 'gameCancel', label: 'Game Cancel', icon: 'close-circle-outline' },
  { key: 'profit', label: 'Profit Loss', icon: 'trending-up-outline' },
  { key: 'resultReport', label: 'Result & Report', icon: 'bar-chart-outline' },
  { key: 'resultDummy', label: 'Result Dummy', icon: 'copy-outline' },
  { key: 'reportGeneration', label: 'Report Generation', icon: 'document-text-outline' },
  { key: 'profitStarline', label: 'Profit Loss Starline', icon: 'trending-up-outline' },
  { key: 'winStarline', label: 'Win History Starline', icon: 'time-outline' },
  { key: 'reportStarline', label: 'Report Gen. Starline', icon: 'document-text-outline' },
  { key: 'tx', label: 'Transaction', icon: 'swap-horizontal-outline' },
  { key: 'userBidUpdate', label: 'User Bid Update', icon: 'reload-outline' },
  { key: 'win', label: 'Win History', icon: 'time-outline' },
  { key: 'deposit', label: 'Deposit Users', icon: 'wallet-outline' },
  { key: 'withdraw', label: 'Withdrawal Users', icon: 'cash-outline' },
  { key: 'totalUsers', label: 'Total Users', icon: 'people-outline' },
  { key: 'settings', label: 'Setting', icon: 'settings-outline' },
  { key: 'createUser', label: 'Add Users', icon: 'grid-outline' },
];

const ADMIN_SCREEN_KEYS = ADMIN_SCREENS.map((s) => s.key);

function normalizeScreens(list) {
  const set = new Set();
  for (const raw of list || []) {
    const key = String(raw || '').trim();
    if (ADMIN_SCREEN_KEYS.includes(key)) set.add(key);
  }
  return [...set];
}

module.exports = { ADMIN_SCREENS, ADMIN_SCREEN_KEYS, normalizeScreens };
