const fs = require("fs");
const path = require("path");

const filePath = path.join(process.cwd(), "outputs", "ton-save-analyzer.html");
let html = fs.readFileSync(filePath, "utf8");

html = html.replace(
  /<select id="roundTypeFilter" title="RoundType">[\s\S]*?<\/select>/,
  `<select id="roundTypeFilter" title="RoundType">
            <option value="special">特殊のみ（クラシック以外）</option>
            <option value="all">すべて</option>
          </select>`
);

html = html.replace(
  /<section class="stats" aria-label="summary">[\s\S]*?<\/section>/,
  `<section class="stats" aria-label="summary">
      <div class="metric"><b id="mRecords">0</b><span>Records</span></div>
      <div class="metric"><b id="mMaps">0</b><span>Maps</span></div>
      <div class="metric"><b id="mTerrors">0</b><span>Terrors</span></div>
      <div class="metric"><b id="mWins">0</b><span>Wins</span></div>
    </section>`
);

html = html.replace(
  /grid-template-columns: repeat\(6, minmax\(120px, 1fr\)\);/g,
  "grid-template-columns: repeat(4, minmax(120px, 1fr));"
);
html = html.replace(
  /grid-template-columns: repeat\(5, minmax\(120px, 1fr\)\);/g,
  "grid-template-columns: repeat(4, minmax(120px, 1fr));"
);

html = html.replace(
  /if \(roundType !== "all" && String\(record\.roundType\) !== roundType\) return false;/,
  `if (roundType === "special" && record.roundType === 1) return false;
        if (roundType !== "all" && roundType !== "special" && String(record.roundType) !== roundType) return false;`
);

html = html.replace(
  /function refreshRoundTypeOptions\(\) \{[\s\S]*?function updateStats\(\) \{/,
  `function refreshRoundTypeOptions() {
      const previous = els.roundTypeFilter.value || "all";
      const values = [...new Set(state.records.map(record => record.roundType).filter(value => value !== null && value !== undefined))].sort((a, b) => a - b);
      els.roundTypeFilter.innerHTML = '<option value="special">特殊のみ（クラシック以外）</option><option value="all">すべて</option>' + values.map(value => {
        const label = escapeHtml(formatRoundType(value));
        return \`<option value="\${String(value)}">\${label}</option>\`;
      }).join("");
      if ([...els.roundTypeFilter.options].some(option => option.value === previous)) {
        els.roundTypeFilter.value = previous;
      } else {
        els.roundTypeFilter.value = "all";
      }
    }

    function updateStats() {`
);

html = html.replace(
  /function updateStats\(\) \{[\s\S]*?function render\(\) \{/,
  `function updateStats() {
      const maps = new Set();
      const terrors = new Set();
      let wins = 0;
      for (const record of state.records) {
        if (record.mapId !== null) maps.add(record.mapId);
        record.terrorData.forEach(item => {
          if (item && item.i !== undefined) terrors.add(Number(item.i));
        });
        if (record.result === 1) wins += 1;
      }
      els.mRecords.textContent = formatNumber(state.records.length);
      els.mMaps.textContent = formatNumber(maps.size);
      els.mTerrors.textContent = formatNumber(terrors.size);
      els.mWins.textContent = formatNumber(wins);
    }

    function render() {`
);

fs.writeFileSync(filePath, html, "utf8");
console.log(`Updated ${filePath}`);
