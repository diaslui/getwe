import { spawn, type ChildProcess } from "child_process";
import type { Readable } from "stream";

export interface VideoFormat {
  formatId: string;
  ext: string;
  resolution: string | null;
  height: number | null;
  width: number | null;
  fps: number | null;
  vcodec: string;
  acodec: string;
  filesize: number | null;
  tbr: number | null;
  quality: string;
  hasVideo: boolean;
  hasAudio: boolean;
}

export interface AudioFormat {
  formatId: string;
  ext: string;
  acodec: string;
  abr: number | null;
  asr: number | null;
  filesize: number | null;
  quality: string;
}

export interface VideoInfo {
  id: string;
  url: string;
  title: string;
  description: string | null;
  duration: number;
  thumbnail: string;
  uploader: string | null;
  uploadDate: string | null;
  viewCount: number | null;
  likeCount: number | null;
  channel: string | null;
  channelUrl: string | null;
  videoFormats: VideoFormat[];
  audioFormats: AudioFormat[];
  bestVideoFormat: VideoFormat | null;
  bestAudioFormat: AudioFormat | null;
}

export interface InspectResult {
  count: number;
  mode: "single" | "multi";
  videos: VideoInfo[];
}

export interface DownloadOptions {
  url: string;
  formatId?: string;
  outputType: "video" | "audio";
  mergeOutputFormat?: "mp4" | "mkv" | "webm";
  audioFormat?: "mp3" | "m4a" | "opus" | "best";
}

export interface DownloadProgress {
  progress: number;
  speed: string;
  eta: string;
  status: "downloading" | "merging" | "done" | "error";
}

const parseResolution = (format: any): string | null => {
  if (format.height && format.width) {
    return `${format.width}x${format.height}`;
  }
  if (format.height) {
    return `${format.height}p`;
  }
  return format.resolution || null;
};

const getQualityLabel = (format: any): string => {
  if (format.height) {
    const fps = format.fps && format.fps > 30 ? format.fps : null;
    return fps ? `${format.height}p${fps}` : `${format.height}p`;
  }
  if (format.abr) {
    return `${Math.round(format.abr)}kbps`;
  }
  return format.format_note || "unknown";
};

const isVideoFormat = (format: any): boolean => {
  return format.vcodec && format.vcodec !== "none";
};

const isAudioOnlyFormat = (format: any): boolean => {
  return (
    format.acodec &&
    format.acodec !== "none" &&
    (!format.vcodec || format.vcodec === "none")
  );
};

const processVideoFormat = (format: any): VideoFormat => ({
  formatId: format.format_id,
  ext: format.ext,
  resolution: parseResolution(format),
  height: format.height || null,
  width: format.width || null,
  fps: format.fps || null,
  vcodec: format.vcodec || "none",
  acodec: format.acodec || "none",
  filesize: format.filesize || format.filesize_approx || null,
  tbr: format.tbr || null,
  quality: getQualityLabel(format),
  hasVideo: isVideoFormat(format),
  hasAudio: format.acodec && format.acodec !== "none",
});

const processAudioFormat = (format: any): AudioFormat => ({
  formatId: format.format_id,
  ext: format.ext,
  acodec: format.acodec || "unknown",
  abr: format.abr || null,
  asr: format.asr || null,
  filesize: format.filesize || format.filesize_approx || null,
  quality: getQualityLabel(format),
});

const sortVideoFormats = (formats: VideoFormat[]): VideoFormat[] => {
  return formats.sort((a, b) => {
    const heightDiff = (b.height || 0) - (a.height || 0);
    if (heightDiff !== 0) return heightDiff;
    const fpsDiff = (b.fps || 0) - (a.fps || 0);
    if (fpsDiff !== 0) return fpsDiff;
    return (b.tbr || 0) - (a.tbr || 0);
  });
};

const sortAudioFormats = (formats: AudioFormat[]): AudioFormat[] => {
  return formats.sort((a, b) => (b.abr || 0) - (a.abr || 0));
};

class YtDlpService {
  private ytdlpPath: string = "yt-dlp";

  private async execJson(args: string[]): Promise<any> {
    return new Promise((resolve, reject) => {
      const proc = spawn(this.ytdlpPath, args);
      let stdout = "";
      let stderr = "";

      proc.stdout.on("data", (data) => {
        stdout += data.toString();
      });

      proc.stderr.on("data", (data) => {
        stderr += data.toString();
      });

      proc.on("close", (code) => {
        if (code === 0) {
          try {
            resolve(JSON.parse(stdout));
          } catch {
            reject(new Error(`Failed to parse JSON: ${stdout}`));
          }
        } else {
          reject(new Error(`yt-dlp failed: ${stderr}`));
        }
      });

      proc.on("error", (err) => {
        reject(new Error(`Failed to spawn yt-dlp: ${err.message}`));
      });
    });
  }

