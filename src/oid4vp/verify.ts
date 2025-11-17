import * as jose from "jose";
import { JSONPath } from "jsonpath-plus";
import { decodeSDJWT } from "@meeco/sd-jwt";

import { DescriptorMap, InputDescriptor } from "./types.js";
import getLogger from "../services/logging-service.js";

const logger = getLogger();

export const getDescriptorMap = (
  inputDescriptor: InputDescriptor,
  descriptorMap: DescriptorMap[],
  checkFormat: boolean = false,
) => {
  for (const target of descriptorMap) {
    const descriptorId = target.id;
    const descriptorFormat = target.pathNested
      ? target.pathNested.format
      : target.format;
    if (inputDescriptor.id === descriptorId) {
      if (checkFormat) {
        return Object.prototype.hasOwnProperty.call(
          inputDescriptor.format,
          descriptorFormat,
        )
          ? target
          : null;
      } else {
        return target;
      }
    }
  }
  return null;
};

export type Token = string | Record<string, any>;
export interface VerifiableCredentialResult<T, U> {
  id: string;
  format: string;
  raw: T;
  value: U;
  verified: boolean;
}

export interface ExtractedCredential<T, U> {
  raw: T;
  value: U;
  verified: boolean;
}

export interface ExtractResultOk<T> {
  ok: true;
  payload: T;
}
export interface ExtractResultNg<T> {
  ok: false;
  error: { type: T; cause?: Error | unknown };
}
export type ExtractResult<T, E> = ExtractResultOk<T> | ExtractResultNg<E>;

function decodeVpToken(
  token: Token,
  format: string,
): ExtractResult<any, "UNSUPPORTED_FORMAT" | "DECODE_FAILURE"> {
  logger.info(
    `decoding vp token : format=${format}, token=${JSON.stringify(token)}`,
  );
  try {
    if (format && format === "jwt_vp_json") {
      const decoded = jose.decodeJwt(token as string);
      return { ok: true, payload: decoded };
    } else if (format === "vc+sd-jwt") {
      const decoded = decodeSDJWT(token as string);
      return { ok: true, payload: decoded };
    } else if (format === "ldp_vp") {
      return { ok: true, payload: token };
    } else {
      return { ok: false, error: { type: "UNSUPPORTED_FORMAT" } };
    }
  } catch (err) {
    return { ok: false, error: { type: "DECODE_FAILURE", cause: err } };
  }
}

export const extractFromPath = (path: string, json: any) => {
  const verifiableCredential = JSONPath({
    path,
    json,
  });

  // 必要ならさらにverifiableCredentialをデコード
  const raw = verifiableCredential[0]; // queryは結果を配列で返す
  return raw;
};

export type VerifierFunction<T, U> = (credential: T) => Promise<U>;
interface ExtractOption<T, U> {
  verifier: VerifierFunction<T, U>;
  // [key: string]: (credential: U) => Promise<T>;
}
export type ExtractVerifiableCredentialError =
  | "UNSUPPORTED_FORMAT"
  | "DECODE_VP_FAILURE"
  | "DECODE_VC_FAILURE"
  | "EXCEPTION_OCCURRED";
export type ExtractError =
  | "UNMATCHED_PATH"
  | "UNSUPPORTED_FORMAT"
  | "DECODE_FAILURE"
  | "VALIDATE_FAILURE";

export const extractPresentation = async <T, U>(
  vpToken: string | string[],
  descriptor: DescriptorMap,
  opts?: ExtractOption<T, U>,
): Promise<ExtractResult<{ decoded: U; raw: any }, ExtractError>> => {
  logger.info("extractPresentation start");
  logger.info(`vpToken : ${JSON.stringify(vpToken)}`);
  const { format, path } = descriptor;
  const __vpToken = extractFromPath(path, vpToken);
  logger.info(
    `extracted __vpToken by path ${path} : ${JSON.stringify(__vpToken)}`,
  );
  if (!__vpToken) {
    return { ok: false, error: { type: "UNMATCHED_PATH" } };
  }
  const decodedVpTokenResult = decodeVpToken(__vpToken, format);
  if (decodedVpTokenResult.ok) {
    let credential = decodedVpTokenResult.payload;
    if (credential) {
      try {
        if (opts?.verifier) {
          credential = await opts.verifier(__vpToken);
        }
      } catch (err) {
        return { ok: false, error: { type: "VALIDATE_FAILURE", cause: err } };
      }
    } else {
      const type = "UNSUPPORTED_FORMAT";
      return { ok: false, error: { type } };
    }
    logger.info("extractPresentation end");
    return {
      ok: true,
      payload: { decoded: credential as U, raw: __vpToken },
    };
  } else {
    return decodedVpTokenResult;
  }
};

export const extractCredential = async <T, U>(
  vpToken: any,
  format: string,
  opts?: ExtractOption<T, U>,
): Promise<ExtractResult<U, ExtractError>> => {
  /*
    example
    {
      "id": "ID Card with constraints",
      "format": "vc+sd-jwt",
      "path": "$[1]",
    }
   */
  let credential = vpToken;
  if (format === "vc+sd-jwt") {
    if (opts?.verifier) {
      try {
        credential = await opts.verifier(vpToken);
      } catch (err) {
        return { ok: false, error: { type: "VALIDATE_FAILURE", cause: err } };
      }
    }
  } else {
    return { ok: false, error: { type: "UNSUPPORTED_FORMAT" } };
  }
  return { ok: true, payload: credential };
};

// ): Promise<ExtractResult<{ decoded: U; raw: any }, ExtractError>> => {
export const extractNestedCredential = async <T, U>(
  vpToken: any,
  format: string,
  path: string,
  opts?: ExtractOption<T, U>,
): Promise<ExtractResult<{ decoded: U; raw: T }, ExtractError>> => {
  /*
    example
    {
      "id": "ID Card with constraints",
      "format": "jwt_vp_json",
      "path": "$[0]",
      "path_nested": {
          "format": "jwt_vc_json",
          "path": "$[0].vp.verifiableCredential[0]"
      }
    }
   */
  // const json = decodedVpTokens.map((token) => token.decoded);
  const raw = extractFromPath(path, vpToken);
  let credential = raw;
  logger.info(`Credential to be decoded : ${JSON.stringify(credential)}`);
  if (format === "jwt_vc_json" && credential) {
    try {
      if (opts?.verifier) {
        credential = await opts.verifier(credential);
      } else {
        credential = jose.decodeJwt(credential);
      }
    } catch (err) {
      logger.info(`Unable to decode credential : ${JSON.stringify(err)}`);
      return { ok: false, error: { type: "VALIDATE_FAILURE", cause: err } };
    }
    // todo ldp_vc test
    // } else if (format === "ldp_vc" && credential) {
    //   try {
    //     if (opts?.verifier) {
    //       credential = await opts.verifier(credential);
    //     }
    //   } catch (err) {
    //     return { ok: false, error: { type: "VALIDATE_FAILURE", cause: err } };
    //   }
  } else {
    const type = "UNSUPPORTED_FORMAT";
    return { ok: false, error: { type: "UNSUPPORTED_FORMAT" } };
  }
  const payload = { decoded: credential, raw };
  return { ok: true, payload };
};
