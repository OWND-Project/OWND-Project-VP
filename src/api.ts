import Koa from "koa";
import session, { opts } from "koa-session";

import { getLibp2pOptions } from "./helpers/libp2p-helper.js";
import { adminRoutes } from "./routes/admin-routes.js";
import oid4vpRoutes from "./routes/oid4vp-routes.js";
import { Docs, setupNode } from "./orbit-db/index.js";
import { mainRoutes } from "./routes/main-routes.js";
import {
  AppContext,
  AppType,
  BoolNodeAppContext,
  BoolNodeType,
  VerifierNodeAppContext,
} from "./types/app-types.js";
import routesLogger from "./middlewares/routes-logger.js";
import { KeyValueType } from "./usecases/oid4vp-interactor.js";
import { loadAndUsePeerId } from "./helpers/get-peer-id.js";
import Router from "koa-router";
import cors from "@koa/cors";
import getLogger, { errorLogger } from "./services/logging-service.js";
import { onUpdate } from "./local-data/on-update.js";
import { replication } from "./local-data/replication.js";
import { syncers } from "./local-data/syncer.js";
import { toErrorBody } from "./routes/error-handler.js";

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

type BoolNode = Awaited<ReturnType<typeof initOrbitdb>>;
type VerifierNode = Awaited<ReturnType<typeof initOrbitdb4Verifier>>;

const workaroundAddProtocolScheme = (value: string) => {
  // Respect the implementation of `logging-service.ts` for the environment identifier.
  const env = process.env.NODE_ENV || "local";
  const isWithoutScheme =
    !value.startsWith("http://") && !value.startsWith("https://");
  if (isWithoutScheme) {
    if (env === "local") {
      return `http://${value}`;
    } else {
      return `https://${value}`;
    }
  }
  return value;
};

export const init = async (
  appType: AppType,
  opts: { boolNode?: BoolNode; verifierNode?: VerifierNode } = {},
) => {
  // const appContext: Partial<AppContext> = {type: appType};

  const logger = getLogger();

  const app = new Koa();
  // app.proxy = true;
  app.keys = [process.env.OID4VP_COOKIE_SECRET || ""];

  app.use(routesLogger());
  app.use(session(CONFIG, app));
  app.proxy = true;
  // app.use(before(appContext));
  // register fallback

  // エラーハンドリングの強化
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

  const appHost = process.env.APP_HOST || "http://localhost:3001";
  logger.info(
    `The original assumption is that the protocol scheme should be at the beginning of APP_HOST: ${appHost}`,
  );
  const appHostEnsuredScheme = workaroundAddProtocolScheme(appHost);
  logger.info(`Value after applying the workaround : ${appHostEnsuredScheme}`);
  logger.info(`backend application type : ${appType}`);
  if (appType === "BOOL_NODE") {
    // boolnode node allow only POST from app
    app.use(
      cors({
        origin: appHostEnsuredScheme,
        allowMethods: ["POST", "OPTIONS"],
      }),
    );
  } else if (appType === "VERIFIER_NODE") {
    // verifier allow GET,POST method from app
    app.use(
      cors({
        origin: appHostEnsuredScheme,
        allowMethods: ["POST", "GET"],
        credentials: true,
      }),
    );
  } else if (appType === "API_NODE") {
    // GET from Anywhere
    app.use(
      cors({
        origin: "*",
        allowMethods: ["GET"],
      }),
    );
  }

  let stopApp: () => Promise<void>;
  if (appType === "BOOL_NODE" || appType === "API_NODE") {
    let node, docs;
    if (!opts.boolNode) {
      ({ node, docs } = await initOrbitdb(appType));
    } else {
      ({ node, docs } = opts.boolNode);
    }
    stopApp = async () => {
      await docs.closeDocuments();
      await node.close();
    };
    const appContext: BoolNodeAppContext = {
      type: appType,
      node,
      docs,
    };

    // admin routes
    const adminRouter = await adminRoutes(appContext);
    app.use(adminRouter.routes()).use(adminRouter.allowedMethods());
    // main routes
    const mainRouter = await mainRoutes(appContext);
    app.use(mainRouter.routes()).use(mainRouter.allowedMethods());
  } else {
    let node, openedKeyValues;
    if (!opts.verifierNode) {
      ({ node, openedKeyValues } = await initOrbitdb4Verifier());
    } else {
      ({ node, openedKeyValues } = opts.verifierNode);
    }
    stopApp = async () => {
      await openedKeyValues.closeKeyValues();
      await node.close();
    };
    const appContext: VerifierNodeAppContext = {
      type: appType,
      node,
      openedKeyValues: openedKeyValues,
    };
    // oid4vp routes
    const oid4vpRouter = await oid4vpRoutes.routes(appContext);
    app.use(oid4vpRouter.routes()).use(oid4vpRouter.allowedMethods());
  }
  const router = new Router();
  router.get(`/health-check`, async (ctx) => {
    ctx.status = 204;
  });
  app.use(router.routes()).use(router.allowedMethods());

  app.use((ctx) => {
    logger.info(`fallback: ${JSON.stringify(ctx)}`);
    // Handler to return bad request for all unhandled paths.
    ctx.response.status = 400;
  });

  process.on("SIGINT", async () => {
    console.debug("on SIGINT");
    await stopApp();
    process.exit();
  });
  return { app, stopApp };
};

