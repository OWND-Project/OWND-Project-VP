import { fetch } from "undici";
import { UrlDocument } from "../types.js";

export const callDelete = async (host: string, idToken: string, id: string) => {
  const input = host + `/database/claims/${id}`;
  try {
    const response = await fetch(input, {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        Authorization: `Bearer ${idToken}`,
      },
    });
    return response.status;
  } catch (error) {
    console.error(error);
    return undefined;
  }
};

export const callPostUrl = async (host: string, url: string) => {
  const input = host + `/database/urls`;
  try {
    const body = JSON.stringify({
      url,
    });
    const response = await fetch(input, {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
      },
      body,
    });
    if (response.status === 200) {
      const urlDoc = (await response.json()) as unknown as UrlDocument;
      return { code: 200, urlDoc } as { code: 200; urlDoc: UrlDocument };
    } else if (response.status === 409) {
      const ret = (await response.json()) as unknown as { instance: string };
      const id = ret.instance.split("/").pop();
      return { code: 409, id } as { code: 409; id: string };
    } else {
      console.error(response);
      return { code: 500 } as { code: 500 };
    }
  } catch (error) {
    console.error(error);
    return { code: 500 } as { code: 500 };
  }
};

export const callGetUrl = async (host: string, url: string) => {
  const input = host + `/database/urls?filter=${encodeURIComponent(url)}`;
  try {
    const response = await fetch(input, {
      method: "GET",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
      },
    });
    let urlDoc = await response.json();
    // return (await response.json()) as unknown as UrlDocument[];
    return urlDoc as unknown as UrlDocument[];
  } catch (error) {
    console.error(input);
    console.error(error);
    return [];
  }
};

export const callGetUrlMetadata = async (host: string, id: string) => {
  const input = host + `/database/urls/${id}/metadata`;
  try {
    const response = await fetch(input, {
      method: "GET",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
      },
    });
    return (await response.json()) as unknown as UrlDocument;
  } catch (error) {
    console.error(input);
    console.error(error);
    return undefined;
  }
};
