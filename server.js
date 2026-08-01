import express from "express";
import cors from "cors";
import multer from "multer";
import ffmpeg from "fluent-ffmpeg";
import ffmpegPath from "ffmpeg-static";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";

if (!ffmpegPath) {
  throw new Error("FFmpeg binary was not found.");
}

ffmpeg.setFfmpegPath(ffmpegPath);

const app = express();
const port = process.env.PORT || 10000;

app.use(cors({
  origin: process.env.ALLOWED_ORIGIN
    ? process.env.ALLOWED_ORIGIN.split(",").map(v => v.trim())
    : true,
  methods: ["GET", "POST", "OPTIONS"],
  exposedHeaders: ["Content-Disposition", "Content-Type", "Content-Length"]
}));

app.use(express.json({ limit: "1mb" }));

const upload = multer({
  dest: os.tmpdir(),
  limits: {
    fileSize: 250 * 1024 * 1024
  },
  fileFilter: (_req, file, callback) => {
    const allowed = [
      "video/webm",
      "video/mp4",
      "application/octet-stream"
    ];
    callback(null, allowed.includes(file.mimetype));
  }
});

app.get("/", (_req, res) => {
  res.json({
    service: "Soul Mandala MP4 Export",
    status: "ok",
    endpoint: "POST /convert",
    format: "MP4 H.264 + AAC"
  });
});

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

function safeName(value) {
  return String(value || "Soul_Mandala")
    .replace(/[^a-zA-Z0-9_.-]+/g, "_")
    .slice(0, 100);
}

app.post("/convert", upload.single("video"), async (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: "Video file is required in field 'video'." });
    return;
  }

  const id = crypto.randomUUID();
  const inputPath = req.file.path;
  const outputPath = path.join(os.tmpdir(), `${id}.mp4`);
  const outputName = `${safeName(req.body?.filename)}.mp4`;

  try {
    await new Promise((resolve, reject) => {
      ffmpeg(inputPath)
        .outputOptions([
          "-map 0:v:0",
          "-map 0:a:0?",
          "-c:v libx264",
          "-preset veryfast",
          "-crf 22",
          "-pix_fmt yuv420p",
          "-profile:v high",
          "-level 4.0",
          "-c:a aac",
          "-b:a 160k",
          "-ar 48000",
          "-ac 2",
          "-movflags +faststart",
          "-max_muxing_queue_size 2048"
        ])
        .format("mp4")
        .on("end", resolve)
        .on("error", reject)
        .save(outputPath);
    });

    const stat = await fs.stat(outputPath);

    res.setHeader("Content-Type", "video/mp4");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${outputName}"`
    );
    res.setHeader("Content-Length", String(stat.size));

    res.sendFile(outputPath, async error => {
      await Promise.allSettled([
        fs.unlink(inputPath),
        fs.unlink(outputPath)
      ]);

      if (error && !res.headersSent) {
        res.status(500).json({ error: "Failed to send MP4." });
      }
    });
  } catch (error) {
    console.error(error);

    await Promise.allSettled([
      fs.unlink(inputPath),
      fs.unlink(outputPath)
    ]);

    res.status(500).json({
      error: "MP4 conversion failed.",
      details: process.env.NODE_ENV === "development"
        ? String(error?.message || error)
        : undefined
    });
  }
});

app.use((error, _req, res, _next) => {
  console.error(error);

  if (error instanceof multer.MulterError) {
    res.status(400).json({
      error: error.code === "LIMIT_FILE_SIZE"
        ? "Video is too large."
        : error.message
    });
    return;
  }

  res.status(500).json({ error: "Unexpected server error." });
});

app.listen(port, () => {
  console.log(`MP4 service listening on port ${port}`);
});
