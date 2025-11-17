import { MockAgent, setGlobalDispatcher, Headers } from "undici";

export const mockHtml = `
      <html>
        <head>
          <meta property="og:title" content="Open Graph protocol">
          <meta property="og:type" content="website">
          <meta property="og:url" content="https://ogp.me/">
          <meta property="og:image" content="https://ogp.me/logo.png">
          <meta property="og:image:type" content="image/png">
          <meta property="og:image:width" content="300">
          <meta property="og:image:height" content="300">
          <meta property="og:image:alt" content="The Open Graph logo">
          <meta property="og:description" content="The Open Graph protocol enables any web page to become a rich object in a social graph.">
        </head>
        <body></body>
      </html>
    `;

export const initMockAgent = () => {
  const mockAgent = new MockAgent();
  mockAgent.disableNetConnect();
  setGlobalDispatcher(mockAgent);

  const postAccess = (
    host: string,
    path: string,
    responsePayload: any,
    options?: {
      statusCode?: number;
      inspectRequestHeader?: (
        headers: Headers | Record<string, string> | undefined,
      ) => void;
      inspectRequestPath?: (path: string) => void;
      inspectRequestPayload?: (payload: any) => void;
    },
  ) => {
    const mockPool = mockAgent.get(host);
    mockPool
      .intercept({
        path,
        method: "POST",
      })
      .reply((req) => {
        if (options?.inspectRequestPath) {
          const path = req.path;
          options.inspectRequestPath(path);
        }
        if (options?.inspectRequestHeader) {
          const headers = req.headers;
          options.inspectRequestHeader(headers);
        }
        if (options?.inspectRequestPayload) {
          const body = req.body;
          options?.inspectRequestPayload(body);
        }
        const body = JSON.stringify(responsePayload);
        return {
          statusCode: options?.statusCode ?? 201,
          headers: { "content-type": "application/json; charset=utf-8" },
          data: body,
        };
      });
    return mockAgent;
  };
  const getAccess = (
    host: string,
    path: string,
    responsePayload: any,
    options?: {
      query?: any;
      statusCode?: number;
      headers?: Headers | Record<string, string> | undefined;
      inspectRequestHeader?: (
        headers: Headers | Record<string, string> | undefined,
      ) => void;
      inspectRequestPath?: (path: string) => void;
    },
  ) => {
    let interceptOpts: any = {
      path,
      method: "GET",
    };
    if (options?.query) {
      interceptOpts.query = options.query;
    }
    const mockPool = mockAgent.get(host);
    mockPool.intercept(interceptOpts).reply((req) => {
      if (options?.inspectRequestPath) {
        const path = req.path;
        options.inspectRequestPath(path);
      }
      if (options?.inspectRequestHeader) {
        const headers = req.headers;
        options.inspectRequestHeader(headers);
      }
      let body = responsePayload;

      let contentType: string | undefined;
      if (options?.headers) {
        if (options.headers instanceof Headers) {
          contentType = options.headers.get("Content-Type") ?? undefined;
        } else {
          contentType = options.headers["Content-Type"];
        }
      }
      if (contentType && contentType.startsWith("application/json")) {
        body = JSON.stringify(responsePayload);
      }
      return {
        statusCode: options?.statusCode ?? 200,
        headers: options?.headers ?? {
          "Content-Type": "application/json; charset=utf-8",
        },
        data: body,
      };
    });
    return mockAgent;
  };
  const close = async () => {
    await mockAgent.close();
  };
  const deleteAccess = (
    host: string,
    path: string,
    options?: {
      statusCode?: number;
      inspectRequestHeader?: (
        headers: Headers | Record<string, string> | undefined,
      ) => void;
      inspectRequestPath?: (path: string) => void;
    },
  ) => {
    const mockPool = mockAgent.get(host);
    mockPool
      .intercept({
        path,
        method: "DELETE",
      })
      .reply((req) => {
        if (options?.inspectRequestPath) {
          const path = req.path;
          options.inspectRequestPath(path);
        }
        if (options?.inspectRequestHeader) {
          const headers = req.headers;
          options.inspectRequestHeader(headers);
        }
        return {
          statusCode: options?.statusCode ?? 204,
        };
      });
    return mockAgent;
  };
  return { postAccess, getAccess, deleteAccess, close };
};

export const mockPostAccess = (
  host: string,
  path: string,
  responsePayload: any,
  options?: {
    statusCode?: number;
    inspectRequestHeader?: (
      headers: Headers | Record<string, string> | undefined,
    ) => void;
    inspectRequestPath?: (path: string) => void;
    inspectRequestPayload?: (payload: any) => void;
  },
) => {
  const mockAgent = new MockAgent();
  setGlobalDispatcher(mockAgent);
  const mockPool = mockAgent.get(host);
  mockPool
    .intercept({
      path,
      method: "POST",
    })
    .reply((req) => {
      if (options?.inspectRequestPath) {
        const path = req.path;
        options.inspectRequestPath(path);
      }
      if (options?.inspectRequestHeader) {
        const headers = req.headers;
        options.inspectRequestHeader(headers);
      }
      if (options?.inspectRequestPayload) {
        const body = req.body;
        options?.inspectRequestPayload(body);
      }
      const body = JSON.stringify(responsePayload);
      return {
        statusCode: options?.statusCode ?? 201,
        headers: { "content-type": "application/json; charset=utf-8" },
        data: body,
      };
    });
  return mockAgent;
};

export const mockGetAccess = (
  host: string,
  path: string,
  responsePayload: any,
  options?: {
    statusCode?: number;
    inspectRequestHeader?: (
      headers: Headers | Record<string, string> | undefined,
    ) => void;
    inspectRequestPath?: (path: string) => void;
  },
) => {
  const mockAgent = new MockAgent();
  setGlobalDispatcher(mockAgent);
  const mockPool = mockAgent.get(host);
  mockPool
    .intercept({
      path,
      method: "GET",
    })
    .reply((req) => {
      if (options?.inspectRequestPath) {
        const path = req.path;
        options.inspectRequestPath(path);
      }
      if (options?.inspectRequestHeader) {
        const headers = req.headers;
        options.inspectRequestHeader(headers);
      }
      const body = JSON.stringify(responsePayload);
      return {
        statusCode: options?.statusCode ?? 200,
        headers: { "content-type": "application/json; charset=utf-8" },
        data: body,
      };
    });
  return mockAgent;
};
