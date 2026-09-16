const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const root = path.resolve(__dirname, '..');
const rounds = require('./round-classifier.js');
const roundEndSounds = require('./round-end-sounds.js');
const terrorNames = require('./terror-name-resolver.js');
const localRequire = createRequire(path.join(root, 'electron-main.js'));
const mainCode = fs.readFileSync(path.join(root, 'electron-main.js'), 'utf8');
const noop = () => {};
const electron = {
  app: { getVersion: () => 'test', isPackaged: false, whenReady: () => ({ then: noop }), on: noop },
  BrowserWindow: { getAllWindows: () => [] }, ipcMain: { handle: noop }
};
const backend = vm.createContext({
  require(name) {
    if (name === 'electron') return electron;
    if (name === 'electron-log') return { transports: { file: {} }, info: noop, warn: noop, error: noop };
    if (name === 'electron-updater') return { autoUpdater: {} };
    return localRequire(name);
  },
  __dirname: root, process, Buffer, console
});
vm.runInContext(mainCode + '\nglobalThis.api = { processLogChunk, snapshotOscState, applyLiveOscRecord, parseLogLine, parseLogTerrorData };', backend);
const api = backend.api;
const reset = () => api.applyLiveOscRecord({ reset: true });
const feed = (...lines) => api.processLogChunk(lines.join('\n') + '\n', { emit: false });
const snapshot = () => JSON.parse(JSON.stringify(api.snapshotOscState()));
const start = type => `This round is taking place at Test Map (49) and the round type is ${type}`;

assert.equal(rounds.numberOrNull(null), null);
assert.equal(rounds.numberOrNull(''), null);
assert.equal(rounds.numberOrNull(0), 0);
assert.equal(rounds.typeId('  fOg   alternate '), 52);
assert.equal(rounds.resolve({ roundType: 6, terrorData: [{ i: 2 }] }).roundType, 8);
assert.equal(rounds.resolve({ roundType: 6, roundPhase: 'active', terrorData: [{ i: 2 }] }).roundType, 6);
assert.equal(rounds.resolve({ roundType: 1, roundTypeLabel: 'Midnight' }).roundType, 50);
assert.equal(rounds.resolve({ roundType: 1, roundTypeExtra: '6' }).roundType, 1);
assert.equal(rounds.resolve({ roundTypeLabel: 'Unrecognized Type' }).roundType, null);
assert.equal(rounds.resolve({ roundTypeLabel: 'Unrecognized Type' }).roundTypeName, 'Unrecognized Type');
assert.equal(rounds.resolve({ note: 'Atrached' }).specialName, 'Atrached');
assert.equal(rounds.resolve({ specialRoundName: 'Event Name' }).specialName, 'Event Name');
assert.equal(rounds.resolve({ note: 'Normal Terror' }).specialName, '');

