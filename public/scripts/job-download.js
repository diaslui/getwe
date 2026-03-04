const eRefs = {
  itpProgressBar: "#itpProgressBar",
  progressCircle: "#progressCircle",
  progressPercent: "#progressPercent",
  linearProgress: "#linearProgress",
  speedInfo: "#speedInfo",
  etaInfo: "#etaInfo",
  statusInfo: "#statusInfo",
  loadingState: "#loadingState",
  completedState: "#completedState",
  completedThumbnail: "#completedThumbnail",
  completedTitle: "#completedTitle",
  completedFormat: "#completedFormat",
  completedSize: "#completedSize",
  retryDownloadBtn: "#retryDownloadBtn",
};

const domRefs = {};
let sseInstance = null;
let downloadStarted = false;
let downloadInfo = {
  filename: "download",
  filesize: 0,
  format: "MP4",
  title: "Vídeo",
  thumbnail: "",
  blobUrl: null,
};

const loadElements = async () => {
  for (const [key, selector] of Object.entries(eRefs)) {
    domRefs[key] = document.querySelector(selector);
  }
};

const showCompletedState = () => {
  if (domRefs.loadingState) {
    domRefs.loadingState.classList.add("hidden");
  }

  if (domRefs.completedState) {
    domRefs.completedState.classList.remove("hidden");
    domRefs.completedState.classList.add("flex");
  }

  if (domRefs.completedThumbnail && downloadInfo.thumbnail) {
    domRefs.completedThumbnail.src = downloadInfo.thumbnail;
  }

  if (domRefs.completedTitle) {
    domRefs.completedTitle.textContent = downloadInfo.title || "Vídeo baixado";
  }

  if (domRefs.completedFormat) {
    domRefs.completedFormat.textContent = downloadInfo.format.toUpperCase();
  }

  if (domRefs.completedSize) {
    domRefs.completedSize.textContent = formatBytes(downloadInfo.filesize);
  }

  if (domRefs.itpProgressBar) {
    domRefs.itpProgressBar.style.width = "100%";
  }
};

const updateProgress = (data) => {
  const value = data.progress || 0;

  if (domRefs.itpProgressBar) {
    domRefs.itpProgressBar.style.width = value + "%";
  }

  const circle = domRefs.progressCircle;
  if (circle) {
    const circumference = 2 * Math.PI * 56;
    const offset = circumference - (value / 100) * circumference;
    circle.style.strokeDashoffset = offset;
  }

  if (domRefs.progressPercent) {
    domRefs.progressPercent.textContent = Math.round(value) + "%";
  }

  if (domRefs.linearProgress) {
    domRefs.linearProgress.style.width = value + "%";
  }

  if (domRefs.speedInfo && data.speed) {
    domRefs.speedInfo.textContent = data.speed;
  }

  if (domRefs.etaInfo && data.eta) {
    domRefs.etaInfo.textContent = data.eta;
  }

  if (domRefs.statusInfo) {
    const statusMap = {
      downloading: "Baixando...",
      merging: "Processando vídeo...",
      done: "Concluído!",
      error: "Erro",
    };
    domRefs.statusInfo.textContent = statusMap[data.downloadStatus] || data.status || "Preparando...";
  }
};

const connectSSE = (sseUrl) => {
  return new Promise((resolve, reject) => {
    if (sseInstance) {
      sseInstance.close();
    }

    sseInstance = new EventSource(sseUrl);

    sseInstance.onmessage = (event) => {
      const data = JSON.parse(event.data);
      
      if (data.error) {
        console.error("SSE error:", data.error);
        sseInstance.close();
        reject(new Error(data.error));
        return;
      }

      updateProgress(data);

      if (data.status === "done" || data.status === "error") {
        sseInstance.close();
        if (data.status === "done") {
          resolve();
        } else {
          reject(new Error("Download failed"));
        }
      }
    };

    sseInstance.onerror = (error) => {
      console.error("SSE connection error:", error);
      sseInstance.close();
    };
  });
};

const triggerDownload = () => {
  if (!downloadInfo.blobUrl) return;
  
  const a = document.createElement("a");
  a.href = downloadInfo.blobUrl;
  a.download = downloadInfo.filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
};

const downloadFile = async (jobId) => {
  if (downloadStarted) return;
  downloadStarted = true;

  try {
    const response = await fetch("/api/download/stream/" + jobId);
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.error("Download failed:", errorData.error || response.statusText);
      if (domRefs.statusInfo) {
        domRefs.statusInfo.textContent = "Erro: " + (errorData.error || response.statusText);
      }
      return;
    }

    const blob = await response.blob();
    const contentDisposition = response.headers.get("Content-Disposition");
    let filename = "download";
    
    if (contentDisposition) {
      const match = contentDisposition.match(/filename="?(.+?)"?$/);
      if (match && match[1]) {
        filename = match[1];
      }
    }

    const extMatch = filename.match(/\.(\w+)$/);
    const format = extMatch ? extMatch[1] : "mp4";

    downloadInfo.filename = filename;
    downloadInfo.filesize = blob.size;
    downloadInfo.format = format;
    downloadInfo.blobUrl = window.URL.createObjectURL(blob);

    triggerDownload();

    showCompletedState();

  } catch (error) {
    console.error("Download error:", error);
    if (domRefs.statusInfo) {
      domRefs.statusInfo.textContent = "Erro ao baixar arquivo";
    }
  }
};

const loadVideoInfo = async (jobId) => {
  const storedInfo = localStorage.getItem("lastDownloadInfo");
  if (storedInfo) {
    try {
      const info = JSON.parse(storedInfo);
      downloadInfo.title = info.title || "Vídeo";
      downloadInfo.thumbnail = info.thumbnail || "";
      downloadInfo.format = info.format || "mp4";
    } catch (e) {
      console.warn("Could not parse stored download info");
    }
  }
};

const setupRetryButton = () => {
  const retryBtn = document.querySelector("#retryDownloadBtn") || 
    document.querySelector('button:has(svg path[d*="M4 16v1a3"])');
  
  if (retryBtn) {
    retryBtn.addEventListener("click", () => {
      triggerDownload();
    });
  }

  const manualRetryBtn = document.querySelector('.w-full.py-3.px-4.bg-itp-gray-100');
  if (manualRetryBtn) {
    manualRetryBtn.addEventListener("click", () => {
      triggerDownload();
    });
  }
};

const init = async () => {
  const thisJobId = window.location.pathname.split("/").pop();
  
  if (!thisJobId) {
    console.error("No job ID found");
    return;
  }

  await loadElements();
  await loadVideoInfo(thisJobId);
  setupRetryButton();
  
  connectSSE("/api/download/sse/" + thisJobId);
  downloadFile(thisJobId);
};

document.addEventListener("DOMContentLoaded", init);
