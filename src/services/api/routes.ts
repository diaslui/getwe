import { Router } from "express";
import type { Request, Response } from "express";
import { createJob, getJob, deleteJob, updateJob } from "./storage.ts";
import {
  ytdlpService,
  type VideoInfo,
  type DownloadProgress,
} from "../ytdlp/index.ts";

const routes = Router();

routes.post("/inspect", async (req: Request, res: Response) => {
  const { urls } = req.body;

  if (!Array.isArray(urls) || urls.length === 0) {
    return res.status(400).json({ error: "urls must be a non-empty array" });
  }

  try {
    const result = await ytdlpService.inspect(urls);

    const transformedVideos = result.videos.map((video: VideoInfo) => {
      if (result.mode === "single") {
        return {
          id: video.id,
          url: video.url,
          title: video.title,
          duration: video.duration,
          thumbnail: video.thumbnail,
          uploader: video.uploader,
          channel: video.channel,
          formats: video.videoFormats.map((f) => ({
            formatId: f.formatId,
            label: f.quality,
            ext: f.ext,
            resolution: f.resolution,
            height: f.height,
            fps: f.fps,
            filesize: f.filesize,
            hasAudio: f.hasAudio,
            vcodec: f.vcodec,
          })),
          audio: video.audioFormats.map((f) => ({
            formatId: f.formatId,
            ext: f.ext,
            bitrate: f.abr,
            quality: f.quality,
            filesize: f.filesize,
            acodec: f.acodec,
          })),
        };
      } else {
        return {
          id: video.id,
          url: video.url,
          title: video.title,
          duration: video.duration,
          thumbnail: video.thumbnail,
          bestFormat: video.bestVideoFormat
            ? {
                formatId: video.bestVideoFormat.formatId,
                label: video.bestVideoFormat.quality,
                filesize: video.bestVideoFormat.filesize,
              }
            : null,
        };
      }
    });

    res.json({
      count: result.count,
      mode: result.mode,
      videos: transformedVideos,
    });
  } catch (error: any) {
    console.error("Inspect error:", error.message);
    res.status(500).json({ error: error.message || "Failed to inspect URLs" });
  }
});

routes.post("/download/create", async (req: Request, res: Response) => {
  const { urls, outputType, outputFormat, formatId } = req.body;

  if (!Array.isArray(urls) || urls.length === 0) {
    return res.status(400).json({ error: "urls must be a non-empty array" });
  }

  const jobId =
    Math.random().toString(36).substring(2, 10) +
    Date.now().toString(36).substring(4, 10);

  createJob({
    id: jobId,
    urls,
    outputType: outputType || "video",
    outputFormat: outputFormat || "mp4",
    formatId: formatId || null,
    status: "idle",
    progress: 0,
    speed: null,
    eta: null,
  });

  res.json({
    jobId,
    sseUrl: "/api/download/sse/" + jobId,
    streamUrl: "/api/download/stream/" + jobId,
    message: "Download job created",
  });
});

routes.get("/download/stream/:jobId", async (req: Request, res: Response) => {
  const { jobId } = req.params;

  if (!jobId) {
    return res.status(400).json({ error: "jobId is required" });
  }

  const job = getJob(jobId.toString());

  if (!job) {
    return res.status(404).json({ error: "Job not found" });
  }

  if (job.status === "running") {
    return res.status(409).json({ error: "Job already running" });
  }

  job.status = "running";
  job.progress = 0;
  updateJob(job);

  const ext = ytdlpService.getOutputExtension({
    url: job.urls[0] || "",
    outputType: job.outputType,
    mergeOutputFormat: job.outputFormat as "mp4" | "mkv" | "webm",
    audioFormat: job.outputFormat as "mp3" | "m4a" | "opus" | "best",
  });

  const filename = "download-" + jobId + "." + ext;

  res.setHeader("Content-Type", "application/octet-stream");
  res.setHeader("Content-Disposition", 'attachment; filename="' + filename + '"');
  res.setHeader("Transfer-Encoding", "chunked");

  const { stdout, kill } = ytdlpService.downloadWithProgress(
    {
      url: job.urls[0] || "",
      ...(job.formatId ? { formatId: job.formatId } : {}),
      outputType: job.outputType,
      mergeOutputFormat: job.outputFormat as "mp4" | "mkv" | "webm",
      audioFormat: job.outputFormat as "mp3" | "m4a" | "opus" | "best",
    } as any,
    (progress: DownloadProgress) => {
      job.progress = progress.progress;
      job.speed = progress.speed;
      job.eta = progress.eta;
      job.downloadStatus = progress.status;
      updateJob(job);
    }
  );

  stdout.pipe(res);

  stdout.on("end", () => {
    job.progress = 100;
    job.status = "done";
    job.downloadStatus = "done";
    updateJob(job);
    setTimeout(() => deleteJob(job.id), 30000);
  });

  stdout.on("error", (err) => {
    console.error("Download stream error:", err);
    job.status = "error";
    job.downloadStatus = "error";
    updateJob(job);
  });

  req.on("close", () => {
    kill();
    if (job.status === "running") {
      job.status = "error";
      updateJob(job);
    }
  });
});

routes.get("/download/sse/:jobId", (req: Request, res: Response) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");

  const { jobId } = req.params;

  if (!jobId) {
    res.write('data: {"error":"jobId is required"}\n\n');
    return res.end();
  }

  const worker = setInterval(() => {
    const job = getJob(jobId.toString());

    if (!job) {
      res.write('data: {"error":"Job not found"}\n\n');
      clearInterval(worker);
      return res.end();
    }

    const data = JSON.stringify({
      progress: job.progress,
      status: job.status,
      speed: job.speed || null,
      eta: job.eta || null,
      downloadStatus: job.downloadStatus || null,
    });

    res.write("data: " + data + "\n\n");

    if (job.status === "done" || job.status === "error") {
      clearInterval(worker);
      res.end();
    }
  }, 300);

  req.on("close", () => {
    clearInterval(worker);
    res.end();
  });
});

routes.get("/download/status/:jobId", (req: Request, res: Response) => {
  const { jobId } = req.params;

  if (!jobId) {
    return res.status(400).json({ error: "jobId is required" });
  }

  const job = getJob(jobId.toString());

  if (!job) {
    return res.status(404).json({ error: "Job not found" });
  }

  res.json({
    id: job.id,
    status: job.status,
    progress: job.progress,
    speed: job.speed,
    eta: job.eta,
    outputType: job.outputType,
    outputFormat: job.outputFormat,
  });
});

export default routes;
