import * as dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { init } from "./api.js";
import { initCertificateFromFiles, initTrustedCertificates } from "./helpers/certificate-loader.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load .env from project root (parent of src)
const envPath = join(__dirname, "..", ".env");
console.log("Loading .env from:", envPath);
const dotenvResult = dotenv.config({ path: envPath });
if (dotenvResult.error) {
  console.error("Error loading .env:", dotenvResult.error);
} else {
  console.log(".env loaded successfully");
  console.log("NODE_ENV from .env:", process.env.NODE_ENV);
}

// Load certificate config from files if paths are specified
try {
  initCertificateFromFiles();
} catch (error) {
  console.error("Certificate initialization failed:", error);
  process.exit(1);
}

// Load trusted certificates for credential verification
initTrustedCertificates();

const port = process.env.OID4VP_PORT || 3000;
const cwd = process.cwd();

console.info("cwd", cwd);
console.info("Starting OID4VP Verifier...");

try {
  const { app } = await init();

  app.listen(port, () => {
    console.log(`OID4VP Verifier running on port: ${port}`);
  });
} catch (e) {
  console.error("Failed to initialize OID4VP Verifier", e);
  process.exit(1);
}
