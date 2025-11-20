import { Middleware } from "koa";
import getLogger from "../services/logging-service.js";

const logger = getLogger();

/**
 * Parse Basic authentication header
 */
function parseBasicAuth(authHeader: string): { username: string; password: string } | null {
  if (!authHeader || !authHeader.startsWith("Basic ")) {
    return null;
  }

  try {
    const base64Credentials = authHeader.substring(6);
    const credentials = Buffer.from(base64Credentials, "base64").toString("utf-8");
    const [username, password] = credentials.split(":");
    return { username, password };
  } catch (error) {
    return null;
  }
}

/**
 * Admin authentication middleware
 * Protects admin routes with Basic authentication
 */
export const adminAuthMiddleware = (): Middleware => {
  // Check if admin debug interface is enabled
  const enabled = process.env.ADMIN_DEBUG_ENABLED === "true";

  if (!enabled) {
    // If disabled, return 404 for all admin routes
    return async (ctx, next) => {
      logger.warn("Admin debug interface is disabled");
      ctx.status = 404;
      ctx.body = "Not Found";
    };
  }

  // Get credentials from environment variables
  const expectedUsername = process.env.ADMIN_DEBUG_USERNAME || "admin";
  const expectedPassword = process.env.ADMIN_DEBUG_PASSWORD || "admin";

  return async (ctx, next) => {
    const authHeader = ctx.get("Authorization");
    const credentials = parseBasicAuth(authHeader);

    if (!credentials ||
        credentials.username !== expectedUsername ||
        credentials.password !== expectedPassword) {
      // Authentication failed
      logger.warn(`Admin authentication failed from ${ctx.ip}`);
      ctx.status = 401;
      ctx.set("WWW-Authenticate", 'Basic realm="Admin Area"');
      ctx.body = "Authentication required";
      return;
    }

    // Authentication successful
    logger.info(`Admin access: ${ctx.path} from ${ctx.ip}`);
    await next();
  };
};
