/**
 * Load backend/.env before any other module reads process.env.
 * Default dotenv only looks at cwd; running from repo root breaks keys in backend/.env.
 */
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.resolve(__dirname, "../../.env");
const result = dotenv.config({ path: envPath });
if (result.error && process.env.NODE_ENV !== "test") {
  console.warn(
    "[env] Could not load .env from",
    envPath,
    "(",
    result.error.message,
    ") — using process env only"
  );
}
