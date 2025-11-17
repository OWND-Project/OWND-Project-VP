import ogs from "open-graph-scraper";
import { fetch } from "undici";
import puppeteer from "puppeteer";
import type { OgObject, ImageObject } from "open-graph-scraper/types";

import { Result } from "../tool-box/index.js";
import { delay } from "../api.js";
import getLogger from "../services/logging-service.js";

export interface UrlMetadata {
  title?: string;
  contentType: string;
  description?: string;
  image?: ImageObject[];
  ogObject?: OgObject;
}

interface FetchResultOk {
  notFound: false;
  metadata: UrlMetadata;
}
export interface OgpFetchResultNg {
  type: "NotFound" | "ClientError" | "ServerError";
}
const userAgent =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/111.0.0.0 Safari/537.36";
type FetchResult = Result<UrlMetadata, OgpFetchResultNg>;
// type FetchResult = FetchResultOk | FetchResultNg;
export const fetchOpenGraphData = async (url: string): Promise<FetchResult> => {
  const logger = getLogger();
  try {
    const options = {
      url,
      headers: {
        "User-Agent": userAgent,
      },
      timeout: 30,
    };
    const data = await ogs(options);
    const { result, html, error } = data;

    const response: any = data.response;
    const contentType = response?.headers?.get("content-type");
    // console.log("html:", html);
    if (error) {
      logger.error(`error: ${error}`);
    }

    const { ogTitle, ogDescription, ogImage } = result;
    if (!ogTitle || !ogDescription) {
      logger.info(`title: ${ogTitle}`);
      logger.info(`description: ${ogDescription}`);
      const ogValues = await fetchMaybeSpaPage(url);
      const metadata = {
        title: ogValues?.title || ogTitle || "",
        contentType,
        description: ogValues?.description || "",
        image: [],
      };
      return { ok: true, payload: metadata };
    }

    const tmpArr = ogImage ? ogImage : [];
    const image = tmpArr
      .filter((img) => {
        return img.url.startsWith("http");
      })
      .map((img) => {
        return {
          height: img.height,
          type: img.type,
          url: img.url,
          width: img.width,
          alt: img.alt,
        };
      });

    const metadata = {
      title: result.ogTitle || "",
      contentType,
      description: result.ogDescription || "",
      image,
      ogObject: result,
    };
    return { ok: true, payload: metadata };
  } catch (err: any) {
    console.debug("Error:", err);
    if (err.result && err.result.error) {
      if (err.result.error.startsWith("404")) {
        return { ok: false, error: { type: "NotFound" } }; // path not found
      }
      if (err.result.error.startsWith("4")) {
        // There are cases where accesses from the AWS IP address range, etc. become Bad Requests, in which case they are processed without metadata.
        // return { ok: false, error: { type: "ClientError" } };
        const metadata = {
          title: "",
          contentType: "",
          description: "",
          image: [],
        };
        return { ok: true, payload: metadata };
      }
      if (err.result.error === "Page not found") {
        return { ok: false, error: { type: "ClientError" } }; // domain not found
      }
      if (err.result.error.startsWith("5")) {
        return { ok: false, error: { type: "ServerError" } };
      }
    }
    try {
      const response = await fetch(url);
      if (response?.status && response.status.toString().startsWith("4")) {
        return { ok: false, error: { type: "ClientError" } };
      }
      if (response?.status && response.status.toString().startsWith("5")) {
        return { ok: false, error: { type: "ServerError" } };
      }
      const contentType = response?.headers?.get("content-type") || "";

      const metadata = {
        title: "",
        contentType,
        description: "",
        image: [],
      };
      return { ok: true, payload: metadata };
    } catch (err2) {
      console.debug("Error2:", err);
      return { ok: false, error: { type: "ServerError" } };
    }
  }
};

export const fetchMaybeSpaPage = async (url: string) => {
  const hostname = new URL(url).hostname;
  const options: Record<string, any> = {
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
    ],
  };
  if (process.env.NODE_ENV !== "local" && process.env.NODE_ENV !== "test") {
    options["executablePath"] = "/usr/bin/google-chrome";
    const browser = await puppeteer.launch(options);
    const page = await browser.newPage();
    await page.setUserAgent(userAgent);
    await page.setJavaScriptEnabled(true);

    let ignoreValue = undefined;
    if (hostname === "x.com") {
      ignoreValue = "X";
    }
    try {
      await page.goto(url, { waitUntil: "domcontentloaded" });
      const ogValues = await waitForMetaContent(
        page,
        ignoreValue,
        10000, // max waiting time
      );
      if (hostname === "x.com" && ogValues.title?.includes(":")) {
        const title = ogValues.title.split(":")[1];
        return { title, description: ogValues.description };
      }
      return ogValues;
    } catch (error) {
      console.error("Error fetching tweet page:", error);
      return null;
    } finally {
      await browser.close();
    }
  } else {
    return null;
  }
};

async function waitForMetaContent(
  page: puppeteer.Page,
  expectedValue: string | undefined,
  timeout = 10000,
) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const values = await page.evaluate(() => {
      const element = document.querySelector('meta[property="og:title"]');
      const element2 = document.querySelector(
        'meta[property="og:description"]',
      );
      // return element?.getAttribute("content") || null;
      return {
        title: element?.getAttribute("content") || null,
        description: element2?.getAttribute("content") || null,
      };
    });

    const title = values?.title || null;
    // console.log("title:", title);
    if (expectedValue === undefined) {
      if (title) {
        return values;
      }
    } else if (title && title !== expectedValue) {
      return values;
    }
    await delay(500);
  }

  throw new Error(`Timeout waiting for og:title to have valid content`);
}
