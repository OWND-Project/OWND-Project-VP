import Router from "koa-router";

import { BoolNodeAppContext } from "../types/app-types.js";
import { initClaimInteractor } from "../usecases/claim-interactor.js";
import {
  AffiliationDocument,
  ClaimDocument,
  ClaimerDocument,
  ListOptions,
  UrlDocument,
} from "../usecases/types.js";
import { ClaimerResource, ClaimResource, UrlResource } from "./types.js";
import {
  claimerPresenter,
  claimPresenter,
  newClaimPresenter,
  urlMetadataPresenter,
  urlPresenter,
} from "./presenters.js";
import { koaBody } from "koa-body";
import { handleError, missingBody, toErrorBody } from "./error-handler.js";
import { initClient } from "../local-data/sqlite-client.js";
import getLogger from "../services/logging-service.js";

export const buildListOption = (params: Record<string, any>) => {
  const { filter, start_date, sort } = params;
  let sortKey: "true_count" | "false_count" | "created_at" | undefined;
  let desc = false;

  if (sort) {
    if (sort.startsWith("-")) {
      desc = true;
      sortKey = sort.slice(1) as "true_count" | "false_count" | "created_at";
    } else {
      sortKey = sort as "true_count" | "false_count" | "created_at";
    }

    if (
      sortKey !== "true_count" &&
      sortKey !== "false_count" &&
      sortKey !== "created_at"
    ) {
      sortKey = undefined;
    }
  }

  let startDate: Date | undefined;
  if (start_date) {
    const parsedDate = new Date(start_date);
    if (!isNaN(parsedDate.getTime())) {
      startDate = parsedDate;
    }
  }

  // ListOptions型のオブジェクトを生成
  const listOptions: ListOptions = {
    filter: filter,
    startDate: startDate,
    sortKey: sortKey,
    desc: desc,
  };
  return listOptions;
};

const logger = getLogger();

export const mainRoutes = async (appContext: BoolNodeAppContext) => {
  const router = new Router();
  const apiDomain = "database";
  const databaseFilePath = process.env.DATABASE_FILEPATH || "./database.sqlite";
  const sqliteClient = await initClient(databaseFilePath);
  const db = sqliteClient.db;
  const interactor = initClaimInteractor(appContext.docs!, db);
  router.options(`/${apiDomain}/urls`, async (ctx) => {
    logger.info(`accessed OPTIONS /${apiDomain}/urls : ${JSON.stringify(ctx)}`);
    ctx.status = 204;
  });
  router.post(`/${apiDomain}/urls`, koaBody(), async (ctx) => {
    if (!ctx.request.body) {
      const { statusCode, body } = missingBody();
      ctx.status = statusCode;
      ctx.body = body;
      return;
    }
    const payload = ctx.request.body;
    const result = await interactor.putUrl<UrlResource>(
      payload.url,
      urlPresenter,
    );
    if (result.ok) {
      ctx.status = 200;
      ctx.body = result.payload;
    } else {
      const { statusCode, body } = handleError(result.error);
      ctx.status = statusCode;
      ctx.body = body;
    }
  });
  router.get(`/${apiDomain}/urls`, async (ctx) => {
    const rsc = await interactor.getUrls<UrlResource>(
      buildListOption(ctx.request.query),
      urlPresenter,
    );
    ctx.status = 200;
    ctx.body = rsc;
  });
  router.get(`/${apiDomain}/urls/:id`, async (ctx) => {
    const { id } = ctx.params;
    const rsc = await interactor.getUrl<UrlResource>(id, urlPresenter);
    if (rsc) {
      ctx.status = 200;
      ctx.body = rsc;
    } else {
      ctx.status = 404;
    }
  });
  router.get(`/${apiDomain}/urls/:id/metadata`, async (ctx) => {
    const { id } = ctx.params;
    const rsc = await interactor.getUrlMetadata<UrlResource>(
      id,
      urlMetadataPresenter,
    );
    if (rsc) {
      ctx.status = 200;
      ctx.body = rsc;
    } else {
      ctx.status = 404;
      ctx.body = toErrorBody("NOT_FOUND");
    }
  });
  router.get(`/${apiDomain}/urls/:id/claims`, async (ctx) => {
    const { id } = ctx.params;
    const result = await interactor.getClaimsByUrl<ClaimResource>(
      id,
      claimPresenter,
    );
    if (result.ok) {
      ctx.status = 200;
      ctx.body = result.payload;
    } else {
      ctx.status = 404;
    }
  });
  router.post(`/${apiDomain}/claims`, koaBody(), async (ctx) => {
    if (!ctx.request.body) {
      const { statusCode, body } = missingBody();
      ctx.status = statusCode;
      ctx.body = body;
      return;
    }
    const payload = ctx.request.body;
    const result = await interactor.putClaim(payload, newClaimPresenter);
    if (result.ok) {
      const { id, status } = result.payload;
      ctx.status = 201;
      ctx.set("Location", `/${apiDomain}/claims/${id}`);
      ctx.body = { id, status };
    } else {
      const { statusCode, body } = handleError(result.error);
      ctx.status = statusCode;
      ctx.body = body;
    }
  });
  router.get(`/${apiDomain}/claims/:id`, async (ctx) => {
    const { id } = ctx.params;
    const rsc = await interactor.getClaim<ClaimResource>(id, claimPresenter);
    if (rsc) {
      ctx.status = 200;
      ctx.body = rsc;
    } else {
      ctx.status = 404;
    }
  });
  router.delete(`/${apiDomain}/claims/:id`, async (ctx) => {
    const { id } = ctx.params;
    const authHeader = ctx.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      ctx.status = 401;
      ctx.body = toErrorBody("Unauthorized");
      return;
    }
    const idToken = authHeader.split(" ")[1];

    const result = await interactor.deleteClaim(id, idToken);
    if (result.ok) {
      ctx.status = 204;
    } else {
      const { statusCode, body } = handleError(result.error);
      ctx.status = statusCode;
      ctx.body = body;
    }
  });
  router.get(`/${apiDomain}/claimers/:id`, async (ctx) => {
    const { id } = ctx.params;
    const rsc = await interactor.getClaimer<ClaimerResource>(
      id,
      claimerPresenter,
    );
    if (rsc) {
      ctx.status = 200;
      ctx.body = rsc;
    } else {
      ctx.status = 404;
    }
  });
  router.get(`/${apiDomain}/claimers/:id/claims`, async (ctx) => {
    const { id } = ctx.params;
    const result = await interactor.getClaimsByClaimer<ClaimResource>(
      id,
      claimPresenter,
    );
    if (result.ok) {
      ctx.status = 200;
      ctx.body = result.payload;
    } else {
      ctx.status = 404;
    }
  });
  router.get(`/${apiDomain}/backup`, async (ctx) => {
    const { id } = ctx.params;
    const presenter = (
      urls: UrlDocument[],
      claimers: ClaimerDocument[],
      affiliations: AffiliationDocument[],
      claims: ClaimDocument[],
    ) => {
      return { urls, claimers, affiliations, claims };
    };
    const result =
      await interactor.backupAll<ReturnType<typeof presenter>>(presenter);
    ctx.status = 200;
    ctx.body = result;
  });
  router.post(`/${apiDomain}/restore`, koaBody(), async (ctx) => {
    const payload = ctx.request.body;
    const presenter = () => {};
    const result =
      await interactor.restoreAll<ReturnType<typeof presenter>>(payload);
    ctx.status = 200;
    ctx.body = result;
  });
  return router;
};
