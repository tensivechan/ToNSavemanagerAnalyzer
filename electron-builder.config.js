const owner = process.env.GH_OWNER || process.env.GITHUB_OWNER || "tensivechan";
const repo = process.env.GH_REPO || process.env.GITHUB_REPO || "ToNSavemanagerAnalyzer";

const publish = owner && repo
  ? [{ provider: "github", owner, repo, releaseType: "release" }]
  : [];

module.exports = {
  appId: "com.codex.tonsaveanalyzer",
  productName: "ToNSaveManager Analyzer",
  icon: "assets/app-icon.ico",
  asar: true,
  files: [
    "**/*",
    "!dist{,/**}",
    "!release-package{,/**}",
    "!outputs/*.zip",
    "!outputs/*.exe",
    "!outputs/*.blockmap",
    "!**/*.map"
  ],
  extraFiles: [
    {
      from: "Readme.txt",
      to: "Readme.txt"
    },
    {
      from: "assets/app-icon.ico",
      to: "app-icon.ico"
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
