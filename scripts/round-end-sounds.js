(function(root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./round-classifier.js"));
  else root.TonRoundEndSounds = factory(root.TonRounds);
})(globalThis, function(rounds) {
  function soundKey(record) {
    const type = rounds.resolve(record || {}).roundType;
    if (type === 3) return "punished";
    if (type === 105) return "eightPages";
    return "";
  }

  function fingerprint(record) {
    const timestamp = String(record && record.timestamp || "").trim();
    const key = String(record && record.recordKey || "").trim();
    return timestamp ? `${timestamp}|${key}` : key;
  }

  function shouldSyncSilently(hadSnapshot, update = {}) {
    return !hadSnapshot || Boolean(update && (update.initialRead || update.reset));
  }

  function normalizeVolume(value, fallback = 1) {
    const number = Number(value);
    const safeFallback = Number.isFinite(Number(fallback)) ? Number(fallback) : 1;
    return Math.min(1, Math.max(0, Number.isFinite(number) ? number : safeFallback));
  }

  function createDetector(onRoundEnd) {
    const seen = new Set();
    return Object.freeze({
      sync(records, options = {}) {
        const triggered = [];
        for (const record of Array.isArray(records) ? records : []) {
          if (!record || record.roundPhase === "active" || record.roundPhase === "waiting") continue;
          const id = fingerprint(record);
          if (!id || seen.has(id)) continue;
          seen.add(id);
          const key = soundKey(record);
          if (!key || options.silent) continue;
          triggered.push(key);
          if (typeof onRoundEnd === "function") onRoundEnd(key, record);
        }
        return triggered;
      }
    });
  }

  return Object.freeze({soundKey, fingerprint, shouldSyncSilently, normalizeVolume, createDetector});
});
