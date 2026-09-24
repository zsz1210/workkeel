function formatInteger(value) {
  return value.toLocaleString('en-US', { useGrouping: true, maximumFractionDigits: 0 });
}

export function formatCount(metric) {
  if (metric == null) return 'Unknown';
  if (metric.complete === true && Number.isSafeInteger(metric.total) && metric.total >= 0) {
    return formatInteger(metric.total);
  }
  if (Number.isSafeInteger(metric.known_subtotal) && metric.known_subtotal >= 0) {
    return `>= ${formatInteger(metric.known_subtotal)} (partial)`;
  }
  return 'Unknown';
}

function isValidCost(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value < 1e12;
}

function formatDollar(value) {
  return `$${value.toFixed(4)}`;
}

export function formatCost(metric) {
  if (metric == null) return 'Unknown';
  if (metric.complete === true && isValidCost(metric.total)) return formatDollar(metric.total);
  if (isValidCost(metric.known_subtotal)) return `>= ${formatDollar(metric.known_subtotal)} (partial)`;
  return 'Unknown';
}

export function formatDuration(ms) {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0 || ms > Number.MAX_SAFE_INTEGER) {
    return 'Unknown';
  }
  if (ms < 60000) return `${(ms / 1000).toFixed(1)} s`;
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.floor((ms - minutes * 60000) / 1000);
  return `${minutes} min ${seconds} s`;
}
