// Day and hour of an ISO instant in the configured time zone.
export function zoner(timeZone) {
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" });
  const cache = new Map();
  return (iso) => {
    const key = iso.slice(0, 16);
    let hit = cache.get(key);
    if (!hit) {
      const p = Object.fromEntries(fmt.formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
      hit = { day: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) };
      cache.set(key, hit);
    }
    return hit;
  };
}