reset();
assert.equal(snapshot().liveRecord, null, 'Empty monitor must not invent a round or a loss');
feed('Device Name: Example', 'Name: Startup metadata');
assert.equal(snapshot().liveRecord, null, 'Unrelated startup names must not begin a round');
assert.equal(snapshot().heldItem, null);
feed("[Behaviour] Pickup object: 'paleRegen' equipped = True, is AutoEquipType Pickup = True, last input method = Mouse, is AutoHold is enabled for this controller type = True");
assert.equal(snapshot().heldItem, 'paleRegen');
assert.equal(snapshot().liveRecord, null, 'Picking up an item must not invent a round');
feed("[Behaviour] Drop object: 'paleRegen, was equipped = True' Throw on release, last input method = Mouse");
assert.equal(snapshot().heldItem, null);
feed(start('Classic'), 'Killers have been set - 15 0 0 // Round type is Classic');
let current = snapshot().liveRecord;
assert.equal(current.roundType, 1);
assert.equal(current.result, null);
assert.equal(current.terrorCount, null, 'Slot count is not the active terror count');
assert.deepEqual(current.terrorData.map(item => item.i), [15, 0, 0]);
assert.match(current.terrorComposition, /3枠・出現数未確定/);
assert.equal(current.note, '', 'Map/type metadata must not become Terror Name');
feed('Terror Name: Actual Terror', 'Special Round Name: Custom Event');
assert.equal(snapshot().liveRecord.note, 'Actual Terror');
feed('Device Name: Unrelated metadata');
assert.equal(snapshot().liveRecord.note, 'Actual Terror', 'Unrelated name fields must not overwrite Terror Name');
assert.equal(snapshot().liveRecord.roundIdentity.specialName, 'Custom Event');
feed('RoundOver', 'Round was valid.');
assert.equal(snapshot().liveRecords.length, 1);
assert.equal(snapshot().liveRecords[0].result, null);
feed('Died in round.', 'You Died iN the Round', 'Verified Round End');
assert.equal(snapshot().liveRecords.length, 1, 'Late result and duplicate end markers must update one round');
assert.equal(snapshot().liveRecords[0].result, 0);
assert.equal(snapshot().liveRecord.roundPhase, 'ended');
feed(start('Classic'));
current = snapshot().liveRecord;
assert.deepEqual(current.terrorData, []);
assert.equal(current.result, null);
assert.equal(current.specialRoundName, '');
feed('Killers have been set - 15 0 0 // Round type is Classic', 'Terror Name: Actual Terror', 'Special Round Name: Custom Event', 'RoundOver', 'Died in round.', 'Verified Round End');
assert.equal(snapshot().liveRecords.length, 2, 'Identical consecutive rounds must both count');
assert.notEqual(snapshot().liveRecords[0].recordKey, snapshot().liveRecords[1].recordKey);
feed(start('Bloodbath'), 'Killers have been set - 29 2 0 // Round type is Midnight');
assert.equal(snapshot().liveRecord.roundType, 50, 'Latest explicit round label must win');
assert.deepEqual(snapshot().liveRecord.terrorData.map(item => item.i), [29, 2, 0]);
api.applyLiveOscRecord({ terrorData: [{ i: 29, g: 1 }, { i: 2 }, { i: 0 }] });
api.applyLiveOscRecord({ note: 'Example' });
assert.equal(snapshot().liveRecord.terrorData[0].g, 1, 'Unrelated updates must not erase TD attributes');
assert.match(snapshot().liveRecord.terrorComposition, /クラシック2体 \/ オルタネイト1体/);
assert.equal(api.parseLogLine('Terror Name: Value').note, 'Value');
assert.equal(api.parseLogTerrorData('[{"i":29,"g":1}]')[0].g, 1);
console.log('PASS: classification, raw IDs, lifecycle, delayed results and consecutive rounds');

{
  const played = [];
  const detector = roundEndSounds.createDetector((key, record) => played.push([key, record.recordKey]));
  const oldPunished = {recordKey:'old:1',timestamp:'2026-09-16T00:00:00Z',roundPhase:'ended',roundType:3};
  assert.deepEqual(Array.from(detector.sync([oldPunished], {silent:true})), []);
  assert.deepEqual(Array.from(detector.sync([oldPunished])), []);
  const punished = {recordKey:'live:1',timestamp:'2026-09-16T00:01:00Z',roundPhase:'ended',roundType:3};
  const pages = {recordKey:'live:2',timestamp:'2026-09-16T00:02:00Z',roundPhase:'ended',roundType:105};
  const activePages = {...pages,recordKey:'live:3',timestamp:'2026-09-16T00:03:00Z',roundPhase:'active'};
  assert.deepEqual(Array.from(detector.sync([punished,pages,activePages])), ['punished','eightPages']);
  assert.deepEqual(played, [['punished','live:1'],['eightPages','live:2']]);
  assert.deepEqual(Array.from(detector.sync([punished,pages])), []);
  assert.equal(roundEndSounds.soundKey({roundType:1}), '');
  console.log('PASS: Punished and 8 Pages round-end sound detection and deduplication');
}

