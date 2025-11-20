import Router from "koa-router";
import { koaBody } from "koa-body";
import { AppContext } from "../types/app-types.js";
import { initAdminInteractor } from "../usecases/admin-interactor.js";
import { adminAuthMiddleware } from "../middleware/admin-auth.js";
import getLogger from "../services/logging-service.js";

const logger = getLogger();

export const routes = async (appContext: AppContext) => {
  const router = new Router({ prefix: "/admin" });
  const { db } = appContext;

  // Apply authentication middleware to all admin routes
  router.use(adminAuthMiddleware());

  const adminInteractor = initAdminInteractor(db);

  // Dashboard - shows all tables
  router.get("/", async (ctx) => {
    try {
      const stats = await adminInteractor.getStats();
      const requests = await adminInteractor.getAllRequests();
      const postStates = await adminInteractor.getAllPostStates();
      const sessions = await adminInteractor.getAllSessions();
      const responseCodes = await adminInteractor.getAllResponseCodes();

      await ctx.render("admin/dashboard", {
        stats,
        requests,
        postStates,
        sessions,
        responseCodes,
      });
    } catch (error) {
      logger.error(`Admin dashboard error: ${error}`);
      ctx.status = 500;
      ctx.body = "Internal Server Error";
    }
  });

  // Delete expired records
  router.post("/delete-expired", koaBody(), async (ctx) => {
    try {
      const deleted = await adminInteractor.deleteExpiredRecords();
      ctx.body = {
        success: true,
        deleted,
      };
    } catch (error) {
      logger.error(`Failed to delete expired records: ${error}`);
      ctx.status = 500;
      ctx.body = {
        success: false,
        error: "Failed to delete expired records",
      };
    }
  });

  // Clear all data
  router.post("/clear-all", koaBody(), async (ctx) => {
    try {
      const deleted = await adminInteractor.clearAllData();
      ctx.body = {
        success: true,
        deleted,
      };
    } catch (error) {
      logger.error(`Failed to clear all data: ${error}`);
      ctx.status = 500;
      ctx.body = {
        success: false,
        error: "Failed to clear all data",
      };
    }
  });

  return router;
};

export default { routes };
