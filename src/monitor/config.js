import { readConfig } from '../config.js';

const MIN_BY_KEY = {
  longCommandSec: 0, silenceSec: 0, failuresAlertAt: 1, historyMax: 0, targetMaxChars: 0,
};

function isBelowMin(config, key) {
  return !(Number.isFinite(config?.[key]) && config[key] >= MIN_BY_KEY[key]);
}

export function validateMonitorConfig(config) {
  const errors = Object.keys(MIN_BY_KEY)
    .filter((key) => isBelowMin(config, key))
    .map((key) => `« ${key} » doit être un nombre >= ${MIN_BY_KEY[key]} (reçu ${JSON.stringify(config?.[key])})`);
  if (typeof config?.eventsDir !== 'string' || !config.eventsDir) {
    errors.push('« eventsDir » doit être un chemin non vide');
  }
  if (errors.length) throw new Error(`config/monitor.json invalide : ${errors.join(' ; ')}`);
  return config;
}

export function loadMonitorConfig() {
  return validateMonitorConfig(readConfig('monitor'));
}
