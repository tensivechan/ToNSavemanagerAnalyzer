const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const root = path.resolve(__dirname, '..');
const rounds = require('./round-classifier.js');
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
  let sent = 0;
  const send = async () => { sent++; };
  const active = { recordKey: 'live:1', roundPhase: 'active', roundType: 50, terrorData: [{ i: 29 }], result: null };
  const preview = live.preview(active).find(item => item.id === 'midnight_fusion_pilot_win');
  assert.equal(preview.matches, true);
  assert.equal(preview.waitingForResult, true);
  assert.equal((await live.scan([active], send)).length, 0);
  assert.equal(sent, 0, 'Preview must not unlock achievements or emit OSC');
  const ended = { ...active, roundPhase: 'ended' };
  assert.equal((await live.scan([ended], send)).length, 0, 'End before result must not count as victory');
  ended.result = 1;
  assert.equal((await live.scan([ended], send)).length, 1);
  assert.equal(sent, 1);
  assert.equal((await live.scan([ended], send)).length, 0);
  const secondWindow = createAchievementContext(storage).achievements.live;
  assert.equal((await secondWindow.scan([ended], send)).length, 0, 'Existing unlock state must survive another window');
  const unknown = { recordKey: 'live:2', roundPhase: 'ended', note: 'Wild Yet Bloodthirsty Creature', roundType: null };
  assert.equal((await live.scan([unknown], send)).length, 0, 'Unknown type must not satisfy a non-Classic condition');
  const classics = [{recordKey:'a',roundPhase:'ended',roundType:1}, {recordKey:'b',roundPhase:'ended',roundType:1}];
  const progress = live.progress([...classics, classics[0], {recordKey:'c',roundPhase:'active',roundType:1}]);
  assert.equal(progress.find(item => item.id === 'classic_500').count, 2);
  console.log('PASS: live preview, no early unlock, unknown values, deduplication and stored unlocks');
}

function testRenderer() {
  const html = fs.readFileSync(path.join(root, 'outputs/ton-save-analyzer.html'), 'utf8');
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
  const fields = Object.fromEntries(['roundType','mapName','terrorName','closeOverlay'].map(id => [id, {addEventListener(type, callback) { this[type] = callback; }}]));
  let update;
  let finishInitial;
  let closeCount = 0;
  let unsubscribeCount = 0;
  const events = {};
  const context = vm.createContext({
    document: {getElementById: id => fields[id]},
    window: {
      TonRounds: rounds,
      tonsave: {
        onLogMessage(callback) { update = callback; return () => unsubscribeCount++; },
        getLogState: () => new Promise(resolve => { finishInitial = resolve; })
      },
      close: () => closeCount++,
      addEventListener: (name, callback) => { events[name] = callback; }
    }
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'round-overlay.js'), 'utf8'), context);
  const record = {roundPhase:'active',roundType:1,roundTypeExtra:'Classic',mapName:'Nexus',note:'The Painter: 続行希望なし',terrorData:[{i:15}]};
  update({state:{liveRecord:record}});
  assert.equal(fields.roundType.textContent, 'Classic/クラシック');
  assert.equal(fields.mapName.textContent, 'Nexus');
  assert.equal(fields.terrorName.textContent, 'The Painter');
  finishInitial({liveRecord:null});
  await Promise.resolve();
  assert.equal(fields.terrorName.textContent, 'The Painter', 'A stale initial snapshot must not replace a newer event');
  update({state:{liveRecord:{...record,note:'<img src=x>：継続希望あり',roundPhase:'ended'}}});
  assert.equal(fields.terrorName.textContent, '<img src=x>', 'Names must be rendered as text');
  assert.match(fields.roundType.textContent, /^終了/);
  update({state:{liveRecord:{...record,note:'',terrorData:[{i:15},{i:0},{i:0}]}}});
  assert.equal(fields.terrorName.textContent, 'TerrorID 15 / 0 / 0');
  update({state:{liveRecord:null}});
  assert.equal(fields.roundType.textContent, 'ラウンド待機中');
  assert.equal(fields.mapName.textContent, '');
  fields.closeOverlay.click(); events.beforeunload();
  assert.equal(closeCount, 1); assert.equal(unsubscribeCount, 1);

  const windows = [];
  class FakeWindow {
    constructor(options) { this.options = options; this.handlers = {}; this.bounds = {x:options.x,y:options.y,width:options.width,height:options.height}; windows.push(this); }
    isDestroyed() { return Boolean(this.destroyed); }
    showInactive() { this.shown = true; }
    setAlwaysOnTop(flag, level) { this.top = {flag,level}; }
    once(name, callback) { this.handlers[name] = callback; }
    on(name, callback) { this.handlers[name] = callback; }
    loadFile(file) { this.file = file; }
    getBounds() { return this.bounds; }
    close() { this.handlers.close?.(); this.destroyed = true; this.handlers.closed?.(); }
  }
  function mainFunction(name, next) {
    return mainCode.slice(mainCode.indexOf(`function ${name}(`), mainCode.indexOf(`function ${next}(`));
  }
  const winContext = vm.createContext({BrowserWindow:FakeWindow,screen:{getPrimaryDisplay:()=>({workArea:{x:0,y:0,width:1920,height:1080}})},path,__dirname:root,iconPath:''});
  vm.runInContext('let mainWindow=null,roundOverlayWindow=null,roundOverlayBounds=null;\n' + mainFunction('createWindow','broadcastOscMessage') + mainFunction('createRoundOverlayWindow','padOscBuffer'), winContext);
  const overlay = vm.runInContext('createRoundOverlayWindow()',winContext);
  assert.equal(overlay.options.alwaysOnTop,true);
  assert.equal(overlay.options.movable,true);
  assert.equal(overlay.options.transparent,true);
  assert.equal(overlay.options.frame,false);
  assert.equal(overlay.options.show,false);
  assert.equal(overlay.options.skipTaskbar,true);
  assert.equal(overlay.options.webPreferences.sandbox,true);
  assert.equal(overlay.top.level,'screen-saver');
  assert(overlay.file.endsWith('round-overlay.html'));
  overlay.handlers['ready-to-show']();
  assert.equal(overlay.shown,true);
  assert.strictEqual(vm.runInContext('createRoundOverlayWindow()',winContext),overlay);
  assert.equal(windows.length,1);
  overlay.bounds={x:100,y:120,width:280,height:100}; overlay.close();
  const reopened=vm.runInContext('createRoundOverlayWindow()',winContext);
  assert.equal(reopened.options.x,100); assert.equal(reopened.options.width,280);
  const main=vm.runInContext('createWindow()',winContext); main.close();
  assert.equal(reopened.isDestroyed(),true,'Closing the main window must also close the overlay');
  reopened.handlers['ready-to-show']();
  console.log('PASS: overlay contents, updates, topmost settings, singleton, close/reopen and cleanup');
}

testAchievements().then(testRenderer).then(testOverlay).catch(error => { console.error(error); process.exitCode = 1; });
