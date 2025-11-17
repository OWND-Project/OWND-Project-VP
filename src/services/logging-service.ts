import path from "path";
import winston, { format, transports } from "winston";

const { combine, timestamp, printf, splat } = format;

const myFormat = printf(({ level, message, timestamp, file }) => {
  return `[${timestamp}] [${file || "unknown"}] ${level}: ${message}`;
});

// https://github.com/winstonjs/winston?tab=readme-ov-file#logging-levels
const levels: Record<string, string> = {
  local: "debug",
  test: "debug",
  dev: "info",
  prod: "info",
};

// to get filename for large size of stack trace
Error.stackTraceLimit = Infinity;

const addFileInfo = winston.format((info) => {
  const stack = new Error().stack;
  if (stack) {
    const stackLines = stack.split("\n");
    stackLines.splice(0, 2);
    const baseDir = path.resolve(process.cwd(), "src");
    // console.info("baseDir", baseDir);
    // console.error(process.cwd());
    // console.info(stackLines);
    const callerLine = stackLines.find((line) => line.includes(baseDir));
    // const callerLine = stackLines[3]; // 呼び出し元のスタック
    if (callerLine) {
      const match = callerLine.match(/\(([^)]+):(\d+):(\d+)\)$/); // ファイル名と行番号の抽出
      if (match) {
        const filePath = match[1]; // ファイルパス
        const line = match[2]; // 行番号
        const fileName = path.basename(filePath); // ファイル名のみ取得
        info.file = `${fileName}:${line}`; // ファイル名と行番号を追加
      }
    }
  }
  return info;
});
const getLogger = () => {
  const env = process.env.NODE_ENV || "prod";
  // https://github.com/winstonjs/winston
  return winston.createLogger({
    level: levels[env],
    format: combine(addFileInfo(), splat(), timestamp(), myFormat),
    // defaultMeta: { service: "user-service" },
    transports: [
      // https://github.com/winstonjs/winston/blob/master/docs/transports.md#console-transport
      //
      // - Write all logs with importance level of `error` or less to `error.log`
      // - Write all logs with importance level of `info` or less to `combined.log`
      //
      // new winston.transports.File({ filename: "error.log", level: "error" }),
      // new winston.transports.File({ filename: "combined.log" }),
      new transports.Console(),
    ],
  });
};

export const errorLogger = () => {
  const logger = getLogger();
  const log = (err: unknown) => {
    if (err instanceof Error) {
      logger.error(err.message || "no message");
      if (err.stack) {
        logger.error(err.stack);
      }
    } else if (typeof err === "object" && err !== null && "message" in err) {
      logger.error((err as { message: string }).message);
    } else {
      logger.error(err);
    }
  };
  return { log };
};
export default getLogger;
