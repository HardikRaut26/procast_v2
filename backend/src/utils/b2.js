import B2 from "backblaze-b2";
import axios from "axios";
import fs from "fs";
import path from "path";


const b2 = new B2({
  applicationKeyId: process.env.B2_KEY_ID,
  applicationKey: process.env.B2_APP_KEY,
});

let authorized = false;
let apiUrl = null;
let downloadUrl = null;
let authToken = null;

// Local cache to reduce repeated B2 downloads.
// Helps prevent UI breakage when B2 returns `403 download_cap_exceeded`.
const CACHE_DIR = process.env.B2_CACHE_DIR || path.join(process.cwd(), ".b2cache");
const CACHE_TTL_MS = Number(process.env.B2_CACHE_TTL_MS || String(5 * 60 * 1000)); // 5 minutes

async function ensureAuth() {
  if (authorized) return;

  const res = await b2.authorize();
  apiUrl = res.data.apiUrl;
  downloadUrl = res.data.downloadUrl;
  authToken = res.data.authorizationToken;
  authorized = true;
}

async function ensureCacheDir() {
  await fs.promises.mkdir(CACHE_DIR, { recursive: true });
}

async function isCacheFresh(filePath) {
  try {
    const st = await fs.promises.stat(filePath);
    return Date.now() - st.mtimeMs <= CACHE_TTL_MS;
  } catch {
    return false;
  }
}

/* ===================== UPLOAD ===================== */
export const uploadToB2 = async ({ buffer, fileName, contentType }) => {
  await ensureAuth();

  const attempts = Number(process.env.B2_UPLOAD_RETRY_ATTEMPTS || "5");
  const baseDelayMs = Number(process.env.B2_UPLOAD_RETRY_DELAY_MS || "400");
  let lastErr = null;

  for (let i = 0; i < attempts; i++) {
    try {
      const { data: uploadData } = await b2.getUploadUrl({
        bucketId: process.env.B2_BUCKET_ID,
      });

      const res = await b2.uploadFile({
        uploadUrl: uploadData.uploadUrl,
        uploadAuthToken: uploadData.authorizationToken,
        fileName,
        data: buffer,
        contentType: contentType || "application/octet-stream",
      });

      return res.data;
    } catch (err) {
      lastErr = err;
      const status = err?.response?.status || err?.status || err?.statusCode;
      const msg = String(err?.response?.data?.message || err?.message || "");
      const causeMsg = String(err?.cause?.message || "");
      const code = err?.code || err?.cause?.code;
      const errno = err?.errno ?? err?.cause?.errno;
      const netRetryable =
        code === "ENOTFOUND" ||
        code === "ECONNRESET" ||
        code === "ETIMEDOUT" ||
        code === "EAI_AGAIN" ||
        code === "ECONNREFUSED" ||
        errno === -3008 ||
        errno === -3001 ||
        msg.includes("getaddrinfo") ||
        msg.includes("socket hang up") ||
        causeMsg.includes("getaddrinfo");
      const retryable =
        netRetryable ||
        status === 503 ||
        status === 429 ||
        msg.toLowerCase().includes("service_unavailable") ||
        msg.toLowerCase().includes("no tomes") ||
        msg.toLowerCase().includes("try again");

      if (!retryable || i === attempts - 1) break;

      const delay = Math.min(5000, baseDelayMs * Math.pow(2, i));
      await new Promise((r) => setTimeout(r, delay));
    }
  }

  throw lastErr || new Error("B2 upload failed");
};

/* ===================== DOWNLOAD (NEW) ===================== */
export const downloadFromB2 = async ({ fileId, downloadPath }) => {
  if (!fileId) {
    throw new Error("fileId missing for download");
  }

  await ensureAuth();

  const response = await b2.downloadFileById({
    fileId,
    responseType: "stream",
  });

  await new Promise((resolve, reject) => {
    const writer = fs.createWriteStream(downloadPath);
    const src = response.data;

    src.on("error", reject);
    writer.on("error", reject);
    writer.on("finish", resolve);

    src.pipe(writer);
  });

  // Extra validation: avoid saving a corrupted/error payload as a .webm/.txt.
  const st = await fs.promises.stat(downloadPath).catch(() => null);
  if (!st || !Number.isFinite(st.size) || st.size < 1024) {
    throw new Error(`B2 download produced an invalid file for ${fileId} (size=${st?.size ?? "unknown"})`);
  }
};

