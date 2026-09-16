(function () {
  const fields = {
    round: document.getElementById("roundType"),
    map: document.getElementById("mapName"),
    terror: document.getElementById("terrorName"),
    item: document.getElementById("heldItem")
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
    let terrorLines = 1;
    const item = `Item: ${String(snapshot.heldItem || "Null")}`;
    if (record && record.roundPhase !== "waiting") {
      const identity = window.TonRounds.resolve(record);
      const label = String(record.roundTypeLabel ?? record.roundTypeExtra ?? "").trim();
      const bilingual = /[a-z]/i.test(label) && window.TonRounds.typeId(label) === identity.roundType && label !== identity.roundTypeName;
      round = bilingual ? `${label}/${identity.roundTypeName}` : identity.roundTypeName;
      map = String(record.mapName || (record.mapId !== null && record.mapId !== undefined ? `Map ${record.mapId}` : "マップ情報待ち"));
      const directName = cleanName(record.note) || cleanName(identity.specialName);
      const names = directName ? [directName] : window.TonTerrorNameResolver.resolveAll(record);
      terror = (names.length ? names : ["テラー名未取得"]).join("\n");
      terrorLines = Math.max(1, names.length);
    }
    for (const [key, text] of Object.entries({round, map, terror, item})) {
      fields[key].textContent = text;
      fields[key].title = text;
    }
    if (window.tonsave && window.tonsave.setRoundOverlayHeight) {
      window.tonsave.setRoundOverlayHeight(116 + (terrorLines - 1) * 18);
    }
  }

  document.getElementById("closeOverlay").addEventListener("click", () => {
    if (window.tonsave && window.tonsave.setRoundOverlayVisibility) {
      window.tonsave.setRoundOverlayVisibility(false).catch(() => {});
    }
  });
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
