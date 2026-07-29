import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const artifactToolPath = "C:/Users/chans/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/@oai/artifact-tool/dist/artifact_tool.mjs";
const { FileBlob, SpreadsheetFile } = await import(pathToFileURL(artifactToolPath).href);

const workbookPath = process.argv[2];
const outputPath = process.argv[3];

if (!workbookPath || !outputPath) {
  console.error("Usage: node build-terror-id-name-mapping.mjs <workbook.xlsx> <output.js>");
  process.exit(1);
}

function numberOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function stringOrEmpty(value) {
  return value === null || value === undefined ? "" : String(value);
}

function cleanRows(values) {
  return values
    .slice(4)
    .filter(row => Array.isArray(row) && row.some(cell => cell !== null && cell !== undefined && cell !== ""));
}

const input = await FileBlob.load(workbookPath);
const workbook = await SpreadsheetFile.importXlsx(input);

const summarySheet = workbook.worksheets.getItem("ID対応表");
const candidatesSheet = workbook.worksheets.getItem("全候補");

const summaryValues = await summarySheet.getRange("A1:J139").values;
const candidateValues = await candidatesSheet.getRange("A1:G324").values;

const summaryRows = cleanRows(summaryValues);
const candidateRows = cleanRows(candidateValues);

const candidatesById = new Map();
for (const row of candidateRows) {
  const id = numberOrNull(row[0]);
  const name = stringOrEmpty(row[1]).trim();
  if (id === null || !name) continue;
  const list = candidatesById.get(id) || [];
  list.push({
    name,
    count: numberOrNull(row[2]) ?? 0,
    ratio: numberOrNull(row[3]),
    firstObserved: numberOrNull(row[4]),
    lastObserved: numberOrNull(row[5]),
    source: stringOrEmpty(row[6]).trim()
  });
  candidatesById.set(id, list);
}

const byId = {};
for (const row of summaryRows) {
  const id = numberOrNull(row[0]);
  if (id === null) continue;
  const candidates = (candidatesById.get(id) || []).slice().sort((left, right) => {
    const countDiff = (right.count ?? 0) - (left.count ?? 0);
    if (countDiff) return countDiff;
    return String(left.name).localeCompare(String(right.name), "ja");
  });
  byId[id] = {
    id,
    primaryName: stringOrEmpty(row[1]).trim(),
    latestName: stringOrEmpty(row[2]).trim(),
    primaryCount: numberOrNull(row[3]),
    directCount: numberOrNull(row[4]),
    candidateCount: numberOrNull(row[5]),
    primaryRatio: numberOrNull(row[6]),
    firstObserved: numberOrNull(row[7]),
    lastObserved: numberOrNull(row[8]),
    judgment: stringOrEmpty(row[9]).trim(),
    candidates
  };
}

for (const [id, candidates] of candidatesById.entries()) {
  if (byId[id]) continue;
  byId[id] = {
    id,
    primaryName: candidates[0]?.name || "",
    latestName: candidates[0]?.name || "",
    primaryCount: candidates[0]?.count ?? 0,
    directCount: candidates.reduce((sum, item) => sum + (item.count ?? 0), 0),
    candidateCount: candidates.length,
    primaryRatio: candidates[0]?.ratio ?? null,
    firstObserved: candidates[0]?.firstObserved ?? null,
    lastObserved: candidates[0]?.lastObserved ?? null,
    judgment: "",
    candidates: candidates.slice().sort((left, right) => {
      const countDiff = (right.count ?? 0) - (left.count ?? 0);
      if (countDiff) return countDiff;
      return String(left.name).localeCompare(String(right.name), "ja");
    })
  };
}

const payload = {
  sourceFile: path.basename(workbookPath),
  generatedAt: new Date().toISOString(),
  byId
};

const js = `globalThis.TonTerrorMapping = ${JSON.stringify(payload, null, 2)};\n`;
await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.writeFile(outputPath, js, "utf8");
console.log(`Wrote ${outputPath}`);
