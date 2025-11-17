import { NotSuccessResult } from "../types/app-types.js";
import Koa from "koa";

export const missingBody = () => {
  const body = {
    type: "INVALID_PARAMETER",
    message: "body should be specified.",
  };
  return { statusCode: 400, body };
};
export const missingBody2 = (ctx: Koa.ParameterizedContext) => {
  const body = {
    type: "INVALID_PARAMETER",
    message: "body should be specified.",
  };
  ctx.status = 400;
  ctx.body = body;
};

export const missingHeader = () => {
  const body = {
    type: "INVALID_HEADER",
    message: "cookie header should be specified.",
  };
  return { statusCode: 400, body };
};

export const handleError = (error: NotSuccessResult) => {
  const { type, message } = error;
  const statusCode =
    type === "UNEXPECTED_ERROR"
      ? 500
      : type === "NOT_FOUND"
        ? 404
        : type === "CONFLICT"
          ? 409
          : 400;
  const __type = type === "INVALID_PARAMETER" ? "BAD_REQUEST" : type;
  const body = toErrorBody(__type, message);
  if (type === "CONFLICT") {
    const { instance } = error;
    const conflictBody = { ...body, instance };
    return { statusCode, body: conflictBody };
  }
  return { statusCode, body };
};

export const toErrorBody = (type: string, message?: string) => {
  // https://www.rfc-editor.org/rfc/rfc9457.html
  // https://www.rfc-editor.org/rfc/rfc4151.html
  return {
    type: `${TAG_PREFIX}:${constantsToPascal(type)}`,
    title: message,
  };
};

const constantsToPascal = (snake: string): string =>
  snake
    .toLowerCase()
    .replace(/_([a-z])/g, (_, letter) => letter.toUpperCase())
    .replace(/^[a-z]/, (letter) => letter.toUpperCase());

export const TAG_PREFIX = "tag:boolcheck.com,2024";