function createAchievementContext(storage = new Map()) {
  const node = () => ({ classList: { add: noop }, appendChild: noop, remove: noop, style: {} });
  const window = { TonRounds: rounds, dispatchEvent: noop, setTimeout: noop };
  const context = vm.createContext({ window, console,
    document: { getElementById: () => node(), createElement: node },
    localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, val) => storage.set(key, val) },
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } }
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'achievement-engine.js'), 'utf8'), context);
  return { achievements: window.TonAchievements, context, storage };
}

async function testAchievements() {
  const { achievements, storage } = createAchievementContext();
  const live = achievements.live;
  assert.deepEqual(Array.from(achievements.catalog, item => item.id), [
    'azrael_survivor_normal', 'azrael_survivor_fog',
    'azrael_survivor_ghost', 'azrael_survivor_midnight', 'live_rounds_50000'
  ]);
  assert.equal(achievements.catalog.slice(0,4).every(item => item.source === 'imported'), true);
  assert.equal(achievements.catalog[4].source, 'live');
  assert.deepEqual(Array.from(live.progress([]), item => ({id:item.id,count:item.count,target:item.target})), [
    {id:'live_rounds_50000',count:0,target:50000}
  ]);
  let sent = 0;
  const send = async () => { sent++; };
  const active = { recordKey: 'live:1', timestamp:'2026-09-16T00:00:01.000Z', roundPhase: 'active', roundType: 51, terrorDataSource:'log-slots', terrorData: [{ i: 34 }], result: null };
  assert.equal(live.preview(active).find(item => item.id === 'live_rounds_50000').matches, true);
  assert.equal((await live.scan([active], send)).length, 0);
  assert.equal(live.progress([active])[0].count, 0, 'An active round must not count');
  assert.equal(sent, 0, 'Progress must not emit OSC before completion');
  const ended = { ...active, roundPhase: 'ended' };
  ended.result = 1;
  assert.equal((await live.scan([ended], send)).length, 0);
  assert.equal(live.progress([ended, ended])[0].count, 1, 'The same completed round must count once');
  const secondWindow = createAchievementContext(storage).achievements.live;
  assert.equal(secondWindow.progress([ended])[0].count, 1, 'Live round progress must survive another window');
  const nextEnded = {...ended,recordKey:'live:2',timestamp:'2026-09-16T00:01:01.000Z'};
  assert.equal(secondWindow.progress([ended,nextEnded])[0].count, 2);
  secondWindow.reset();
  assert.equal(live.progress([])[0].count, 0, 'Reset must clear persistent round progress');

  const imported = createAchievementContext().achievements.imported;
  const savedRecords = [
    {recordKey:'save:normal',roundType:51,terrorData:[{i:34,g:1}],result:1},
    {recordKey:'save:fog',roundType:52,terrorData:[{i:34,g:1}],result:1},
    {recordKey:'save:ghost',roundType:53,terrorData:[{i:34,g:1}],result:1},
    {recordKey:'save:midnight',roundType:50,terrorData:[{i:23,g:0},{i:0,g:0},{i:34,g:1}],result:1}
  ];
  assert.equal((await imported.scan(savedRecords, send)).length, 4, 'Readable save records must unlock every matching Azrael tier');
  assert.equal(imported.progress(savedRecords).every(item => item.complete), true);
  const wrongGroup = {recordKey:'wrong-group',roundType:50,terrorData:[{i:34},{i:0},{i:0}],result:1};
  assert.equal((await createAchievementContext().achievements.imported.scan([wrongGroup], send)).length, 0, 'Classic ID 34 must not be mistaken for Azrael');
  const loss = {...ended,recordKey:'loss',result:0};
  assert.equal((await createAchievementContext().achievements.imported.scan([loss], send)).length, 0, 'A loss must not unlock a survival tier');

  const legacyStorage = new Map([
    ['tonsave-achievements-imported-unlocked', JSON.stringify(['classic_500','celestial_seraphim'])],
    ['tonsave-achievements-live-unlocked', JSON.stringify(['midnight_fusion_pilot_win','azrael_survivor_normal'])]
  ]);
  const migrated = createAchievementContext(legacyStorage).achievements;
  assert.deepEqual(Array.from(migrated.imported.unlocked()), []);
  assert.deepEqual(Array.from(migrated.live.unlocked()), []);

  for (const endFirst of [false, true]) {
    reset();
    const wonAchievements = createAchievementContext().achievements.live;
    feed(start('Alternate'), 'Killers have been set - 34 0 0 // Round type is Alternate');
    assert.equal((await wonAchievements.scan([snapshot().liveRecord], send)).length, 0);
    if (endFirst) feed('RoundOver');
    feed('2026.09.16 12:00:00 Log - Round Won');
    const won = snapshot();
    assert.equal(won.liveRecord.result, 1);
    assert.equal(won.liveRecord.roundPhase, 'ended');
    assert.equal(won.liveRecords.length, 1);
    assert.equal(won.liveRecords[0].result, 1);
    assert.equal((await wonAchievements.scan(won.liveRecords, send)).length, 0, 'Round Won must not unlock save-only achievements');
    feed('Round Won', 'RoundOver', 'Verified Round End');
    assert.equal(snapshot().liveRecords.length, 1);
    assert.equal((await wonAchievements.scan(snapshot().liveRecords, send)).length, 0, 'Repeated win/end logs must not unlock twice');
    feed(start('Midnight'));
    assert.equal(snapshot().liveRecord.result, null, 'A win must not carry into the next round');
  }
  assert.equal(rounds.parseLogLine('Round Won: unrelated text'), null);
  console.log('PASS: save-only Azrael tiers, persistent 50,000 live-round progress, group matching and legacy cleanup');
}

