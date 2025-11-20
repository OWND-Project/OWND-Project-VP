import Koa from "koa";
import session, { opts } from "koa-session";
import Router from "koa-router";
import cors from "@koa/cors";
import render from "koa-ejs";
import serve from "koa-static";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import getLogger, { errorLogger } from "./services/logging-service.js";
import { toErrorBody } from "./routes/error-handler.js";
import oid4vpRoutes from "./routes/oid4vp-routes.js";
import uiRoutes from "./routes/ui-routes.js";
import routesLogger from "./middlewares/routes-logger.js";
import { AppContext } from "./types/app-types.js";
import { initClient } from "./database/sqlite-client.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// https://github.com/koajs/session
const CONFIG: Partial<opts> = {
  key: "koa.sess" /** (string) cookie key (default is koa.sess) */,
  /** (number || 'session') maxAge in ms (default is 1 days) */
  /** 'session' will result in a cookie that expires when session/browser is closed */
  /** Warning: If a session cookie is stolen, this cookie will never expire */
  maxAge: 60 * 60 * 1000,
  autoCommit: true /** (boolean) automatically commit headers (default true) */,
  overwrite: true /** (boolean) can overwrite or not (default true) */,
  httpOnly: true /** (boolean) httpOnly or not (default true) */,
  signed: true /** (boolean) signed or not (default true) */,
  rolling:
    false /** (boolean) Force a session identifier cookie to be set on every response. The expiration is reset to the original maxAge, resetting the expiration countdown. (default is false) */,
  renew:
    false /** (boolean) renew session when session is nearly expired, so we can always keep user logged in. (default is false)*/,
  // https://developer.mozilla.org/ja/docs/Web/HTTP/Headers/Set-Cookie#none
  // Respect the implementation of `logging-service.ts` for the environment identifier.
  secure: !(
    process.env.NODE_ENV === "local" || process.env.NODE_ENV === "test"
  ) /** (boolean) secure cookie*/,
  // https://github.com/koajs/session/issues/174
  sameSite: "none",
};

/**
 * OID4VP Verifierアプリケーションの初期化
 */
export const init = async () => {
  const logger = getLogger();

  // SQLiteクライアントの初期化
  const databaseFilePath =
    process.env.OID4VP_DATABASE_FILEPATH || "./oid4vp.sqlite";
  logger.info(`Initializing SQLite database: ${databaseFilePath}`);
  const sqliteClient = await initClient(databaseFilePath);

  const app = new Koa();
  app.keys = [process.env.OID4VP_COOKIE_SECRET || ""];

  // EJS setup
  render(app, {
    root: join(__dirname, "..", "views"),
    layout: false,
    viewExt: "ejs",
    cache: process.env.NODE_ENV === "production",
    debug: process.env.NODE_ENV !== "production",
  });

  // Static files
  app.use(serve(join(__dirname, "..", "public")));

  app.use(routesLogger());
  app.use(session(CONFIG, app));
  app.proxy = true;

  // エラーハンドリング
  app.use(async (ctx, next) => {
    try {
      await next();
    } catch (err) {
      errorLogger().log(err);
      ctx.status = 500;
      ctx.body = toErrorBody(
        "UNEXPECTED_ERROR",
        (err as unknown as any).message ?? "Unknown error",
      );
    }
  });

  // CORS設定（Verifier用）
  const appHost = process.env.APP_HOST || "http://localhost:3001";
  logger.info(`CORS origin: ${appHost}`);
  app.use(
    cors({
      origin: appHost,
      allowMethods: ["POST", "GET"],
      credentials: true,
    }),
  );

  // AppContextの作成
  const appContext: AppContext = {
    db: sqliteClient.db,
  };

  // UI routes
  const uiRouter = await uiRoutes.routes(appContext);
  app.use(uiRouter.routes()).use(uiRouter.allowedMethods());

  // OID4VP routes
  const oid4vpRouter = await oid4vpRoutes.routes(appContext);
  app.use(oid4vpRouter.routes()).use(oid4vpRouter.allowedMethods());

  // Health check
  const router = new Router();
  router.get(`/health-check`, async (ctx) => {
    ctx.status = 204;
  });
  app.use(router.routes()).use(router.allowedMethods());

  // Fallback handler
  app.use((ctx) => {
    logger.info(`fallback: ${JSON.stringify(ctx)}`);
    ctx.response.status = 400;
  });

  // Cleanup on exit
  const stopApp = async () => {
    logger.info("Stopping application...");
    await sqliteClient.destroy();
  };

  process.on("SIGINT", async () => {
    console.debug("on SIGINT");
    await stopApp();
    process.exit();
  });

  return { app, stopApp };
};

