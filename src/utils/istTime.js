/** India Standard Time helpers for market / starline clocks. */

function istParts(date = new Date()) {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = Object.fromEntries(
    fmt
      .formatToParts(date)
      .filter((p) => p.type !== 'literal')
      .map((p) => [p.type, p.value])
  );
  const hour = Number(parts.hour) % 24;
  const minute = Number(parts.minute);
  return {
    today: `${parts.year}-${parts.month}-${parts.day}`,
    minutes: hour * 60 + minute,
  };
}

function todayStrIST(date = new Date()) {
  return istParts(date).today;
}

function nowMinutesIST(date = new Date()) {
  return istParts(date).minutes;
}

module.exports = { istParts, todayStrIST, nowMinutesIST };
