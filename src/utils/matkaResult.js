/**
 * Parse / merge matka Open + Close result strings.
 * Typical forms: 123-4  |  123-45-678  |  123-4-5-678
 */

function isPlaceholder(result) {
  const r = String(result || '').trim();
  if (!r) return true;
  if (/loading/i.test(r)) return true;
  if (/^[\*\-\s\/]+$/.test(r)) return true;
  return false;
}

function tokens(result) {
  return String(result || '')
    .split(/[-–/]/)
    .map((p) => p.replace(/[*\s]/g, '').trim())
    .filter(Boolean);
}

function parseMatkaResult(result) {
  const raw = String(result || '').trim();
  const empty = {
    openPana: '',
    openDigit: '',
    closeDigit: '',
    closePana: '',
    openText: '',
    closeText: '',
    hasOpen: false,
    hasClose: false,
    raw,
  };
  if (isPlaceholder(raw) || !/\d/.test(raw)) return empty;

  const parts = tokens(raw);

  if (
    parts.length >= 3 &&
    /^\d{3}$/.test(parts[0]) &&
    /^\d{2}$/.test(parts[1]) &&
    /^\d{3}$/.test(parts[2])
  ) {
    return {
      ...empty,
      openPana: parts[0],
      openDigit: parts[1][0],
      closeDigit: parts[1][1],
      closePana: parts[2],
      openText: `${parts[0]}-${parts[1][0]}`,
      closeText: `${parts[2]}-${parts[1][1]}`,
      hasOpen: true,
      hasClose: true,
      raw,
    };
  }

  if (
    parts.length >= 4 &&
    /^\d{3}$/.test(parts[0]) &&
    /^\d$/.test(parts[1]) &&
    /^\d$/.test(parts[2]) &&
    /^\d{3}$/.test(parts[3])
  ) {
    return {
      ...empty,
      openPana: parts[0],
      openDigit: parts[1],
      closeDigit: parts[2],
      closePana: parts[3],
      openText: `${parts[0]}-${parts[1]}`,
      closeText: `${parts[3]}-${parts[2]}`,
      hasOpen: true,
      hasClose: true,
      raw,
    };
  }

  if (parts.length >= 2 && /^\d{3}$/.test(parts[0]) && /^\d{1,2}$/.test(parts[1])) {
    const hasCloseDigit = parts[1].length >= 2;
    return {
      ...empty,
      openPana: parts[0],
      openDigit: parts[1][0],
      closeDigit: hasCloseDigit ? parts[1][1] : '',
      closePana: '',
      openText: `${parts[0]}-${parts[1][0]}`,
      closeText: '',
      hasOpen: true,
      hasClose: hasCloseDigit,
      raw,
    };
  }

  return {
    ...empty,
    openText: raw,
    hasOpen: true,
    hasClose: false,
    raw,
  };
}

function formatOpenResult(input) {
  const p = parseMatkaResult(input);
  if (p.openPana && p.openDigit) return `${p.openPana}-${p.openDigit}`;
  return String(input || '').trim();
}

function formatCloseInput(input) {
  const p = parseMatkaResult(input);
  if (p.openPana && p.openDigit && !p.hasClose) {
    return { closePana: p.openPana, closeDigit: p.openDigit };
  }
  if (p.closePana && p.closeDigit) {
    return { closePana: p.closePana, closeDigit: p.closeDigit };
  }
  const raw = String(input || '').trim();
  if (/^\d{3}$/.test(raw)) return { closePana: raw, closeDigit: '' };
  if (/^\d$/.test(raw)) return { closePana: '', closeDigit: raw };
  return { closePana: p.closePana || p.openPana || '', closeDigit: p.closeDigit || p.openDigit || '' };
}

function mergeOpenClose(existingResult, session, incoming) {
  const current = parseMatkaResult(existingResult);
  const next = String(incoming || '').trim();
  if (!next) {
    const err = new Error('Enter a result');
    err.status = 400;
    err.code = 'INVALID_RESULT';
    throw err;
  }

  if (session === 'close') {
    if (!current.hasOpen) {
      const err = new Error('Pehle Open Result add karein');
      err.status = 400;
      err.code = 'OPEN_REQUIRED';
      throw err;
    }
    const c = formatCloseInput(next);
    const openPana = current.openPana;
    const openDigit = current.openDigit;
    if (openPana && openDigit && c.closePana && c.closeDigit) {
      return `${openPana}-${openDigit}${c.closeDigit}-${c.closePana}`;
    }
    const openStr = current.openText || formatOpenResult(existingResult);
    return `${openStr} / ${next}`;
  }

  if (session === 'open') {
    const openStr = formatOpenResult(next);
    if (current.hasClose && current.closePana && current.closeDigit) {
      const o = parseMatkaResult(openStr);
      if (o.openPana && o.openDigit) {
        return `${o.openPana}-${o.openDigit}${current.closeDigit}-${current.closePana}`;
      }
    }
    return openStr;
  }

  return next;
}

module.exports = {
  parseMatkaResult,
  formatOpenResult,
  mergeOpenClose,
  isPlaceholder,
};
