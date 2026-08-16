/**
 * IST calendar helpers for scrape daily rows + admin reports.
 */

function istDateString(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

/** Inclusive IST day → UTC Date bounds [start, end) */
function istDayBounds(dateStr) {
  const day = String(dateStr || istDateString()).slice(0, 10);
  const start = new Date(`${day}T00:00:00+05:30`);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { day, start, end };
}

function toMysqlDatetime(d) {
  return d.toISOString().replace('T', ' ').substring(0, 19);
}

module.exports = { istDateString, istDayBounds, toMysqlDatetime };
