(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.TonRounds = api;
})(globalThis, function () {
  "use strict";
  const names = new Map([
      [1, "クラシック"],
      [2, "霧"],
      [3, "パニッシュ"],
      [4, "サボタージュ"],
      [5, "狂気"],
      [6, "ブラッドバス"],
      [7, "ダブルトラブル"],
      [8, "EX"],
      [9, "ゴースト"],
      [10, "アンバウンド"],
      [11, "ランダマイザー"],
      [12, "クラシック.exe"],
      [50, "ミッドナイト"],
      [51, "オルタネイト"],
      [52, "霧オルタネイト"],
      [53, "ゴーストオルタネイト"],
      [100, "ミスティックムーン"],
      [101, "ブラッドムーン"],
      [102, "トワイライトムーン"],
      [103, "ソルスティス"],
      [104, "走れ！"],
      [105, "8ページ"],
      [106, "GIGABYTE"],
      [107, "Rift Monsters"]
    ]);
  const aliases = new Map([
  ["classic", 1],
  ["クラシック", 1],
  ["fog", 2],
  ["霧", 2],
  ["punish", 3],
  ["punished", 3],
  ["パニッシュ", 3],
  ["sabotage", 4],
  ["サボタージュ", 4],
  ["insanity", 5],
  ["cracked", 5],
  ["狂気", 5],
  ["bloodbath", 6],
  ["ブラッドバス", 6],
  ["double trouble", 7],
  ["lvl2", 7],
  ["ダブルトラブル", 7],
  ["lvl 2", 7],
  ["ex", 8],
  ["ex.", 8],
  ["ghost", 9],
  ["ゴースト", 9],
  ["unbound", 10],
  ["アンバウンド", 10],
  ["randomizer", 11],
  ["ランダマイザー", 11],
  ["classic.exe", 12],
  ["クラシック.exe", 12],
  ["midnight", 50],
  ["ミッドナイト", 50],
  ["alternate", 51],
  ["オルタネイト", 51],
  ["fog alternate", 52],
  ["霧オルタネイト", 52],
  ["ghost alternate", 53],
  ["ゴーストオルタネイト", 53],
  ["mystic moon", 100],
  ["ミスティックムーン", 100],
  ["blood moon", 101],
  ["ブラッドムーン", 101],
  ["twilight moon", 102],
  ["トワイライトムーン", 102],
  ["solstice", 103],
  ["ソルスティス", 103],
  ["run", 104],
  ["run!", 104],
  ["走れ！", 104],
  ["8 pages", 105],
  ["8pages", 105],
  ["８ページ", 105],
  ["gigabyte", 106],
  ["ギガバイト", 106],
  ["rift monsters", 107]
]);
  for (const [id, name] of names) aliases.set(normalize(name), id);
  for (const [label, id] of [["fog (alternate)",52],["ghost (alternate)",53],["霧 (alternate)",52],["ゴースト (alternate)",53],["twilight",102],["トワイライト",102]]) aliases.set(label,id);
  const specialNames = new Map([
    ['hungry home invader', 'Hungry Home Invader'],
    ['atrached', 'Atrached'],
    ['wild yet bloodthirsty creature', 'Wild Yet Bloodthirsty Creature']
  ]);

  function numberOrNull(input) {
    if (input === null || input === undefined || typeof input === 'boolean' || String(input).trim() === '') return null;
    const number = Number(input);
    return Number.isFinite(number) ? number : null;
  }

  function normalize(input) {
    return String(input ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  }

  function typeId(label) {
    const key = normalize(label);
    return aliases.get(key) ?? numberOrNull(key);
  }

  function expectedCount(type) {
    if (type === 8) return 1;
    if (type === 6 || type === 50) return 3;
    return null;
  }

  function resolve(record = {}) {
    const label = String(record.roundTypeLabel ?? record.roundTypeExtra ?? '').trim();
    const rawType = numberOrNull(record.rawRoundType ?? record.roundType);
    const labelType = aliases.get(normalize(label)) ?? (record.roundTypeLabel !== undefined ? numberOrNull(label) : null);
    let roundType = labelType ?? rawType;
    const data = Array.isArray(record.terrorData) ? record.terrorData : [];
    const ids = data.map(item => numberOrNull(item && item.i)).filter(id => id !== null);
    const slots = record.terrorDataSource === 'log-slots';
    const count = slots ? null : (numberOrNull(record.terrorCount) ?? (ids.length || null));
    // Legacy save RT=6 with one TD entry represents EX; a live slot list is not a count.
    if (!record.roundPhase && labelType === null && roundType === 6 && count === 1) roundType = 8;
    const name = String(record.note ?? '').trim();
    const specialName = String(record.specialRoundName ?? '').trim() || specialNames.get(normalize(name)) || '';
    const phase = record.roundPhase || 'recorded';
    let composition = ids.length ? `TerrorID ${ids.join(' / ')}` : 'テラー情報待ち';
    if (slots && ids.length) composition += `（${ids.length}枠・出現数未確定）`;
    else if (roundType === 50 && ids.length) {
      const alternate = data.filter(item => item && item.g !== undefined && item.g !== null).length;
      composition += `（クラシック${ids.length - alternate}体 / オルタネイト${alternate}体）`;
    } else if (count !== null) composition += `（${count}体）`;
    return {
      roundType, rawRoundType: rawType,
      roundTypeName: names.get(roundType) || label || (roundType === null ? '判定待ち' : `種別 ${roundType}`),
      specialName, terrorName: name, terrorIds: ids, terrorCount: count, composition,
      expectedTerrorCount: slots ? null : expectedCount(roundType),
      phase, phaseName: ({waiting: '待機中', active: '進行中', ended: '終了', recorded: '記録済み'})[phase] || '判定待ち',
      evidence: labelType !== null ? 'ログのラウンド種別' : rawType !== null ? 'RoundType' : '種別情報待ち'
    };
  }

  function parseLogLine(input) {
    const text = String(input || '').trim().replace(/^\d{4}\.\d{2}\.\d{2}\s+\d{2}:\d{2}:\d{2}\s+[A-Za-z]+\s+-\s*/, '');
    let match = text.match(/^This round is taking place at (.+?) \((\d+)\) and the round type is (.+)$/i);
    if (match) return {start: true, mapName: match[1].trim(), mapId: Number(match[2]), roundType: typeId(match[3]), roundTypeLabel: match[3].trim(), roundPhase: 'active'};
    match = text.match(/^Killers have been set\s*-?\s*([0-9 ]+)\s*\/\/\s*Round type is (.+)$/i);
    if (match) return {
      terrorData: match[1].trim().split(/\s+/).map(i => ({i: Number(i)})),
      terrorDataSource: 'log-slots', terrorCount: null,
      roundType: typeId(match[2]), roundTypeLabel: match[2].trim(), roundPhase: 'active'
    };
    if (/^(?:RoundOver|Round was valid\.|Verified Round End)$/i.test(text)) return {finalize: true, roundPhase: 'ended'};
    if (/^Round Won[.!]?$/i.test(text)) return {result: 1, finalize: true, roundPhase: 'ended'};
    if (/^Lived in round\.$/i.test(text)) return {result: 1};
    if (/^(?:Died in round\.|You Died iN the Round|Player lost, not killer)$/i.test(text)) return {result: 0};
    match = text.match(/^(?:Terror Name|Note|Name)\s*[:=]\s*(.+)$/i);
    if (match) return {note: match[1].trim()};
    match = text.match(/^(?:Special Round Name|Special Round|Round Name)\s*[:=]\s*(.+)$/i);
    if (match) return {specialRoundName: match[1].trim()};
    match = text.match(/^(?:RoundType|Round Type|RT)\s*[:=]\s*(.+)$/i);
    if (match) return {roundType: typeId(match[1]), roundTypeLabel: match[1].trim()};
    return null;
  }

  return Object.freeze({resolve, parseLogLine, numberOrNull, typeId, expectedCount});
});
