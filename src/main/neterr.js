'use strict';

const CODES = new Set([
  'ENOTFOUND',
  'EAI_AGAIN',
  'ETIMEDOUT',
  'ECONNREFUSED',
  'ECONNRESET',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'EPIPE',
  'CF_NETWORK',
]);

function isNetworkError(error) {
  if (!error) return false;
  if (CODES.has(error.code)) return true;
  const message = String(error.message || error);
  return /fetch failed|network|socket hang up|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|timeout|Нет связи|сеть недоступна/i.test(message);
}

module.exports = { isNetworkError, CODES };