/* ===================== DELETE FILE ===================== */
export const deleteFromB2 = async (fileId) => {
  if (!fileId) throw new Error("fileId required");

  await ensureAuth();

  // Get real file info
  const info = await b2.getFileInfo({ fileId });

  const realFileName = info.data.fileName;

  // Delete using correct name
  await b2.deleteFileVersion({
    fileId,
    fileName: realFileName,
  });

  console.log("🗑 Deleted file from B2:", realFileName);
};



/* ===================== STREAM FILE TO RESPONSE (inline or attachment) ===================== */
export const streamFileToResponse = async (fileId, res, options = {}) => {
  const { download = true } = options;
  if (!fileId) throw new Error("fileId missing");

  await ensureAuth();

  const fileInfo = await b2.getFileInfo({ fileId });
  const fileName = fileInfo.data.fileName;
  const displayName = fileName.split("/").pop() || "recording.webm";

  await ensureCacheDir();

  const ext = path.extname(displayName) || "";
  const cachePath = path.join(CACHE_DIR, `${fileId}${ext || ".bin"}`);

  const contentTypeFromDisplayName = (name) => {
    let contentType = "application/octet-stream";
    const lower = String(name || "").toLowerCase();
    if (lower.endsWith(".webm")) contentType = "video/webm";
    else if (lower.endsWith(".mp4")) contentType = "video/mp4";
    else if (lower.endsWith(".txt")) contentType = "text/plain; charset=utf-8";
    return contentType;
  };

  // If we already have a fresh cached copy, serve it directly.
  if (await isCacheFresh(cachePath)) {
    const rs = fs.createReadStream(cachePath);
    rs.on("error", () => res.end());
    let contentType = contentTypeFromDisplayName(displayName);
    const disposition = download ? "attachment" : "inline";
    res.setHeader("Content-Disposition", `${disposition}; filename="${displayName}"`);
    res.setHeader("Content-Type", contentType);
    rs.pipe(res);
    return;
  }

  const response = await b2.downloadFileById({
    fileId,
    responseType: "stream",
  });

  const contentType = contentTypeFromDisplayName(displayName);

  const disposition = download ? "attachment" : "inline";
  res.setHeader("Content-Disposition", `${disposition}; filename="${displayName}"`);
  res.setHeader("Content-Type", contentType);

  // Download once to cache, then stream from cache to the client.
  const tmpPath = `${cachePath}.tmp-${Date.now()}`;
  try {
    await new Promise((resolve, reject) => {
      const writer = fs.createWriteStream(tmpPath);
      response.data.pipe(writer);
      writer.on("finish", resolve);
      writer.on("error", reject);
    });

    await fs.promises
      .rename(tmpPath, cachePath)
      .catch(async () => {
        // If rename fails (e.g. target exists), copy then remove tmp.
        await fs.promises.copyFile(tmpPath, cachePath);
        await fs.promises.unlink(tmpPath).catch(() => {});
      })
      .catch(() => {});

    const rs = fs.createReadStream(cachePath);
    rs.on("error", () => res.end());
    rs.pipe(res);
  } finally {
    await fs.promises.unlink(tmpPath).catch(() => {});
  }
};

/* ===================== DOWNLOAD URL ===================== */
export const getDownloadUrl = async (fileId) => {
  if (!fileId) return null;

  await ensureAuth();

  // Get file info from B2
  const res = await b2.getFileInfo({ fileId });

  const fileName = res.data.fileName;

  // Generate signed streaming URL
  return `${downloadUrl}/file/${process.env.B2_BUCKET_NAME}/${fileName}?Authorization=${authToken}`;
};
