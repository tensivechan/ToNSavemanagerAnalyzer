(function(root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./round-classifier.js"));
  else root.TonConstructGigabyteStats = factory(root.TonRounds);
})(globalThis, function(rounds) {
  const CONSTRUCT_MAP_ID = 2;
  const CLASSIC_ROUND_TYPE = 1;
  const GIGABYTE_ROUND_TYPE = 106;
  const GIGABYTE_GROUP = 6;
  const GIGABYTE_TERROR_ID = 1;

  function number(value) {
    return rounds.numberOrNull(value);
  }

  function roundType(record) {
    return rounds.resolve(record || {}).roundType;
  }

  function isGigabyteTerror(record) {
    const itemMatch = Array.isArray(record && record.terrorData) && record.terrorData.some(item =>
      number(item && item.g) === GIGABYTE_GROUP && number(item && item.i) === GIGABYTE_TERROR_ID
    );
    return itemMatch || roundType(record) === GIGABYTE_ROUND_TYPE || number(record && record.rawRoundType) === GIGABYTE_ROUND_TYPE;
  }

  function isConstructClassicOpportunity(record) {
    if (number(record && record.mapId) !== CONSTRUCT_MAP_ID) return false;
    // GIGABYTE can be recorded as its own RT106 round after the Construct roll.
    return roundType(record) === CLASSIC_ROUND_TYPE || isGigabyteTerror(record);
  }

  function instanceKey(record) {
    const explicit = String(record && record.instanceKey || "").trim();
    if (explicit) return explicit;
    const sourceIndex = number(record && record.sourceFileIndex);
    return sourceIndex === null ? "instance:unknown" : `source:${sourceIndex}`;
  }

  function instanceLabel(record, key) {
    const sourceFile = String(record && record.sourceFile || "").trim();
    return sourceFile || key;
  }

  function percentage(hits, opportunities) {
    return opportunities > 0 ? hits / opportunities * 100 : null;
  }

  function summarize(records) {
    const grouped = new Map();
    for (const record of Array.isArray(records) ? records : []) {
      if (!isConstructClassicOpportunity(record)) continue;
      const key = instanceKey(record);
      if (!grouped.has(key)) {
        grouped.set(key, { key, label: instanceLabel(record, key), opportunities: 0, gigabyte: 0 });
      }
      const result = grouped.get(key);
      result.opportunities += 1;
      if (isGigabyteTerror(record)) result.gigabyte += 1;
    }
    const instances = [...grouped.values()].map(item => ({ ...item, percentage: percentage(item.gigabyte, item.opportunities) }));
    const opportunities = instances.reduce((total, item) => total + item.opportunities, 0);
    const gigabyte = instances.reduce((total, item) => total + item.gigabyte, 0);
    return Object.freeze({
      opportunities,
      gigabyte,
      percentage: percentage(gigabyte, opportunities),
      instances: Object.freeze(instances)
    });
  }

  return Object.freeze({
    CONSTRUCT_MAP_ID,
    CLASSIC_ROUND_TYPE,
    GIGABYTE_ROUND_TYPE,
    GIGABYTE_GROUP,
    GIGABYTE_TERROR_ID,
    isGigabyteTerror,
    isConstructClassicOpportunity,
    summarize
  });
});
