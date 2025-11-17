import * as dotenv from "dotenv";

import { init } from "./api.js";
import { AppType } from "./types/app-types.js";

dotenv.config();

const port = process.env.APP_PORT || 3000;
const appType = process.env.APP_TYPE || "BOOL_NODE";

const cwd = process.cwd();
console.info("cwd", cwd);

try {
  const { app } = await init(appType as AppType);

  app.listen(port, () => {
    console.log(`running on port: ${port}`);
  });
} catch (e) {
  console.error("failed to init app", e);
  process.exit();
}
