import {
  callGetUrl,
  callGetUrlMetadata,
  callPostUrl,
} from "../../../src/usecases/internal/api-node-caller.js";
import { MockAgent } from "undici";
import { initMockAgent, mockGetAccess } from "../../helpers/mock-request.js";
import { assert } from "chai";

const mainNodeHost = "https://node.boolcheck.com";
const apiNodeHost = "https://api.boolcheck.com";

describe("ApiNodeCaller", () => {
  const testUrl = "https://example.com";

  describe("#callGetUrl", () => {
    let mockGetAgent: MockAgent;
    const pathUrlsGet = `/database/urls?filter=${encodeURIComponent(testUrl)}`;
    describe("url is not registered yet", () => {
      beforeEach(async () => {
        mockGetAgent = mockGetAccess(apiNodeHost, pathUrlsGet, []);
      });
      afterEach(async () => {
        if (mockGetAgent) await mockGetAgent.close();
      });
      it("should register 1 url successfully and return it", async () => {
        const ret = await callGetUrl(apiNodeHost, testUrl);
        assert.isTrue(ret.length === 0);
      });
    });
    describe("second registration(get_url return array)", () => {
      const id = "497f6eca-6276-4993-bfeb-53cbbbba6f08";
      beforeEach(async () => {
        const urls = [
          {
            id,
            url: testUrl,
            domain: "string",
            title: "string",
            content_type: "string",
            description: "string",
            image: [
              {
                height: 0,
                width: 0,
                type: "gif",
                url: "https://anond.hatelabo.jp/images/og-image-1500.gif",
                alt: "string",
              },
            ],
            created_at: "2019-08-24T14:15:22Z",
            true_count: 1,
            false_count: 1,
            else_count: 0,
            verified_true_count: 1,
            verified_false_count: 1,
            verified_else_count: 0,
          },
        ];
        mockGetAgent = mockGetAccess(apiNodeHost, pathUrlsGet, urls);
      });
      afterEach(async () => {
        if (mockGetAgent) await mockGetAgent.close();
      });
      it("should return 1 url", async () => {
        const ret = await callGetUrl(apiNodeHost, testUrl);
        assert.isTrue(ret.length === 1);
        assert.equal(ret[0].id, id);
        assert.equal(ret[0].url, testUrl);
      });
    });
  });

  describe("#callPostUrl", () => {
    const pathUrlsPost = `/database/urls`;
    let mockAgent: ReturnType<typeof initMockAgent>;
    let postCalled = true;
    beforeEach(async () => {
      postCalled = false;
    });
    describe("url is not registered yet", () => {
      const id = "497f6eca-6276-4993-bfeb-53cbbbba6f08";
      beforeEach(async () => {
        const response = {
          id,
          url: testUrl,
          domain: "string",
          title: "string",
          content_type: "string",
          description: "string",
          image: [
            {
              height: 0,
              width: 0,
              type: "gif",
              url: "https://anond.hatelabo.jp/images/og-image-1500.gif",
              alt: "string",
            },
          ],
          created_at: "2019-08-24T14:15:22Z",
          true_count: 0,
          false_count: 0,
          else_count: 0,
          verified_true_count: 0,
          verified_false_count: 0,
          verified_else_count: 0,
        };
        postCalled = false;
        mockAgent = initMockAgent();
        mockAgent.postAccess(mainNodeHost, pathUrlsPost, response, {
          statusCode: 200,
          inspectRequestPayload: (body) => {
            const f = async () => {
              postCalled = true;
              const payload = JSON.parse(body);
              assert.equal(payload.url, testUrl);
            };
            f();
          },
        });
      });
      afterEach(async () => {
        await mockAgent.close();
      });
      it("should register 1 url successfully and return it", async () => {
        const ret = await callPostUrl(mainNodeHost, testUrl);
        assert.isTrue(postCalled);
        if (ret.code === 200) {
          const { urlDoc } = ret;
          assert.equal(urlDoc.id, id);
          assert.equal(urlDoc.url, testUrl);
        } else {
          assert.fail("should not be undefined");
        }
      });
    });
    describe("url is already registered", () => {
      const id = "497f6eca-6276-4993-bfeb-53cbbbba6f08";
      beforeEach(async () => {
        const response = {
          type: "tag:boolcheck.com,2024:Conflict",
          title: "URL already exists.",
          instance: `/database/urls/${id}`,
        };
        postCalled = false;
        mockAgent = initMockAgent();
        mockAgent.postAccess(mainNodeHost, pathUrlsPost, response, {
          statusCode: 409,
          inspectRequestPayload: (body) => {
            const f = async () => {
              postCalled = true;
              const payload = JSON.parse(body);
              assert.equal(payload.url, testUrl);
            };
            f();
          },
        });
      });
      afterEach(async () => {
        await mockAgent.close();
      });
      it("should get 1 url metadata and return it", async () => {
        const ret = await callPostUrl(mainNodeHost, testUrl);
        assert.isTrue(postCalled);
        if (ret.code === 200) {
          const { urlDoc } = ret;
          assert.equal(urlDoc.id, id);
          assert.equal(urlDoc.url, testUrl);
        } else if (ret.code === 409) {
          assert.equal(ret.id, id);
        } else {
          assert.fail("should not be undefined");
        }
      });
    });
  });

  describe("#callGetUrlMetadata", () => {
    const id = "497f6eca-6276-4993-bfeb-53cbbbba6f08";
    let mockGetAgent: MockAgent;
    const pathUrlsGet = `/database/urls/${id}/metadata`;
    describe("url is not registered yet", () => {
      beforeEach(async () => {
        const urlMetadata = {
          id,
          url: testUrl,
          domain: "string",
          title: "string",
          content_type: "string",
          description: "string",
          image: [
            {
              height: 0,
              width: 0,
              type: "gif",
              url: "https://anond.hatelabo.jp/images/og-image-1500.gif",
              alt: "string",
            },
          ],
          created_at: "2019-08-24T14:15:22Z",
          true_count: 1,
          false_count: 1,
          else_count: 0,
          verified_true_count: 1,
          verified_false_count: 1,
          verified_else_count: 0,
        };
        mockGetAgent = mockGetAccess(apiNodeHost, pathUrlsGet, urlMetadata);
      });
      afterEach(async () => {
        if (mockGetAgent) await mockGetAgent.close();
      });
      it("should return 1 url metadata", async () => {
        const ret = await callGetUrlMetadata(apiNodeHost, id);
        if (ret) {
          assert.equal(ret.id, id);
          assert.equal(ret.url, testUrl);
        } else {
          assert.fail("should not be undefined");
        }
      });
    });
  });
});
