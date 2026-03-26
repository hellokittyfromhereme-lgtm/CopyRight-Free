import { Router, type IRouter, type Request, type Response } from "express";
import archiver from "archiver";
import path from "path";
import fs from "fs";

const router: IRouter = Router();

const SOURCE_PASSWORD = "11223344";
const PROJECT_ROOT = path.resolve("/home/runner/workspace");

// ffmpeg-core.wasm is 31 MB — excluded from ZIP (GitHub 25 MB limit).
// setup-ffmpeg.js copies it from node_modules automatically after npm install.
const EXCLUDE_PATTERNS = [
  /ffmpeg-core\.wasm$/,
];

const INCLUDE_DIRS = [
  "artifacts/video-copyright-free/src",
  "artifacts/video-copyright-free/public",
  "artifacts/api-server/src",
];

const INCLUDE_FILES = [
  "artifacts/video-copyright-free/package.json",
  "artifacts/video-copyright-free/vite.config.ts",
  "artifacts/video-copyright-free/index.html",
  "artifacts/video-copyright-free/vercel.json",
  "artifacts/video-copyright-free/.gitignore",
  "artifacts/video-copyright-free/setup-ffmpeg.js",
  "artifacts/api-server/package.json",
  "package.json",
  "pnpm-workspace.yaml",
];

router.get("/download", (req: Request, res: Response) => {
  const { password } = req.query;

  if (!password || password !== SOURCE_PASSWORD) {
    res.status(401).json({ error: "Invalid password. Access denied." });
    return;
  }

  res.setHeader("Content-Disposition", 'attachment; filename="video-copyright-remover-source.zip"');
  res.setHeader("Content-Type", "application/zip");

  const archive = archiver("zip", { zlib: { level: 6 } });

  archive.on("error", (err) => {
    console.error("Archiver error:", err);
    if (!res.headersSent) {
      res.status(500).json({ error: "ZIP creation failed" });
    }
  });

  archive.pipe(res);

  // Add directories (excluding large binary files)
  for (const dir of INCLUDE_DIRS) {
    const fullPath = path.join(PROJECT_ROOT, dir);
    if (!fs.existsSync(fullPath)) continue;
    // Walk directory and add files one by one, skipping excluded patterns
    const addDirRecursive = (absDir: string, zipDir: string) => {
      for (const entry of fs.readdirSync(absDir, { withFileTypes: true })) {
        const absPath = path.join(absDir, entry.name);
        const zipPath = path.join(zipDir, entry.name);
        if (entry.isDirectory()) {
          addDirRecursive(absPath, zipPath);
        } else {
          const skip = EXCLUDE_PATTERNS.some(rx => rx.test(entry.name));
          if (!skip) archive.file(absPath, { name: zipPath });
        }
      }
    };
    addDirRecursive(fullPath, dir);
  }

  // Add individual files
  for (const file of INCLUDE_FILES) {
    const fullPath = path.join(PROJECT_ROOT, file);
    if (fs.existsSync(fullPath)) {
      archive.file(fullPath, { name: file });
    }
  }

  archive.finalize();
});

export default router;
