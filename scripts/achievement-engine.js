(function () {
  const STORAGE_KEY = "tonsave-achievements-unlocked";

  const CATALOG = [
    {
      id: "classic_500",
      name: "クラシックを500回やる",
      description: "クラシックを500回プレイすると解除",
      criteria: {
        roundTypes: [1],
        countAtLeast: 500
      },
      osc: {
        address: "/avatar/parameters/AchievementClassic500",
        value: true
      }
    },
    {
      id: "alternate_100",
      name: "オルタネイトを100回やる",
      description: "オルタネイトを100回プレイすると解除",
      criteria: {
        roundTypes: [51],
        countAtLeast: 100
      },
      osc: {
        address: "/avatar/parameters/AchievementAlternate100",
        value: true
      }
    },
    {
      id: "classic_hungry_home_invader",
      name: "Hungry Home Invader",
      description: "クラシックで Hungry Home Invader を引く",
      criteria: {
        roundTypes: [1],
        noteEquals: "hungry home invader"
      },
      osc: {
        address: "/avatar/parameters/AchievementClassicHungryHomeInvader",
        value: true
      }
    },
    {
      id: "classic_atrached",
      name: "Atrached",
      description: "クラシックで Atrached を引く",
      criteria: {
        roundTypes: [1],
        noteEquals: "atrached"
      },
      osc: {
        address: "/avatar/parameters/AchievementClassicAtrached",
        value: true
      }
    },
    {
      id: "special_wild_yet_bloodthirsty_creature",
      name: "Wild Yet Bloodthirsty Creature",
      description: "特殊ラウンドで Wild Yet Bloodthirsty Creature を引く",
      criteria: {
        noteEquals: "wild yet bloodthirsty creature",
        roundTypeNot: 1
      },
      osc: {
        address: "/avatar/parameters/AchievementSpecialWildYetBloodthirstyCreature",
        value: true
      }
    }
  ];

  const unlocked = new Set(loadUnlockedIds());

  function loadUnlockedIds() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
    } catch {
      return [];
    }
  }

  function saveUnlockedIds() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify([...unlocked]));
    } catch {
      /* ignore */
    }
  }

  function normalize(text) {
    return String(text || "").trim().toLowerCase();
  }

  function getTerrorIds(record) {
    if (!record || !Array.isArray(record.terrorData)) return [];
    return record.terrorData
      .map(item => Number(item && item.i))
      .filter(Number.isFinite);
  }

  function matchesCriteria(record, criteria = {}) {
    if (!record) return false;

    const note = normalize(record.note);
    const roundType = Number(record.roundType);
    const mapId = Number(record.mapId);
    const playerCount = Number(record.playerCount);
    const terrorIds = getTerrorIds(record);
    const terrorCount = Number(record.terrorCount);

    if (Array.isArray(criteria.roundTypes) && criteria.roundTypes.length && !criteria.roundTypes.includes(roundType)) {
      return false;
    }

    if (criteria.roundTypeNot !== undefined && roundType === Number(criteria.roundTypeNot)) {
      return false;
    }

    if (criteria.roundType !== undefined && roundType !== Number(criteria.roundType)) {
      return false;
    }

    if (criteria.noteEquals !== undefined && note !== normalize(criteria.noteEquals)) {
      return false;
    }

    if (criteria.noteIncludes && !note.includes(normalize(criteria.noteIncludes))) {
      return false;
    }

    if (Array.isArray(criteria.mapIds) && criteria.mapIds.length && !criteria.mapIds.includes(mapId)) {
      return false;
    }

    if (criteria.mapId !== undefined && mapId !== Number(criteria.mapId)) {
      return false;
    }

    if (criteria.playerCountMin !== undefined && !(playerCount >= Number(criteria.playerCountMin))) {
      return false;
    }

    if (criteria.playerCountMax !== undefined && !(playerCount <= Number(criteria.playerCountMax))) {
      return false;
    }

    if (criteria.terrorCountMin !== undefined && !(terrorCount >= Number(criteria.terrorCountMin))) {
      return false;
    }

    if (criteria.terrorCountMax !== undefined && !(terrorCount <= Number(criteria.terrorCountMax))) {
      return false;
    }

    if (Array.isArray(criteria.terrorIdsAny) && criteria.terrorIdsAny.length && !criteria.terrorIdsAny.some(id => terrorIds.includes(Number(id)))) {
      return false;
    }

    if (Array.isArray(criteria.terrorIdsAll) && criteria.terrorIdsAll.length && !criteria.terrorIdsAll.every(id => terrorIds.includes(Number(id)))) {
      return false;
    }

    return true;
  }

  function getAchievementTarget(achievement) {
    const target = Number(achievement && achievement.criteria && achievement.criteria.countAtLeast);
    return Number.isFinite(target) && target > 0 ? target : 1;
  }

  function countMatchingRecords(records, criteria) {
    if (!Array.isArray(records) || !records.length) return 0;
    return records.reduce((count, record) => count + (matchesCriteria(record, criteria) ? 1 : 0), 0);
  }

  function getAchievementProgress(achievement, records) {
    const target = getAchievementTarget(achievement);
    const count = countMatchingRecords(records, achievement.criteria);
    return {
      id: achievement.id,
      count,
      target,
      unlocked: unlocked.has(achievement.id),
      complete: count >= target
    };
  }

  function showToast(achievement) {
    const root = document.getElementById("achievementToastRoot") || createToastRoot();
    const item = document.createElement("div");
    item.className = "achievement-toast";
    item.innerHTML = `
      <div class="achievement-toast-title">Achievement Unlocked</div>
      <div class="achievement-toast-name">${escapeHtml(achievement.name)}</div>
      <div class="achievement-toast-desc">${escapeHtml(achievement.description || "")}</div>
    `;
    root.appendChild(item);
    window.setTimeout(() => {
      item.classList.add("hide");
      window.setTimeout(() => item.remove(), 300);
    }, 3500);
  }

  function createToastRoot() {
    const style = document.createElement("style");
    style.textContent = `
      #achievementToastRoot {
        position: fixed;
        top: 16px;
        right: 16px;
        z-index: 9999;
        display: grid;
        gap: 10px;
        pointer-events: none;
      }
      .achievement-toast {
        min-width: 260px;
        max-width: 360px;
        background: rgba(18, 20, 26, .94);
        color: #f5f7fb;
        border: 1px solid rgba(255,255,255,.12);
        border-radius: 10px;
        padding: 12px 14px;
        box-shadow: 0 12px 30px rgba(0,0,0,.35);
        transform: translateY(0);
        opacity: 1;
        transition: opacity .25s ease, transform .25s ease;
      }
      .achievement-toast.hide {
        opacity: 0;
        transform: translateY(-8px);
      }
      .achievement-toast-title {
        font-size: 11px;
        letter-spacing: .04em;
        text-transform: uppercase;
        opacity: .72;
        margin-bottom: 4px;
      }
      .achievement-toast-name {
        font-size: 15px;
        font-weight: 700;
        margin-bottom: 2px;
      }
      .achievement-toast-desc {
        font-size: 12px;
        opacity: .88;
      }
    `;
    document.head.appendChild(style);

    const root = document.createElement("div");
    root.id = "achievementToastRoot";
    document.body.appendChild(root);
    return root;
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  async function emitOsc(achievement, sendOsc) {
    if (!achievement.osc || typeof sendOsc !== "function") return;
    try {
      await sendOsc({
        host: "127.0.0.1",
        port: 9000,
        address: achievement.osc.address,
        args: Array.isArray(achievement.osc.args)
          ? achievement.osc.args
          : [achievement.osc.value !== undefined ? achievement.osc.value : true]
      });
    } catch (error) {
      console.error("OSC send failed", error);
    }
  }

  async function unlock(achievement, sendOsc) {
    if (unlocked.has(achievement.id)) return false;
    unlocked.add(achievement.id);
    saveUnlockedIds();
    showToast(achievement);
    await emitOsc(achievement, sendOsc);
    window.dispatchEvent(new CustomEvent("tonsave-achievement-unlocked", {
      detail: achievement
    }));
    return true;
  }

  async function scan(records, sendOsc) {
    if (!Array.isArray(records) || !records.length) return [];
    const unlockedNow = [];
    for (const achievement of CATALOG) {
      if (unlocked.has(achievement.id)) continue;
      const progress = getAchievementProgress(achievement, records);
      if (progress.complete) {
        const isNew = await unlock(achievement, sendOsc);
        if (isNew) unlockedNow.push(achievement);
      }
    }
    return unlockedNow;
  }

  window.TonAchievements = {
    catalog: CATALOG,
    scan,
    progress(records) {
      return CATALOG.map(achievement => getAchievementProgress(achievement, records));
    },
    unlocked: () => [...unlocked],
    reset() {
      unlocked.clear();
      saveUnlockedIds();
    }
  };
})();
