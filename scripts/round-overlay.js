(function () {
  const fields = {
    round: document.getElementById("roundType"),
    map: document.getElementById("mapName"),
    terror: document.getElementById("terrorName")
  };

  function cleanName(input) {
    return String(input ?? "")
      .replace(/(?:\s*[:：|/]\s*)?(?:続行希望|継続希望).*$/u, "")
      .trim();
  }

  function render(snapshot = {}) {
    const record = snapshot.liveRecord;
    let round = "ラウンド待機中";
    let map = "";
    let terror = "";
    if (record && record.roundPhase !== "waiting") {
      const identity = window.TonRounds.resolve(record);
      const label = String(record.roundTypeLabel ?? record.roundTypeExtra ?? "").trim();
      const bilingual = /[a-z]/i.test(label) && window.TonRounds.typeId(label) === identity.roundType && label !== identity.roundTypeName;
      round = bilingual ? `${label}/${identity.roundTypeName}` : identity.roundTypeName;
      if (record.roundPhase === "ended") round = `終了 · ${round}`;
      map = String(record.mapName || (record.mapId !== null && record.mapId !== undefined ? `Map ${record.mapId}` : "マップ情報待ち"));
      terror = cleanName(record.note) || cleanName(identity.specialName) ||
        (identity.terrorIds.length ? `TerrorID ${identity.terrorIds.join(" / ")}` : "テラー情報待ち");
    }
    for (const [key, text] of Object.entries({round, map, terror})) {
      fields[key].textContent = text;
      fields[key].title = text;
    }
  }

  document.getElementById("closeOverlay").addEventListener("click", () => window.close());
  let updateCount = 0;
  const unsubscribe = window.tonsave && window.tonsave.onLogMessage(message => {
    if (!message || !message.state) return;
    updateCount += 1;
    render(message.state);
  });
  if (window.tonsave) {
    const requestedAt = updateCount;
    window.tonsave.getLogState().then(snapshot => {
      if (updateCount === requestedAt) render(snapshot);
    }).catch(() => {});
  }
  window.addEventListener("beforeunload", () => {
    if (typeof unsubscribe === "function") unsubscribe();
  });
})();
