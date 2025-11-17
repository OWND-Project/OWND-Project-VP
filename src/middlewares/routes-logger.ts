import Koa from "koa";

import getLogger from "../../src/services/logging-service.js";

const logger = getLogger();

const routesLogger = () => {
  return async (ctx: Koa.ParameterizedContext, next: Koa.Next) => {
    const path = ctx.request.path;
    const { method, search } = ctx.request;
    let additionalInfo = { method, search };
    logger.info(`${path} %s`, `start ${JSON.stringify(additionalInfo)}`);

    await next();

    const { status, message } = ctx.response;
    let additionalInfo2: { status: number; message: string; body?: any } = {
      status,
      message,
    };
    if (300 <= status && ctx.response.body) {
      additionalInfo2.body = ctx.response.body;
    }
    logger.info(`${path} %s`, `end ${JSON.stringify(additionalInfo2)}`);
  };
};

export default routesLogger;
