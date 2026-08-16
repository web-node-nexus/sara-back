const { query } = require('../config/db');
const cache = require('../config/redis');

const CACHE_KEY = 'calculator:gate:v1';

const DEFAULTS = {
  gateEnabled: false,
  triggerValue: 16,
  unlockAction: 'app',
  allowAdd: true,
  allowSub: true,
  allowMul: false,
  allowDiv: false,
  maxAttempts: 0,
  lockMinutes: 5,
  showOnResume: true,
  superadminOnly: false,
  visualTheme: 'neon',
  displayMode: 'fullscreen',
};

function mapRow(row) {
  if (!row) return { ...DEFAULTS };
  return {
    gateEnabled: !!row.gate_enabled,
    triggerValue: Number(row.trigger_value),
    unlockAction: row.unlock_action || 'app',
    allowAdd: !!row.allow_add,
    allowSub: !!row.allow_sub,
    allowMul: !!row.allow_mul,
    allowDiv: !!row.allow_div,
    maxAttempts: Number(row.max_attempts || 0),
    lockMinutes: Number(row.lock_minutes || 5),
    showOnResume: !!row.show_on_resume,
    superadminOnly: !!row.superadmin_only,
    visualTheme: row.visual_theme || 'neon',
    displayMode: row.display_mode || 'fullscreen',
  };
}

async function bustCache() {
  await cache.del(CACHE_KEY);
}

async function getCalculatorGateSettings() {
  const cached = await cache.get(CACHE_KEY);
  if (cached) return cached;

  const rows = await query(
    `SELECT gate_enabled, trigger_value, unlock_action,
            allow_add, allow_sub, allow_mul, allow_div,
            max_attempts, lock_minutes, show_on_resume, superadmin_only,
            visual_theme, display_mode
     FROM calculator_gate_settings WHERE id = 1 LIMIT 1`
  );
  const settings = mapRow(rows[0]);
  await cache.set(CACHE_KEY, settings, 120);
  return settings;
}

async function updateCalculatorGateSettings(fields) {
  const sets = [];
  const params = {};

  if (fields.gateEnabled !== undefined) {
    sets.push('gate_enabled = :gateEnabled');
    params.gateEnabled = fields.gateEnabled ? 1 : 0;
  }
  if (fields.triggerValue !== undefined) {
    sets.push('trigger_value = :triggerValue');
    params.triggerValue = Number(fields.triggerValue);
  }
  if (fields.unlockAction !== undefined) {
    sets.push('unlock_action = :unlockAction');
    params.unlockAction = String(fields.unlockAction).slice(0, 32);
  }
  if (fields.allowAdd !== undefined) {
    sets.push('allow_add = :allowAdd');
    params.allowAdd = fields.allowAdd ? 1 : 0;
  }
  if (fields.allowSub !== undefined) {
    sets.push('allow_sub = :allowSub');
    params.allowSub = fields.allowSub ? 1 : 0;
  }
  if (fields.allowMul !== undefined) {
    sets.push('allow_mul = :allowMul');
    params.allowMul = fields.allowMul ? 1 : 0;
  }
  if (fields.allowDiv !== undefined) {
    sets.push('allow_div = :allowDiv');
    params.allowDiv = fields.allowDiv ? 1 : 0;
  }
  if (fields.maxAttempts !== undefined) {
    sets.push('max_attempts = :maxAttempts');
    params.maxAttempts = Math.max(0, Math.min(999, Number(fields.maxAttempts)));
  }
  if (fields.lockMinutes !== undefined) {
    sets.push('lock_minutes = :lockMinutes');
    params.lockMinutes = Math.max(1, Math.min(120, Number(fields.lockMinutes)));
  }
  if (fields.showOnResume !== undefined) {
    sets.push('show_on_resume = :showOnResume');
    params.showOnResume = fields.showOnResume ? 1 : 0;
  }
  if (fields.superadminOnly !== undefined) {
    sets.push('superadmin_only = :superadminOnly');
    params.superadminOnly = fields.superadminOnly ? 1 : 0;
  }
  if (fields.visualTheme !== undefined) {
    sets.push('visual_theme = :visualTheme');
    params.visualTheme = String(fields.visualTheme).slice(0, 32);
  }
  if (fields.displayMode !== undefined) {
    sets.push('display_mode = :displayMode');
    params.displayMode = String(fields.displayMode).slice(0, 32);
  }

  if (!sets.length) return getCalculatorGateSettings();

  await query(
    `UPDATE calculator_gate_settings SET ${sets.join(', ')} WHERE id = 1`,
    params
  );
  await bustCache();
  return getCalculatorGateSettings();
}

/** Public config for player app (includes trigger — soft lock only) */
function publicConfig(settings) {
  return {
    enabled: settings.gateEnabled,
    triggerValue: settings.triggerValue,
    unlockAction: settings.unlockAction,
    allowAdd: settings.allowAdd,
    allowSub: settings.allowSub,
    allowMul: settings.allowMul,
    allowDiv: settings.allowDiv,
    maxAttempts: settings.maxAttempts,
    lockMinutes: settings.lockMinutes,
    showOnResume: settings.showOnResume,
    superadminOnly: settings.superadminOnly,
    visualTheme: settings.visualTheme,
    displayMode: settings.displayMode,
  };
}

async function logAttempt({ userId, deviceHint, success, displayValue }) {
  await query(
    `INSERT INTO calculator_gate_logs
      (user_id, device_hint, success, display_value)
     VALUES (:userId, :deviceHint, :success, :displayValue)`,
    {
      userId: userId || null,
      deviceHint: deviceHint ? String(deviceHint).slice(0, 120) : null,
      success: success ? 1 : 0,
      displayValue:
        displayValue != null ? String(displayValue).slice(0, 64) : null,
    }
  );
}

module.exports = {
  getCalculatorGateSettings,
  updateCalculatorGateSettings,
  publicConfig,
  logAttempt,
};
