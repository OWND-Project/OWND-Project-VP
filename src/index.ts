import * as dotenv from "dotenv";
import { init } from "./api.js";

dotenv.config();

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
