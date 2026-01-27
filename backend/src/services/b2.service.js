import axios from "axios";

let cachedAuth = null;

export const authorizeB2 = async () => {
  if (cachedAuth) return cachedAuth;

  const auth = Buffer.from(
    `${process.env.B2_KEY_ID}:${process.env.B2_APP_KEY}`
  ).toString("base64");

  const res = await axios.get(
    "https://api.backblazeb2.com/b2api/v2/b2_authorize_account",
    {
      headers: { Authorization: `Basic ${auth}` },
    }
  );

  cachedAuth = res.data;
  return cachedAuth;
};

export const getUploadUrl = async () => {
  const auth = await authorizeB2();

  const res = await axios.post(
    `${auth.apiUrl}/b2api/v2/b2_get_upload_url`,
    { bucketId: process.env.B2_BUCKET_ID },
    { headers: { Authorization: auth.authorizationToken } }
  );

  return res.data;
};
