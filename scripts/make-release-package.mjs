import { copyFileSync, existsSync, mkdirSync, rmSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";

const root = process.cwd();
const packageDir = path.join(root, "release-package");
const settingsDir = path.join(packageDir, "settings");
const outputsDir = path.join(root, "outputs");
const zipPath = path.join(outputsDir, "ToNSaveManager-Analyzer-distribution.zip");

const portableExeCandidates = [
  path.join(root, "dist", "ToNSaveManager-Analyzer-portable.exe"),
  path.join(root, "outputs", "ToNSaveManager-Analyzer-portable.exe")
];

const settingsFiles = [
  path.join(root, "electron-builder.config.js"),
  path.join(root, "package.json"),
  path.join(root, ".github", "workflows", "release.yml")
];

function ensureCleanDir(target) {
  if (existsSync(target)) {
    rmSync(target, { recursive: true, force: true });
  }
  mkdirSync(target, { recursive: true });
}

function findExistingFile(paths) {
  for (const candidate of paths) {
    if (existsSync(candidate) && statSync(candidate).isFile()) {
      return candidate;
    }
  }
  return null;
}

function copyIfFile(source, targetDir) {
  if (existsSync(source) && statSync(source).isFile()) {
    copyFileSync(source, path.join(targetDir, path.basename(source)));
  }
}

ensureCleanDir(packageDir);
mkdirSync(settingsDir, { recursive: true });
mkdirSync(outputsDir, { recursive: true });

copyIfFile(path.join(root, "Readme.txt"), packageDir);

const portableExe = findExistingFile(portableExeCandidates);
if (!portableExe) {
  throw new Error("Portable exe was not found. Run `pnpm dist:portable` or `pnpm dist:package` first.");
}
copyFileSync(portableExe, path.join(packageDir, "ToNSaveManager Analyzer.exe"));

for (const file of settingsFiles) {
  copyIfFile(file, settingsDir);
}

if (existsSync(zipPath)) {
  rmSync(zipPath, { force: true });
}

execFileSync(
  "powershell.exe",
  [
    "-NoProfile",
    "-Command",
    "Compress-Archive -LiteralPath 'Readme.txt','ToNSaveManager Analyzer.exe','settings' -DestinationPath $env:ZIP_PATH -Force"
  ],
  {
    cwd: packageDir,
    env: { ...process.env, ZIP_PATH: zipPath },
    stdio: "inherit"
  }
);

console.log(`Release package created at ${packageDir}`);
console.log(`Distribution zip created at ${zipPath}`);
