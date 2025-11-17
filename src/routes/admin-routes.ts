import Router from "koa-router";
import { koaBody } from "koa-body";

import { BoolNodeAppContext } from "../types/app-types.js";
import { onUpdate } from "../local-data/on-update.js";

export const adminRoutes = async (appContext: BoolNodeAppContext) => {
  const router = new Router();

  const { node, docs } = appContext;
  router.get(`/admin/peer/info`, async (ctx) => {
    const peerInfo = node.getPeerInfo();
    ctx.status = 200;
    ctx.body = peerInfo;
  });

  router.post(`/admin/access-right/grant`, koaBody(), async (ctx) => {
    if (!ctx.request.body) {
      ctx.status = 400;
      ctx.body = { status: "error", message: "Invalid data received!" };
    } else if (!docs) {
      ctx.status = 400;
      ctx.body = { status: "error", message: "Illegal database status" };
    } else {
      const payload = ctx.request.body;
      const grantResult = await node.grant(docs.documents, payload);
      if (!grantResult.ok) {
        ctx.status = 400; // todo code varies case by case
        ctx.body = { status: "error", message: "Invalid data received!" };
      }
      const docInfo = node.getDocumentsInfo(docs.documents);
      ctx.status = 204;
    }
  });

  router.get(`/admin/db/info`, async (ctx) => {
    if (!docs) {
      ctx.status = 400;
      return;
    }
    const docInfo = node.getDocumentsInfo(docs.documents);
    ctx.status = 200;
    ctx.body = docInfo;
  });

  router.post(`/admin/db/sync`, koaBody(), async (ctx) => {
    if (!ctx.request.body) {
      ctx.status = 400;
      ctx.body = { status: "error", message: "Invalid data received!" };
    } else {
      const payload = ctx.request.body;
      const databaseFilePath =
        process.env.DATABASE_FILEPATH || "./database.sqlite";
      const { onUpdateClaims, onUpdateUrls } = await onUpdate();
      const syncResult = await node.syncDocuments(payload, {
        urls: onUpdateUrls,
        claims: onUpdateClaims,
      });
      if (!syncResult.ok) {
        const error = syncResult.error;
        ctx.status = 500;
        ctx.body = { status: "error", message: error.type };
      } else {
        appContext.docs = syncResult.payload;
        ctx.status = 204;
      }
    }
  });

  return router;
};
