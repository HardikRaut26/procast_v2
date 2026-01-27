import B2 from "backblaze-b2";
import axios from "axios";
import "dotenv/config";
import fs from "fs";


const b2 = new B2({
  applicationKeyId: process.env.B2_KEY_ID,
  applicationKey: process.env.B2_APP_KEY,
});

let authorized = false;
let apiUrl = null;
let downloadUrl = null;
let authToken = null;

async function ensureAuth() {
  if (authorized) return;

  const res = await b2.authorize();
  apiUrl = res.data.apiUrl;
  downloadUrl = res.data.downloadUrl;
  authToken = res.data.authorizationToken;
  authorized = true;
}

/* ===================== UPLOAD ===================== */
export const uploadToB2 = async ({ buffer, fileName, contentType }) => {
  await ensureAuth();

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
    response.data.pipe(writer);
    writer.on("finish", resolve);
    writer.on("error", reject);
  });
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