function testRenderer() {
  const html = fs.readFileSync(path.join(root, 'outputs/ton-save-analyzer.html'), 'utf8');
  assert.match(html, /setRoundOverlayVisibility\(!roundOverlayVisible\)/);
  assert.match(html, /onRoundOverlayVisibility\(updateRoundOverlayButton\)/);
  assert.match(html, /id="settingsShell"/);
  assert.match(html, /chooseRoundEndSound\("punished"\)/);
  assert.match(html, /chooseRoundEndSound\("eightPages"\)/);
  assert.match(mainCode, /processLogChunk\(buffer\.toString\("utf8"\), \{ emit: !initialRead \}\)/);
  assert.match(mainCode, /webContents\.once\("did-finish-load"/);
  assert.match(mainCode, /backgroundThrottling: false/);
  const blocks = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)];
  for (const match of blocks) {
    const src = match[1].match(/src="([^"]+)"/);
    new vm.Script(src ? fs.readFileSync(path.resolve(root, 'outputs', src[1]), 'utf8') : match[2]);
  }
  const inline = blocks.find(match => match[2].includes('function normalizeLiveRecord('))[2];
  function getFunction(name) {
    const begin = inline.indexOf(`    function ${name}(`);
    const end = inline.indexOf('\n    }', begin);
    assert(begin > 0 && end > begin, name);
    return inline.slice(begin, end + 6);
  }
  const state = { liveSnapshotReceived: false, liveCurrentRecord: null, monitor: {rawLines:[]}, achievementSource:'live' };
  const els = {achievementCurrentRound:{classList:{toggle:noop}}};
  const context = vm.createContext({window:{TonRounds:rounds}, state, els});
  const names = ['value','numberOrNull','formatTerrorEntry','formatTerrorMatches','normalizeLiveRecord','deriveRoundRecordFromMonitorLines','getCurrentRoundRecord','formatCurrentRoundType','formatCurrentRound','renderAchievementCurrentRound','escapeHtml','parseTonLogText','normalizeRecord','parsePlayers'];
  vm.runInContext(names.map(getFunction).join('\n'), context);
  context.raw = {roundPhase:'active', roundType:50, note:'<img onerror=x>', terrorData:[{i:29},{i:0}], result:null, terrorDataSource:'log-slots'};
  const record = vm.runInContext('normalizeLiveRecord(raw)', context);
  assert.equal(record.result, null);
  assert.equal(record.mapId, null);
  assert.equal(record.terrorCount, null);
  state.liveSnapshotReceived = true;
  state.liveCurrentRecord = record;
  vm.runInContext('renderAchievementCurrentRound()', context);
  assert(!els.achievementCurrentRound.innerHTML.includes('<img'));
  assert(els.achievementCurrentRound.innerHTML.includes('&lt;img'));
  assert(els.achievementCurrentRound.innerHTML.includes('ミッドナイト'));
  context.lines = [start('Bloodbath'), 'Killers have been set - 29 0 2 // Round type is Midnight','RoundOver','Lived in round.'].map(line=>({line}));
  const fallback = vm.runInContext('deriveRoundRecordFromMonitorLines(lines)', context);
  assert.equal(fallback.roundType, 50);
  assert.equal(fallback.roundPhase, 'ended');
  assert.equal(fallback.result, 1);
  state.liveCurrentRecord = null;
  state.monitor.rawLines = context.lines;
  assert.equal(vm.runInContext('getCurrentRoundRecord()',context), null, 'A waiting snapshot must not resurrect an older round');
  assert.equal(vm.runInContext('formatTerrorMatches([{i:0},{i:2}], "Actual Name")',context), '0 / 2: Actual Name');
  assert.equal(vm.runInContext('formatTerrorMatches([{i:null}], "Name")',context), '');
  context.log = ['Name: Startup metadata', ...context.lines.map(item => item.line), start('Classic')].join('\n');
  const imported = vm.runInContext('parseTonLogText(log, "test.log", 0)', context);
  assert.equal(imported.length, 2);
  assert.equal(imported[0].roundType, 50);
  assert.equal(imported[0].result, 1);
  assert.equal(imported[0].roundPhase, 'ended');
  assert.equal(imported[1].roundPhase, 'active');
  assert.equal(imported[1].result, null);
  context.save = {Note:'Actual Name',RT:6,RType:'Midnight',TD:[{i:29,g:1},{i:0},{i:2}]};
  const saved = vm.runInContext('normalizeRecord(save, 0, "test.json", 0)',context);
  assert.equal(saved.roundType, 50);
  assert.equal(rounds.resolve(saved).roundType, saved.roundType);
  assert.strictEqual(saved.terrorData, context.save.TD);
  console.log('PASS: renderer syntax, escaped current-round card, fallback and Terror Name behavior');
}

