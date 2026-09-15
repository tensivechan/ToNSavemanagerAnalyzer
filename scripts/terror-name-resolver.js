// Round/group interpretation follows ToNSaveManager's TerrorMatrix (MIT).
// https://github.com/ChrisFeline/ToNSaveManager/blob/main/Models/Index/TerrorMatrix.cs
(function(root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./terror-name-data.js"), require("./round-classifier.js"));
  else root.TonTerrorNameResolver = factory(root.TonTerrorNames, root.TonRounds);
})(globalThis, function(data, rounds) {
  const variantKeys = {1:"Classic",2:"Fog",3:"Punished",4:"Sabotage",5:"Cracked",6:"Bloodbath",7:"Double_Trouble",8:"EX",9:"Ghost",10:"Unbound",11:"Randomizer",12:"Classic_exe",50:"Midnight",51:"Alternate",52:"Fog_Alternate",53:"Ghost_Alternate",100:"Mystic_Moon",101:"Blood_Moon",102:"Twilight",103:"Solstice",104:"RUN",105:"Eight_Pages",106:"GIGABYTE",107:"Cold_Night"};

  function entryName(item, group, type, level = 1) {
    const id = rounds.numberOrNull(item && item.i);
    if (id === null) return "テラー名未取得";
    let entry = data.groups[group]?.[id];
    if (!entry && group === 2) {
      const redirect = data.redirects[id];
      if (redirect) entry = data.groups[redirect[0]]?.[redirect[1]];
    }
    if (!entry) return "テラー名未取得";
    const encounter = rounds.numberOrNull(item.e);
    const phase = rounds.numberOrNull(item.p);
    const name = entry.variants?.[variantKeys[type]] ||
      (encounter !== null && encounter >= 0 ? entry.encounters?.[encounter] : "") ||
      (phase !== null && phase > 0 ? entry.phases?.[phase - 1] : "") || entry.name;
    return level > 1 ? `${name} (LVL ${level})` : name;
  }

  function resolve(record = {}) {
    const identity = rounds.resolve(record);
    const type = identity.roundType;
    const td = Array.isArray(record.terrorData) ? record.terrorData : [];
    const slots = record.terrorDataSource === "log-slots";
    if (!slots) {
      return td.map(item => entryName(item, rounds.numberOrNull(item?.g) ?? 0, type, rounds.numberOrNull(item?.l) ?? 1)).join(" & ");
    }
    if (!td.length) return "";
    if ([1,2,3,4,5,9,11,12].includes(type)) return entryName(td[0], 0, type);
    if ([51,52,53].includes(type)) return entryName(td[0], 1, type);
    if (type === 10) return entryName(td[0], 3, type);
    if (type >= 100 && type <= 103) return entryName({i:type-100}, 4, type);
    if (type === 104) return entryName({i:0}, 5, type);
    if (type === 105) return entryName(td[0], 2, type);
    if (type === 106) return entryName({i:1}, 6, type);
    if (type === 107) return entryName({i:0}, 6, type);
    if (type === 50) {
      if (td.length < 3) return "テラー名未取得";
      if (Number(td[2].i) === 19) return entryName(td[2], 1, type);
      const duplicate = Number(td[0].i) === Number(td[1].i);
      const first = duplicate ? [entryName(td[1], 0, type, 2)] : [entryName(td[0], 0, type), entryName(td[1], 0, type)];
      return [...first, entryName(td[2], 1, type)].join(" & ");
    }
    if ([6,7,8].includes(type)) {
      const counts = new Map();
      for (const item of td) counts.set(item.i, (counts.get(item.i) || 0) + 1);
      const level = 1 + td.length - counts.size;
      return [...counts].sort((a,b) => b[1]-a[1]).map(([id], index) =>
        entryName({i:id}, 0, type, index === 0 || type === 7 ? level : 1)).join(" & ");
    }
    return "テラー名未取得";
  }
  return Object.freeze({resolve});
});
