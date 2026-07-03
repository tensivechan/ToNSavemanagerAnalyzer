const owner = process.env.GH_OWNER || process.env.GITHUB_OWNER || "tensivechan";
const repo = process.env.GH_REPO || process.env.GITHUB_REPO || "ToNSavemanagerAnalyzer";

const publish = owner && repo
  ? [{ provider: "github", owner, repo, releaseType: "release" }]
  : [];

module.exports = {
  appId: "com.codex.tonsaveanalyzer",
  productName: "ToNSaveManager Analyzer",
  asar: true,
  files: [
    "electron-main.js",
    "outputs/ton-save-analyzer.html",
    "package.json"
  ],
  extraFiles: [
    {
      from: "Readme.txt",
      to: "Readme.txt"
    }
  ],
  win: {
    target: [
      "nsis",
      "portable"
    ]
  },
  nsis: {
    oneClick: false,
    perMachine: false,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
    createStartMenuShortcut: true
  },
  portable: {
    artifactName: "ToNSaveManager-Analyzer-portable.exe"
  },
  publish
};
