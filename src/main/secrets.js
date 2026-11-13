const { safeStorage } = require('electron');

const PREFIX = 'enc:';

function available() {
  try {
    return safeStorage.isEncryptionAvailable();
  } catch {
    return false;
  }
}

function protect(value) {
  if (typeof value !== 'string' || !value || value.startsWith(PREFIX)) return value;
  if (!available()) return value;
  try {
    return PREFIX + safeStorage.encryptString(value).toString('base64');
  } catch {
    return value;
  }
}

function reveal(value) {
  if (typeof value !== 'string' || !value.startsWith(PREFIX)) return value;
  try {
    return safeStorage.decryptString(Buffer.from(value.slice(PREFIX.length), 'base64'));
  } catch {
    return '';
  }
}

const ACCOUNT_FIELDS = ['accessToken', 'clientToken', 'refreshToken'];
const SETTINGS_FIELDS = ['firebaseApiKey', 'curseforgeKey', 'firebaseIdToken', 'firebaseRefreshToken'];

function isProtected(value) {
  return typeof value === 'string' && value.startsWith(PREFIX);
}

function needsProtection(source, fields) {
  return fields.some((field) => typeof source[field] === 'string' && source[field] && !isProtected(source[field]));
}

function mapFields(source, fields, fn) {
  const result = { ...source };
  for (const field of fields) if (typeof result[field] === 'string') result[field] = fn(result[field]);
  return result;
}

function protectAccount(account) {
  return mapFields(account, ACCOUNT_FIELDS, protect);
}

function revealAccount(account) {
  return mapFields(account, ACCOUNT_FIELDS, reveal);
}

function protectSettings(settings) {
  return mapFields(settings, SETTINGS_FIELDS, protect);
}

function revealSettings(settings) {
  return mapFields(settings, SETTINGS_FIELDS, reveal);
}

function migrateAccounts(data) {
  let changed = false;
  const list = (data.list || []).map((account) => {
    const next = protectAccount(account);
    for (const field of ACCOUNT_FIELDS) {
      if (typeof account[field] === 'string' && account[field] && next[field] !== account[field]) changed = true;
    }
    return next;
  });
  return { data: { ...data, list }, changed };
}

module.exports = {
  available,
  protect,
  reveal,
  isProtected,
  needsProtection,
  protectAccount,
  revealAccount,
  protectSettings,
  revealSettings,
  migrateAccounts,
  ACCOUNT_FIELDS,
  SETTINGS_FIELDS,
};