async function testOverlay() {
  const fields = Object.fromEntries(['roundType','mapName','terrorName','heldItem','closeOverlay'].map(id => [id, {addEventListener(type, callback) { this[type] = callback; }}]));
  let update;
  let finishInitial;
  let closeCount = 0;
  let hideCount = 0;
  let unsubscribeCount = 0;
  const overlayHeights = [];
  const events = {};
  const context = vm.createContext({
    document: {getElementById: id => fields[id]},
    window: {
      TonRounds: rounds,
      TonTerrorNameResolver: terrorNames,
      tonsave: {
        onLogMessage(callback) { update = callback; return () => unsubscribeCount++; },
        getLogState: () => new Promise(resolve => { finishInitial = resolve; }),
        setRoundOverlayHeight: height => overlayHeights.push(height),
        setRoundOverlayVisibility: visible => { if (!visible) hideCount++; return Promise.resolve(false); }
      },
      close: () => closeCount++,
      addEventListener: (name, callback) => { events[name] = callback; }
    }
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'round-overlay.js'), 'utf8'), context);
  const record = {roundPhase:'active',roundType:1,roundTypeExtra:'Classic',mapName:'Nexus',note:'The Painter: 続行希望なし',terrorData:[{i:15}],terrorDataSource:'log-slots'};
  update({state:{liveRecord:record,heldItem:'paleRegen'}});
  assert.equal(fields.roundType.textContent, 'Classic/クラシック');
  assert.equal(fields.mapName.textContent, 'Nexus');
  assert.equal(fields.terrorName.textContent, 'The Painter');
  assert.equal(fields.heldItem.textContent, 'Item: paleRegen');
  assert.equal(overlayHeights.at(-1),116);
  finishInitial({liveRecord:null,heldItem:null});
  await Promise.resolve();
  assert.equal(fields.terrorName.textContent, 'The Painter', 'A stale initial snapshot must not replace a newer event');
  update({state:{liveRecord:{...record,note:'<img src=x>：継続希望あり',roundPhase:'ended'}}});
  assert.equal(fields.terrorName.textContent, '<img src=x>', 'Names must be rendered as text');
  assert.equal(fields.roundType.textContent, 'Classic/クラシック');
  update({state:{liveRecord:{...record,note:'',terrorData:[{i:15},{i:0},{i:0}]}}});
  assert.equal(fields.terrorName.textContent, 'Purple Guy');
  update({state:{liveRecord:{...record,note:'',terrorData:[{i:23},{i:0},{i:0}]}}});
  assert.equal(fields.terrorName.textContent, 'The Painter');
  update({state:{liveRecord:{...record,note:'',terrorData:[{i:9999},{i:0},{i:0}]}}});
  assert.equal(fields.terrorName.textContent, 'テラー名未取得');
  update({state:{liveRecord:{...record,note:'',roundType:50,roundTypeExtra:'Midnight',terrorData:[{i:23},{i:0},{i:0}]}}});
  assert.equal(fields.terrorName.textContent, 'The Painter\nHuggy\nDecayed Sponge');
  assert.equal(overlayHeights.at(-1),152);
  update({state:{liveRecord:null,heldItem:null}});
  assert.equal(fields.roundType.textContent, 'ラウンド待機中');
  assert.equal(fields.heldItem.textContent, 'Item: Null');
  assert.equal(fields.mapName.textContent, '');
  fields.closeOverlay.click(); events.beforeunload();
  await Promise.resolve();
  assert.equal(closeCount, 0); assert.equal(hideCount, 1); assert.equal(unsubscribeCount, 1);

  const windows = [];
  class FakeWindow {
    constructor(options) { this.options = options; this.handlers = {}; this.bounds = {x:options.x,y:options.y,width:options.width,height:options.height}; this.webContents={send:(channel,value)=>{this.sent={channel,value};}}; windows.push(this); }
    isDestroyed() { return Boolean(this.destroyed); }
    isVisible() { return Boolean(this.shown) && !this.destroyed; }
    showInactive() { this.shown = true; }
    hide() { this.shown = false; }
    setAlwaysOnTop(flag, level) { this.top = {flag,level}; }
    setVisibleOnAllWorkspaces(flag, options) { this.allWorkspaces = {flag,options}; }
    once(name, callback) { this.handlers[name] = callback; }
    on(name, callback) { this.handlers[name] = callback; }
    loadFile(file) { this.file = file; }
    getBounds() { return this.bounds; }
    setBounds(bounds) { this.bounds = bounds; }
    close() { this.handlers.close?.(); this.destroyed = true; this.handlers.closed?.(); }
  }
  FakeWindow.getAllWindows=()=>windows.filter(win=>!win.destroyed);
  function mainFunction(name, next) {
    return mainCode.slice(mainCode.indexOf(`function ${name}(`), mainCode.indexOf(`function ${next}(`));
  }
  const display={workArea:{x:0,y:0,width:1920,height:1080}};
  const winContext = vm.createContext({BrowserWindow:FakeWindow,screen:{getPrimaryDisplay:()=>display,getDisplayMatching:()=>display},path,__dirname:root,iconPath:'',setInterval:()=>({unref:noop})});
  vm.runInContext('let mainWindow=null,roundOverlayWindow=null,roundOverlayBounds=null,roundOverlayVisibleRequested=true,roundOverlayTopmostTimer=null;\n' + mainFunction('createWindow','broadcastOscMessage') + mainFunction('broadcastRoundOverlayVisibility','createRoundOverlayWindow') + mainFunction('createRoundOverlayWindow','padOscBuffer'), winContext);
  const overlay = vm.runInContext('createRoundOverlayWindow()',winContext);
  assert.equal(overlay.options.alwaysOnTop,true);
  assert.equal(overlay.options.movable,true);
  assert.equal(overlay.options.transparent,true);
  assert.equal(overlay.options.frame,false);
  assert.equal(overlay.options.show,false);
  assert.equal(overlay.options.height,116);
  assert.equal(overlay.options.skipTaskbar,true);
  assert.equal(overlay.options.webPreferences.sandbox,true);
  assert.equal(overlay.top.level,'screen-saver');
  assert.equal(overlay.allWorkspaces.options.visibleOnFullScreen,true);
  assert(overlay.file.endsWith('round-overlay.html'));
  overlay.handlers['ready-to-show']();
  assert.equal(overlay.shown,true);
  assert.strictEqual(vm.runInContext('createRoundOverlayWindow()',winContext),overlay);
  assert.equal(windows.length,1);
  assert.equal(vm.runInContext('setRoundOverlayVisibility(false)',winContext),false);
  assert.equal(overlay.isVisible(),false);
  assert.equal(vm.runInContext('setRoundOverlayVisibility(true)',winContext),true);
  assert.equal(overlay.isVisible(),true);
  assert.equal(windows.length,1,'Showing a hidden overlay must reuse the same window');
  overlay.shown=false;
  vm.runInContext('maintainRoundOverlayWindow()',winContext);
  assert.equal(overlay.isVisible(),true,'Watchdog must restore an unexpectedly hidden overlay');
  overlay.bounds={x:2500,y:1400,width:240,height:116};
  vm.runInContext('maintainRoundOverlayWindow()',winContext);
  assert(overlay.bounds.x < 1920 && overlay.bounds.y < 1080,'Watchdog must return an off-screen overlay to a display');
  overlay.bounds={x:100,y:120,width:280,height:100}; overlay.close();
  const reopened=vm.runInContext('createRoundOverlayWindow()',winContext);
  assert.equal(reopened.options.x,100); assert.equal(reopened.options.width,280);
  const main=vm.runInContext('createWindow()',winContext); main.close();
  assert.equal(reopened.isDestroyed(),true,'Closing the main window must also close the overlay');
  reopened.handlers['ready-to-show']();
  console.log('PASS: overlay contents, updates, topmost settings, singleton, close/reopen and cleanup');
}