const before = (appContext: AppContext) => {
  return async (ctx: Koa.ParameterizedContext, next: Koa.Next) => {
    const path = ctx.request.path;
    // if (appContext.type === "BOOL_NODE" || appContext.type === "API_NODE") {
    //   if (!path.startsWith("/admin") && !appContext.docs) {
    //     ctx.body = { status: "error", message: "Illegal database status" };
    //     ctx.status = 400;
    //   } else {
    //     await next();
    //   }
    // } else {
    //   await next();
    // }
    await next();
  };
};

type OnUpdate = (entry: any) => Promise<void>;
export const getDocType = (onUpdates: {
  onUpdateClaims: OnUpdate;
  onUpdateUrls: OnUpdate;
  onUpdateAffiliations: OnUpdate;
}) => {
  const { onUpdateClaims, onUpdateUrls, onUpdateAffiliations } = onUpdates;
  return {
    urls: { name: "urls", indexBy: "id", onUpdate: onUpdateUrls },
    claimers: { name: "claimers", indexBy: "id" },
    claims: { name: "claims", indexBy: "id", onUpdate: onUpdateClaims },
    affiliates: {
      name: "affiliations",
      indexBy: "id",
      onUpdate: onUpdateAffiliations,
    },
  };
};

const initOrbitdb = async (nodeType: BoolNodeType) => {
  const logger = getLogger();
  // const listenAddresses = process.env.PEER_ADDR;
  const listenAddresses = process.env.PEER_ADDR
    ? process.env.PEER_ADDR.split(",").map((addr) => addr.trim())
    : [];
  const orbitdbRootIdKey = process.env.ORBITDB_ROOT_ID_KEY || "main_peer";

  const ipfsPath = process.env.IPFS_PATH || "./ipfs/blocks";
  const orbitdbPath = process.env.ORBITDB_PATH || "./orbitdb";
  const keystorePath = process.env.KEYSTORE_PATH;
  logger.info(`ipfs:${ipfsPath}`);
  logger.info(`orbitdb:${orbitdbPath}`);
  logger.info(`keystore:${keystorePath}`);

  const libP2pOpts: Parameters<typeof getLibp2pOptions>[0] = {
    listenAddresses,
  };
  if (nodeType === "BOOL_NODE") {
    const peerPath = process.env.PEER_ID_PATH || "./peer-id.bin";
    const peerId = await loadAndUsePeerId(peerPath);
    logger.info(`peerId: ${peerId}`);
    libP2pOpts.peerId = peerId;
  }
  const opt = getLibp2pOptions(libP2pOpts);

  try {
    const node = await setupNode(opt, {
      ipfsPath,
      orbitdbPath,
      keystorePath,
      identityKey: orbitdbRootIdKey,
    });

    const databaseFilePath =
      process.env.DATABASE_FILEPATH || "./database.sqlite";
    const __syncers = await syncers(databaseFilePath);
    const { syncUrl, syncClaim, syncAffiliation } = __syncers;
    const { onUpdateUrls, onUpdateClaims, onUpdateAffiliations } =
      await onUpdate({
        label: process.env.APP_TYPE || "BOOL_NODE",
        syncUrl,
        syncClaim,
        syncAffiliation,
      });
    const docTypes = getDocType({
      onUpdateUrls,
      onUpdateClaims,
      onUpdateAffiliations,
    });
    let docs: Docs;
    if (nodeType === "BOOL_NODE") {
      docs = await node.openDocuments([
        docTypes.urls,
        docTypes.claimers,
        docTypes.claims,
        docTypes.affiliates,
      ]);
    } else {
      const __replication = replication(__syncers);
      const { setDocs, syncAllUrls, syncAllClaims, syncAllAffiliations } =
        __replication;
      const { onUpdateUrls, onUpdateClaims, onUpdateAffiliations } =
        await onUpdate({
          label: process.env.APP_TYPE || "API_NODE",
          syncUrl,
          syncClaim,
          syncAffiliation,
          syncAllUrls,
          syncAllClaims,
          syncAllAffiliations,
        });
      const mainPeerHost =
        process.env.MAIN_PEER_HOST || "http://localhost:3000";
      logger.info(`connect to: ${mainPeerHost}`);
      let docInfo;
      let mainIsReady = false;
      const delayTime = 5000;
      while (!mainIsReady) {
        try {
          // fetch db-info
          const response = await fetch(`${mainPeerHost}/admin/db/info`);
          if (response.ok) {
            docInfo = await response.json();
            mainIsReady = true;
          } else {
            logger.warn("wait main boot..");
            await delay(delayTime);
          }
        } catch (err) {
          if (err instanceof Error) {
            logger.error(err.message || "no message");
            if (err.stack) {
              logger.error(err.stack);
            }
          } else if (
            typeof err === "object" &&
            err !== null &&
            "message" in err
          ) {
            logger.error((err as { message: string }).message);
          } else {
            logger.error(err);
          }
          logger.warn("wait main boot..");
          await delay(delayTime);
        }
      }

      const synced = await node.syncDocuments(docInfo, {
        urls: onUpdateUrls,
        claims: onUpdateClaims,
        affiliations: onUpdateAffiliations,
      });
      if (!synced.ok) {
        throw new Error("Sync failed");
      }
      docs = synced.payload;
      setDocs(docs);
    }
    return { node, docs };
  } catch (e) {
    console.error("failed to setup node", e);
    process.exit();
  }
};

export const initOrbitdb4Verifier = async () => {
  const orbitdbRootIdKey = process.env.OID4VP_ORBITDB_ROOT_ID_KEY || "oid4vp";

  const ipfsPath = process.env.OID4VP_IPFS_PATH || "./oid4vp/ipfs/blocks";
  const orbitdbPath = process.env.OID4VP_ORBITDB_PATH || "./oid4vp/orbitdb";
  const keystorePath = process.env.OID4VP_KEYSTORE_PATH || "./oid4vp/keystore";

  const opt = getLibp2pOptions();

  try {
    const node = await setupNode(opt, {
      ipfsPath,
      orbitdbPath,
      keystorePath,
      identityKey: orbitdbRootIdKey,
    });

    const openedKeyValues = await node.openKeyValueIndexed([
      KeyValueType.requestsAtResponseEndpoint,
      KeyValueType.requestsAtVerifier,
      KeyValueType.presentationDefinitions,
      KeyValueType.responsesAtResponseEndpoint,
      KeyValueType.sessions,
      KeyValueType.states,
    ]);
    return { node, openedKeyValues };
  } catch (e) {
    console.error("failed to setup node", e);
    process.exit();
  }
};

export const delay = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms));
