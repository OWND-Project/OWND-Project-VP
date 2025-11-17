import { assert } from "chai";
import { MockAgent, setGlobalDispatcher } from "undici";

import { fetchOpenGraphData } from "../../src/services/ogp-service.js";

/*
| Case | Content Type | OGP Tag | Title Tag | Helper Behavior | Title            | Content Type        | Description   | Image        |
|------|--------------|---------|-----------|-----------------|------------------|---------------------|---------------|--------------|
| 1    | HTML         | Yes     | Yes       | →               | From og tag      | From response header| From og tag   | From og tag  |
| 2    | HTML         | No      | Yes       | →               | From title tag   | From response header| Empty         | Empty Array  |
| 3    | HTML         | No      | No        | →               | Empty            | From response header| Empty         | Empty Array  |
| 4    | NOT HTML     | -       | -         | →               | Empty            | From response header| Empty         | Empty Array  |
*/

describe("OGP-Service", () => {
  let mockAgent: MockAgent;
  describe("#fetchOpenGraphData", () => {
    beforeEach(() => {
      mockAgent = new MockAgent();
      setGlobalDispatcher(mockAgent);
    });
    afterEach(() => {
      mockAgent.close();
    });

    describe("#not found", () => {
      it("should get error(no such domain)", async () => {
        const url = "http://no-such-url.com";

        const fetchResult = await fetchOpenGraphData(url);
        if (fetchResult.ok) {
          assert.fail("should be client error");
        } else {
          const { type } = fetchResult.error;
          assert.equal(type, "ClientError");
        }
      });
      it("should get error(no such path)", async () => {
        // const url = "http://abehiroshi.la.coocan.jp/";
        const url = "http://no-such-url.com";
        const mockPool = mockAgent.get(url);
        mockPool
          .intercept({
            path: "/",
            method: "GET",
          })
          .reply(404, "Not found", {
            headers: { "content-type": "text/html" },
          });

        const fetchResult = await fetchOpenGraphData(url);
        if (fetchResult.ok) {
          assert.fail("should be client error");
        } else {
          const { type } = fetchResult.error;
          assert.equal(type, "NotFound");
        }
      });
    });

    it("should get ogp metadata", async () => {
      // const url = "http://ogp.me/";
      const url = "http://example.com";
      const mockHtml = `
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
      const mockPool = mockAgent.get(url);
      mockPool
        .intercept({
          path: "/",
          method: "GET",
        })
        .reply(200, mockHtml, {
          headers: { "content-type": "text/html" },
        });

      const fetchResult = await fetchOpenGraphData(url);
      if (!fetchResult.ok) {
        assert.fail("should be ok");
      }
      const { title, contentType, description, image, ogObject } =
        fetchResult.payload;
      assert.equal("Open Graph protocol", title);
      assert.isTrue(contentType.startsWith("text/html"));
      assert.equal(
        "The Open Graph protocol enables any web page to become a rich object in a social graph.",
        description,
      );
      assert.equal(1, image?.length);
      if (image) {
        assert.equal("https://ogp.me/logo.png", image[0].url);
      } else {
        assert.fail("failed to get image");
      }
    });

    it("should get title from html header", async () => {
      // const url = "http://abehiroshi.la.coocan.jp/";
      const url = "http://example.com";
      const mockHtml = `
      <html>
        <head>
            <title>This is not Open Graph protocol</title>
        </head>
        <body></body>
      </html>
    `;
      const mockPool = mockAgent.get(url);
      mockPool
        .intercept({
          path: "/",
          method: "GET",
        })
        .reply(200, mockHtml, {
          headers: { "content-type": "text/html" },
        });

      const fetchResult = await fetchOpenGraphData(url);
      if (!fetchResult.ok) {
        assert.fail("should be ok");
      }
      const { title, contentType, description, image, ogObject } =
        fetchResult.payload;
      assert.equal("This is not Open Graph protocol", title);
      assert.isTrue(contentType.startsWith("text/html"));
      assert.isEmpty(description);
      assert.isTrue(image?.length === 0);
    });

    it("should get content type only (text/html)", async () => {
      // const url =
      //   "http://www6.plala.or.jp/private-hp/samuraidamasii/tamasiitop/tamasiitop.htm";
      const url = "http://example.com";
      const mockHtml = `
      <html>
        <head>
            <title></title>
        </head>
        <body></body>
      </html>
    `;
      const mockPool = mockAgent.get(url);
      mockPool
        .intercept({
          path: "/",
          method: "GET",
        })
        .reply(200, mockHtml, {
          headers: { "content-type": "text/html" },
        });

      const fetchResult = await fetchOpenGraphData(url);
      if (!fetchResult.ok) {
        assert.fail("should be ok");
      }
      const { title, contentType, description, image, ogObject } =
        fetchResult.payload;
      assert.isEmpty(title);
      assert.isTrue(contentType.startsWith("text/html"));
      assert.isEmpty(description);
      assert.isTrue(image?.length === 0);
    });

    it("should get content type only (application/pdf)", async () => {
      // const url = "https://filecoin.io/filecoin.pdf";
      const mockUrl = "http://example.com";
      const url = `${mockUrl}/file.pdf`;
      const binaryData = Buffer.from(
        "This is a mock binary data for PDF testing",
      );
      const mockPool = mockAgent.get(mockUrl);
      mockPool
        .intercept({
          path: "/file.pdf",
          method: "GET",
        })
        .reply(200, binaryData, {
          headers: { "content-type": "application/pdf" },
        });

      const fetchResult = await fetchOpenGraphData(url);
      if (!fetchResult.ok) {
        assert.fail("should be ok");
      }
      const { title, contentType, description, image, ogObject } =
        fetchResult.payload;
      assert.isEmpty(title);
      assert.isEmpty(description);
      assert.isTrue(contentType.startsWith("application/pdf"));
      assert.isTrue(image?.length === 0);
    });

    it("should ignore bad request error", async () => {
      // const url = "https://filecoin.io/filecoin.pdf";
      const mockUrl = "http://example.com";
      const mockPool = mockAgent.get(mockUrl);
      mockPool
        .intercept({
          path: "/",
          method: "GET",
        })
        .reply(400);

      const fetchResult = await fetchOpenGraphData(mockUrl);
      if (fetchResult.ok) {
        const { title, contentType, description, image, ogObject } =
          fetchResult.payload;
        assert.isEmpty(title);
        assert.isEmpty(description);
        assert.isEmpty(contentType);
        assert.isTrue(image?.length === 0);
      } else {
        assert.fail("should be ok");
      }
    });
  });
});