function testTerrorNames() {
  const record = {roundPhase:'active',roundType:1,terrorDataSource:'log-slots',terrorData:[{i:0},{i:0},{i:0}]};
  const before=JSON.stringify(record);
  assert.equal(terrorNames.resolve(record),'Huggy');
  assert.equal(terrorNames.resolve({...record,roundType:51}),'Decayed Sponge');
  assert.equal(terrorNames.resolve({...record,roundType:10}),"Guidance & The Booboo's");
  assert.equal(terrorNames.resolve({...record,roundType:104}),'The Meatball Man');
  assert.equal(terrorNames.resolve({...record,roundType:100}),'PSYCHOSIS');
  assert.equal(terrorNames.resolve({...record,roundType:50,terrorData:[{i:23},{i:0},{i:0}]}),'The Painter & Huggy & Decayed Sponge');
  assert.deepEqual(terrorNames.resolveAll({...record,roundType:50,terrorData:[{i:23},{i:0},{i:0}]}),['The Painter','Huggy','Decayed Sponge']);
  assert.equal(terrorNames.resolve({...record,roundType:6}),'Huggy (LVL 3)');
  assert.equal(terrorNames.resolve({...record,roundType:5,terrorData:[{i:35}]}),'Epic Bonnie');
  assert.equal(terrorNames.resolve({...record,roundType:52,roundTypeExtra:'Fog (Alternate)'}),'Decayed Sponge');
  assert.equal(terrorNames.resolve({...record,roundType:999}),'テラー名未取得');
  assert.equal(terrorNames.resolve({roundType:1,terrorData:[{i:0,g:1},{i:23,g:0}]}),'Decayed Sponge & The Painter');
  assert.equal(JSON.stringify(record),before,'Name resolution must preserve raw IDs');
  console.log('PASS: names by round/group, padded zero slots, levels, variants and unknown IDs');
}

testTerrorNames();
testAchievements().then(testRenderer).then(testOverlay).catch(error => { console.error(error); process.exitCode = 1; });
