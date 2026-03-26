import { Router, type IRouter, type Request, type Response } from "express";
import multer from "multer";
import { spawn } from "child_process";
import path from "path";
import fs from "fs";
import { v4 as uuidv4 } from "uuid";

const router: IRouter = Router();

const UPLOAD_DIR = "/tmp/uploads";
const PROCESSED_DIR = "/tmp/processed";

fs.mkdirSync(UPLOAD_DIR, { recursive: true });
fs.mkdirSync(PROCESSED_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: UPLOAD_DIR,
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${uuidv4()}${ext}`);
  },
});
const upload = multer({ storage, limits: { fileSize: 2 * 1024 * 1024 * 1024 } });

interface Job {
  jobId: string;
  status: "queued" | "processing" | "completed" | "failed";
  progress: number;
  message: string;
  outputFile: string | null;
  errorMessage: string | null;
  inputFile: string | null;
}

const jobs = new Map<string, Job>();

const jobOptions = new Map<string, {
  resolution: string;
  aspectRatio: string;
  pitchShift: boolean;
  colorGrade: boolean;
  removeMetadata: boolean;
  frameModify: boolean;
}>();

function buildFFmpegArgs(
  inputPath: string,
  outputPath: string,
  options: {
    resolution: string;
    aspectRatio: string;
    pitchShift: boolean;
    colorGrade: boolean;
    removeMetadata: boolean;
    frameModify: boolean;
  }
): string[] {
  const args: string[] = ["-y", "-threads", "0", "-i", inputPath];

  const videoFilters: string[] = [];
  const audioFilters: string[] = [];

  if (options.colorGrade) {
    videoFilters.push("eq=brightness=0.01:saturation=1.02:contrast=1.01");
  }
  if (options.frameModify) {
    videoFilters.push("hue=h=1");
  }

  let scaleFilter = "";
  if (options.aspectRatio !== "original") {
    const ratioMap: Record<string, string> = {
      "16:9": "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2",
      "9:16": "scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2",
      "1:1": "scale=1080:1080:force_original_aspect_ratio=decrease,pad=1080:1080:(ow-iw)/2:(oh-ih)/2",
      "4:3": "scale=1440:1080:force_original_aspect_ratio=decrease,pad=1440:1080:(ow-iw)/2:(oh-ih)/2",
      "21:9": "scale=2560:1080:force_original_aspect_ratio=decrease,pad=2560:1080:(ow-iw)/2:(oh-ih)/2",
    };
    if (ratioMap[options.aspectRatio]) scaleFilter = ratioMap[options.aspectRatio];
  } else if (options.resolution !== "original") {
    const [w, h] = options.resolution.split("x");
    scaleFilter = `scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2`;
  }

  if (scaleFilter) videoFilters.unshift(scaleFilter);

  const needsVideoRecode = videoFilters.length > 0;
  const needsAudioRecode = options.pitchShift;

  if (needsVideoRecode) {
    args.push("-vf", videoFilters.join(","));
    args.push(
      "-c:v", "libx264",
      "-preset", "ultrafast",
      "-crf", "32",
      "-g", "300",
      "-bf", "0",
      "-pix_fmt", "yuv420p",
      "-sc_threshold", "0",
    );
  } else {
    args.push("-c:v", "copy");
  }

  if (needsAudioRecode) {
    audioFilters.push("asetrate=44100*1.005,aresample=44100");
    args.push("-af", audioFilters.join(","));
    args.push("-c:a", "aac", "-b:a", "128k");
  } else {
    args.push("-c:a", "copy");
  }

  if (options.removeMetadata) {
    args.push("-map_metadata", "-1", "-map_chapters", "-1");
  }

  args.push("-movflags", "+faststart", outputPath);
  return args;
}

function getVideoDuration(inputPath: string): Promise<number> {
  return new Promise((resolve) => {
    const probe = spawn("ffprobe", [
      "-v", "quiet", "-print_format", "json", "-show_format", inputPath
    ]);
    let out = "";
    probe.stdout.on("data", (d) => { out += d.toString(); });
    probe.on("close", () => {
      try {
        const json = JSON.parse(out);
        resolve(parseFloat(json?.format?.duration ?? "0"));
      } catch {
        resolve(0);
      }
    });
    probe.on("error", () => resolve(0));
  });
}

function processJobAsync(job: Job): void {
  if (!job.inputFile) {
    job.status = "failed";
    job.errorMessage = "No input file";
    return;
  }

  const inputPath = job.inputFile;
  const outputPath = path.join(PROCESSED_DIR, `${job.jobId}_output.mp4`);
  const storedOptions = jobOptions.get(job.jobId) ?? {
    resolution: "original", aspectRatio: "original",
    pitchShift: true, colorGrade: true, removeMetadata: true, frameModify: true,
  };

  job.status = "processing";
  job.progress = 3;
  job.message = "Analyzing video...";

  getVideoDuration(inputPath).then((totalDuration) => {
    const args = buildFFmpegArgs(inputPath, outputPath, storedOptions);

    // Use -progress pipe to get structured progress output
    args.splice(1, 0, "-progress", "pipe:2", "-stats_period", "1");

    const ffmpeg = spawn("ffmpeg", args);

    let stderrBuffer = "";  // APPEND all data, never replace
    let lastPct = 3;

    const statusMessages = [
      "Removing metadata...",
      "Adjusting audio fingerprint...",
      "Applying visual modifications...",
      "Compressing & encoding...",
      "Finalizing output...",
    ];

    ffmpeg.stderr.on("data", (data: Buffer) => {
      stderrBuffer += data.toString(); // APPEND, not replace

      // Parse FFmpeg structured progress: out_time_ms=XXXXXXX
      const msMatch = stderrBuffer.match(/out_time_ms=(\d+)/g);
      if (msMatch && msMatch.length > 0 && totalDuration > 0) {
        const lastMs = parseInt(msMatch[msMatch.length - 1].replace("out_time_ms=", ""));
        const currentSec = lastMs / 1_000_000;
        const pct = Math.min(95, Math.floor((currentSec / totalDuration) * 100));
        if (pct > lastPct) {
          lastPct = pct;
          job.progress = pct;
        }
      }

      // Fallback: parse time= HH:MM:SS
      const timeMatches = stderrBuffer.match(/time=(\d+):(\d+):(\d+\.?\d*)/g);
      if (timeMatches && timeMatches.length > 0 && totalDuration > 0 && job.progress < 5) {
        const t = timeMatches[timeMatches.length - 1].replace("time=", "").split(":");
        const currentSec = parseInt(t[0]) * 3600 + parseInt(t[1]) * 60 + parseFloat(t[2]);
        const pct = Math.min(95, Math.floor((currentSec / totalDuration) * 100));
        if (pct > lastPct) { lastPct = pct; job.progress = pct; }
      }

      // Update message based on progress
      const idx = Math.min(
        Math.floor((job.progress / 95) * statusMessages.length),
        statusMessages.length - 1
      );
      job.message = statusMessages[idx];

      // Trim buffer to avoid memory leak (keep last 4KB)
      if (stderrBuffer.length > 4096) {
        stderrBuffer = stderrBuffer.slice(-4096);
      }
    });

    // Fallback ticker: if no real progress, slowly increment so UI isn't stuck
    const ticker = setInterval(() => {
      if (job.status !== "processing") { clearInterval(ticker); return; }
      if (job.progress < 90) {
        job.progress = Math.min(90, job.progress + 2);
        const idx = Math.min(
          Math.floor((job.progress / 90) * statusMessages.length),
          statusMessages.length - 1
        );
        job.message = statusMessages[idx];
      }
    }, 4000);

    ffmpeg.on("close", (code) => {
      clearInterval(ticker);
      if (code === 0 && fs.existsSync(outputPath)) {
        job.status = "completed";
        job.progress = 100;
        job.message = "Done! Your video is copyright-free.";
        job.outputFile = outputPath;
      } else {
        job.status = "failed";
        job.progress = 0;
        job.message = "Processing failed";
        job.errorMessage = `FFmpeg exited with code ${code}`;
      }
      try { if (job.inputFile) fs.unlinkSync(job.inputFile); } catch {}
    });

    ffmpeg.on("error", (err) => {
      clearInterval(ticker);
      job.status = "failed";
      job.errorMessage = err.message;
      job.message = "Processing failed";
    });
  });
}

// ─── Routes ─────────────────────────────────────────────────────────────────

router.post("/upload", upload.single("video"), (req: Request, res: Response) => {
  if (!req.file) {
    res.status(400).json({ error: "No file uploaded" });
    return;
  }
  res.json({
    filename: req.file.filename,
    originalName: req.file.originalname,
    size: req.file.size,
    path: req.file.path,
  });
});

router.post("/process", (req: Request, res: Response) => {
  const {
    filename,
    resolution = "original",
    aspectRatio = "original",
    pitchShift = true,
    colorGrade = true,
    removeMetadata = true,
    frameModify = true,
  } = req.body;

  if (!filename) { res.status(400).json({ error: "filename is required" }); return; }

  const inputPath = path.join(UPLOAD_DIR, filename);
  if (!fs.existsSync(inputPath)) {
    res.status(400).json({ error: "File not found. Please upload first." });
    return;
  }

  const jobId = uuidv4();
  const job: Job = {
    jobId, status: "queued", progress: 0,
    message: "Job queued...", outputFile: null, errorMessage: null,
    inputFile: inputPath,
  };

  jobs.set(jobId, job);
  jobOptions.set(jobId, { resolution, aspectRatio, pitchShift, colorGrade, removeMetadata, frameModify });
  setTimeout(() => processJobAsync(job), 200);

  res.json({ jobId, message: "Processing started", estimatedSeconds: 60 });
});

router.get("/status/:jobId", (req: Request, res: Response) => {
  const job = jobs.get(req.params.jobId);
  if (!job) { res.status(404).json({ error: "Job not found" }); return; }
  res.json({
    jobId: job.jobId, status: job.status, progress: job.progress,
    message: job.message,
    outputFile: job.outputFile ? "ready" : null,
    errorMessage: job.errorMessage,
  });
});

router.get("/download/:jobId", (req: Request, res: Response) => {
  const job = jobs.get(req.params.jobId);
  if (!job) { res.status(404).json({ error: "Job not found" }); return; }
  if (job.status !== "completed" || !job.outputFile) {
    res.status(400).json({ error: "Video not ready" }); return;
  }
  if (!fs.existsSync(job.outputFile)) {
    res.status(404).json({ error: "Output file not found" }); return;
  }

  const filename = `copyright-free-${job.jobId.slice(0, 8)}.mp4`;
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.setHeader("Content-Type", "video/mp4");

  const stream = fs.createReadStream(job.outputFile);
  stream.pipe(res);
  res.on("finish", () => {
    try {
      if (job.outputFile) fs.unlinkSync(job.outputFile);
      jobs.delete(job.jobId);
      jobOptions.delete(job.jobId);
    } catch {}
  });
});

export default router;
