import { Database } from "sqlite";
import { UrlDocument } from "../types.js";
import {
  fetchOpenGraphData,
  OgpFetchResultNg,
  UrlMetadata,
} from "../../services/ogp-service.js";
import { randomUniqueString } from "../../utils/random-util.js";
import { getFQDN } from "../../utils/url-util.js";
import { Result } from "../../tool-box/index.js";
import getLogger from "../../services/logging-service.js";
import { UnexpectedError } from "../../types/app-types.js";
import { Docs, OpenedDocument } from "../../orbit-db/index.js";
import {
  LocalUrlHandler,
  urlHandler,
} from "../../local-data/local-data-handler.js";
import { initClaimRepository } from "../claim-repository.js";

interface UrlOption {
  title: string;
  contentType: string;
  description: string;
  image: string;
  ogObject: any;
}

const logger = getLogger();

export const UrlHandler = (docs: Docs, database: Database) => {
  const repository = initClaimRepository(docs);
  let localUrlHandler: LocalUrlHandler;
  /**
   *
   * @param url
   */
  const newUrl = async (
    url: string,
  ): Promise<Result<{ urlDoc: UrlDocument }, OgpFetchResultNg>> => {
    const fetchResult = await fetchOpenGraphData(url);
    if (!fetchResult.ok) {
      return { ok: false, error: { type: fetchResult.error.type } };
    }
    const payload = fetchResult.payload;
    const __newUrl = await repository.putUrl({ url, ...payload });
    return { ok: true, payload: { urlDoc: __newUrl } };
  };
  /**
   *
   * @param url
   */
  const selectUrl = async (
    url: string,
  ): Promise<Result<{ urlDoc: UrlDocument | null }, UnexpectedError>> => {
    if (!localUrlHandler) {
      localUrlHandler = await urlHandler(database);
    }
    // find url by url
    try {
      // const urls = await urlDocs.document.query<UrlDocument>(
      //   (value) => value.url == url,
      // );
      const localUrl = await localUrlHandler.getUrlByUrl(url.split("?")[0]);
      let urlDoc;
      if (!localUrl) {
        // return { ok: true, payload: { urlDoc: null } };
        urlDoc = null;
      } else {
        urlDoc = { ...localUrl, id: localUrl.url_id };
      }
      return { ok: true, payload: { urlDoc } };
    } catch (e) {
      return { ok: false, error: { type: "UNEXPECTED_ERROR" } };
    }
  };
  /**
   *
   * @param url
   */
  const selectAndRegisterUrl = async (
    url: string,
  ): Promise<
    Result<{ urlDoc: UrlDocument }, OgpFetchResultNg | UnexpectedError>
  > => {
    const selectedUrl = await selectUrl(url);
    if (!selectedUrl.ok) {
      const { type } = selectedUrl.error;
      return { ok: false, error: { type } };
    }
    const { urlDoc } = selectedUrl.payload;
    if (urlDoc) {
      return { ok: true, payload: { urlDoc } };
    } else {
      // await urlDocs.document.put<UrlDocument>(urlDoc);
      const newUrlDoc = await newUrl(url);
      if (newUrlDoc.ok) {
        return { ok: true, payload: { urlDoc: newUrlDoc.payload.urlDoc } };
      } else {
        const { type } = newUrlDoc.error;
        return { ok: false, error: { type } };
      }
    }
  };

  return { newUrl, selectUrl, selectAndRegisterUrl };
};