  async getVideoInfo(url: string): Promise<VideoInfo> {
    try {
      const info = await this.execJson([
        "--dump-single-json",
        "--no-warnings",
        "--no-playlist",
        url,
      ]);

      const formats = info.formats || [];

      const videoFormats = formats
        .filter(
          (f: any) =>
            isVideoFormat(f) && f.ext && ["mp4", "webm", "mkv"].includes(f.ext),
        )
        .map(processVideoFormat);

      const audioFormats = formats
        .filter(
          (f: any) =>
            isAudioOnlyFormat(f) &&
            f.ext &&
            ["m4a", "webm", "opus", "mp3", "ogg"].includes(f.ext),
        )
        .map(processAudioFormat);

      const sortedVideoFormats = sortVideoFormats(videoFormats);
      const sortedAudioFormats = sortAudioFormats(audioFormats);
      const uniqueVideoFormats =
        this.deduplicateVideoFormats(sortedVideoFormats);
      const uniqueAudioFormats =
        this.deduplicateAudioFormats(sortedAudioFormats);

      return {
        id: info.id,
        url: url,
        title: info.title,
        description: info.description || null,
        duration: info.duration || 0,
        thumbnail: info.thumbnail || info.thumbnails?.[0]?.url || "",
        uploader: info.uploader || null,
        uploadDate: info.upload_date || null,
        viewCount: info.view_count || null,
        likeCount: info.like_count || null,
        channel: info.channel || null,
        channelUrl: info.channel_url || null,
        videoFormats: uniqueVideoFormats,
        audioFormats: uniqueAudioFormats,
        bestVideoFormat: uniqueVideoFormats[0] || null,
        bestAudioFormat: uniqueAudioFormats[0] || null,
      };
    } catch (error: any) {
      console.error("YtDlpService.getVideoInfo error:", error.message);
      throw new Error(`Failed to get video info: ${error.message}`);
    }
  }

  async getMultipleVideoInfo(urls: string[]): Promise<VideoInfo[]> {
    const results = await Promise.allSettled(
      urls.map((url) => this.getVideoInfo(url)),
    );

    return results
      .filter(
        (result): result is PromiseFulfilledResult<VideoInfo> =>
          result.status === "fulfilled",
      )
      .map((result) => result.value);
  }

  async inspect(urls: string[]): Promise<InspectResult> {
    const detailed = urls.length === 1;

    if (detailed && urls[0]) {
      const video = await this.getVideoInfo(urls[0]);
      return {
        count: 1,
        mode: "single",
        videos: [video],
      };
    }

    const videos = await this.getMultipleVideoInfo(urls);
    return {
      count: videos.length,
      mode: "multi",
      videos,
    };
  }

  buildVideoFormatString(formatId?: string): string {
    if (formatId) {
      return `${formatId}+bestaudio/best`;
    }
    return "bv*[ext=mp4]+ba[ext=m4a]/bv*+ba/best";
  }

  buildAudioFormatString(formatId?: string): string {
    if (formatId && formatId !== "best") {
      return formatId;
    }
    return "bestaudio/best";
  }

  download(options: DownloadOptions): {
    process: ChildProcess;
    stdout: Readable;
    kill: () => void;
    parseProgress: (data: Buffer) => DownloadProgress | null;
  } {
    const args: string[] = ["--no-warnings", "--newline", "-o", "-"];

    if (options.outputType === "audio") {
      const formatStr = this.buildAudioFormatString(options.formatId);
      args.push("-f", formatStr);

      if (options.audioFormat && options.audioFormat !== "best") {
        args.push("-x", "--audio-format", options.audioFormat);
      }
    } else {
      const formatStr = this.buildVideoFormatString(options.formatId);
      args.push("-f", formatStr);
      const mergeFormat = options.mergeOutputFormat || "mp4";
      args.push("--merge-output-format", mergeFormat);
    }

    args.push(options.url);

    const proc = spawn(this.ytdlpPath, args);

    const parseProgress = (data: Buffer): DownloadProgress | null => {
      const text = data.toString();

      if (text.includes("[Merger]") || text.includes("Merging")) {
        return {
          progress: 99,
          speed: "N/A",
          eta: "N/A",
          status: "merging",
        };
      }

      const progressMatch = text.match(/(\d+\.?\d*)%/);
      if (progressMatch && progressMatch[1]) {
        const speedMatch = text.match(/(\d+\.?\d*\s*[KMG]?i?B\/s)/i);
        const etaMatch = text.match(/ETA\s+(\d+:\d+)/);

        return {
          progress: parseFloat(progressMatch[1]),
          speed: speedMatch?.[1] || "N/A",
          eta: etaMatch?.[1] || "N/A",
          status: "downloading",
        };
      }

      return null;
    };

    return {
      process: proc,
      stdout: proc.stdout as Readable,
      kill: () => proc.kill("SIGKILL"),
      parseProgress,
    };
  }

  downloadWithProgress(
    options: DownloadOptions,
    onProgress: (progress: DownloadProgress) => void,
  ): {
    process: ChildProcess;
    stdout: Readable;
    kill: () => void;
  } {
    const {
      process: proc,
      stdout,
      kill,
      parseProgress,
    } = this.download(options);

    proc.stderr?.on("data", (data: Buffer) => {
      const progress = parseProgress(data);
      if (progress) {
        onProgress(progress);
      }
    });

    return { process: proc, stdout, kill };
  }

  getOutputExtension(options: DownloadOptions): string {
    if (options.outputType === "audio") {
      return options.audioFormat || "m4a";
    }
    return options.mergeOutputFormat || "mp4";
  }

  private deduplicateVideoFormats(formats: VideoFormat[]): VideoFormat[] {
    const seen = new Map<string, VideoFormat>();

    for (const format of formats) {
      const key = `${format.height || 0}-${format.fps || 0}`;

      if (!seen.has(key)) {
        seen.set(key, format);
      } else {
        const existing = seen.get(key)!;
        if ((format.filesize || 0) > (existing.filesize || 0)) {
          seen.set(key, format);
        }
      }
    }

    return Array.from(seen.values());
  }

  private deduplicateAudioFormats(formats: AudioFormat[]): AudioFormat[] {
    const seen = new Map<string, AudioFormat>();

    for (const format of formats) {
      const key = `${format.ext}-${Math.round((format.abr || 0) / 10) * 10}`;

      if (!seen.has(key)) {
        seen.set(key, format);
      } else {
        const existing = seen.get(key)!;
        if ((format.abr || 0) > (existing.abr || 0)) {
          seen.set(key, format);
        }
      }
    }

    return Array.from(seen.values());
  }
}

export const ytdlpService = new YtDlpService();

export { YtDlpService };
