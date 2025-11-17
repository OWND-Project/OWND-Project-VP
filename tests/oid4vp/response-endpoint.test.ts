import { assert } from "chai";
import {
  AuthResponse,
  initResponseEndpoint,
  NotFoundError,
  ResponseEndpointDatastore,
  ResponseType,
  VpRequest,
} from "../../src/oid4vp/index.js";
import { faker } from "@faker-js/faker";

describe("ResponseEndpoint", () => {
  let saveRequestCalled = false;
  let datastore: ResponseEndpointDatastore;

  beforeEach(async () => {
    saveRequestCalled = false;
    datastore = {
      saveRequest: async (request: VpRequest) => {
        saveRequestCalled = true;
      },
      getRequest(requestId: string): Promise<VpRequest | null> {
        return Promise.resolve(null);
      },
      getResponse(responseCode: string): Promise<AuthResponse | null> {
        return Promise.resolve(null);
      },
      saveResponse(response: AuthResponse): Promise<void> {
        return Promise.resolve(undefined);
      },
    };
  });

  describe("#startRequest", () => {
    it("should generate vp request", async () => {
      const responseType = "vp_token id_token";
      const redirectUri = faker.internet.url();
      const expiredIn = 60;
      const responseEndpoint = initResponseEndpoint(datastore);
      const request = await responseEndpoint.initiateTransaction({
        responseType,
        redirectUriReturnedByResponseUri: redirectUri,
        useTransactionId: true,
        expiredIn,
      });
      assert.isTrue(saveRequestCalled, "saveRequest should be called");

      assert.isString(request.id);
      assert.equal(request.responseType, responseType);
      assert.equal(request.redirectUriReturnedByResponseUri, redirectUri);
      assert.isString(request.transactionId);
      assert.isNumber(request.issuedAt);
      assert.equal(request.expiredIn, expiredIn);
    });
  });

  describe("#receiveAuthResponse", () => {
    const vpToken = "dummy-vp-token";
    const presentationSubmission = "dummy-presentation-submission";
    const idToken = "dummy-id-token";
    describe("fake state", () => {
      it("should not save auth response", async () => {
        let saveResponseCalled = false;
        const requestId = faker.string.uuid();
        const ds: ResponseEndpointDatastore = {
          ...datastore,
          getRequest: async (requestId: string) => {
            return null;
          },
          saveResponse: async (response: AuthResponse) => {
            saveResponseCalled = true;
          },
        };
        const responseEndpoint = initResponseEndpoint(ds);
        const payload = {
          state: requestId,
          vp_token: vpToken,
          presentation_submission: presentationSubmission,
          id_token: idToken,
        };
        const result = await responseEndpoint.receiveAuthResponse(payload);
        if (result.ok) {
          assert.fail("should not be ok");
        } else {
          const { type } = result.error;
          assert.equal(type, "REQUEST_ID_IS_NOT_FOUND");
        }
        assert.isFalse(
          saveResponseCalled,
          "saveResponseCalled should not be called",
        );
      });
    });
    describe("true state", () => {
      it("should save auth response", async () => {
        let responseIdSetInDatastore = undefined;
        const requestId = faker.string.uuid();
        const redirectUri = faker.internet.url();
        const responseType = "vp_token id_token";
        const ds: ResponseEndpointDatastore = {
          ...datastore,
          getRequest: async (requestId: string) => {
            return {
              id: requestId,
              responseType,
              redirectUriReturnedByResponseUri: redirectUri,
              issuedAt: new Date().getTime() / 1000,
              expiredIn: 600,
            };
          },
          saveResponse: async (response: AuthResponse) => {
            responseIdSetInDatastore = response.id;
            assert.equal(response.requestId, requestId);
            assert.equal(response.payload.vpToken, vpToken);
            assert.equal(
              response.payload.presentationSubmission,
              presentationSubmission,
            );
            assert.equal(response.payload.idToken, idToken);
          },
        };
        const responseEndpoint = initResponseEndpoint(ds);
        const payload = {
          state: requestId,
          vp_token: vpToken,
          presentation_submission: presentationSubmission,
          id_token: idToken,
        };
        const result = await responseEndpoint.receiveAuthResponse(payload);
        if (result.ok) {
          const { responseCode } = result.payload;
          assert.equal(responseCode, responseIdSetInDatastore);
        } else {
          assert.fail("should be ok");
        }
      });
    });
  });
  describe("#exchangeAuthResponse", () => {
    const __requestId = faker.string.uuid();
    const __responseCode = faker.string.uuid();
    describe("fake response code", () => {
      it("should be not found", async () => {
        let getResponseCalled = false;
        const ds: ResponseEndpointDatastore = {
          ...datastore,
          getResponse: async (responseCode: string) => {
            getResponseCalled = true;
            assert.equal(responseCode, __responseCode);
            return null;
          },
        };
        const responseEndpoint = initResponseEndpoint(ds);
        const result =
          await responseEndpoint.exchangeResponseCodeForAuthResponse(
            __responseCode,
          );
        if (result.ok) {
          assert.fail("should not be ok");
        } else {
          const { type } = result.error;
          assert.equal(type, "NOT_FOUND");
        }
        assert.isTrue(
          getResponseCalled,
          "getResponseCalled should not be called",
        );
      });
    });
    describe("fake transaction id", () => {
      it("should not match transaction", async () => {
        let getResponseCalled = false;
        const ds: ResponseEndpointDatastore = {
          ...datastore,
          getResponse: async (responseCode: string) => {
            getResponseCalled = true;
            assert.equal(responseCode, __responseCode);
            return {
              id: responseCode,
              requestId: __requestId,
              payload: {
                vpToken: "",
                presentationSubmission: "",
              },
              issuedAt: new Date().getTime() / 1000,
              expiredIn: 600,
            };
          },
          getRequest: async (requestId: string) => {
            return {
              id: requestId,
              responseType: "vp_token id_token",
              transactionId: faker.string.uuid(),
              issuedAt: new Date().getTime() / 1000,
              expiredIn: 600,
            };
          },
        };
        const responseEndpoint = initResponseEndpoint(ds);
        const result =
          await responseEndpoint.exchangeResponseCodeForAuthResponse(
            __responseCode,
            "dummy-transaction-id",
          );
        if (result.ok) {
          assert.fail("should not be ok");
        } else {
          const { type } = result.error;
          assert.equal(type, "NOT_FOUND");
          const { subject } = result.error as NotFoundError;
          assert.equal(subject, "transaction-id");
        }
        assert.isTrue(
          getResponseCalled,
          "getResponseCalled should not be called",
        );
      });
    });
    describe("expired response", () => {
      const vpToken = faker.string.alpha(10);
      const presentationSubmission = faker.string.alpha(10);
      const idToken = faker.string.alpha(10);
      const fakeCommon = {
        responseType: "vp_token id_token" as ResponseType,
        issuedAt: new Date().getTime() / 1000,
        expiredIn: -1,
      };
      const fakeRequest = {
        id: __requestId,
        ...fakeCommon,
      };
      const fakeResponse = {
        id: __responseCode,
        requestId: __requestId,
        payload: {
          vpToken,
          presentationSubmission,
          idToken,
        },
        ...fakeCommon,
      };
      it("should be expired error", async () => {
        const ds: ResponseEndpointDatastore = {
          ...datastore,
          getResponse: async (responseCode: string) => {
            return fakeResponse;
          },
          getRequest: async (requestId: string) => {
            return fakeRequest;
          },
        };
        const responseEndpoint = initResponseEndpoint(ds);
        const result =
          await responseEndpoint.exchangeResponseCodeForAuthResponse(
            __responseCode,
          );
        if (result.ok) {
          assert.fail("should be ng");
        } else {
          const { type } = result.error;
          if (type === "EXPIRED") {
            const { subject, identifier } = result.error;
            assert.equal(subject, "VpResponse");
            assert.equal(identifier, __responseCode);
          } else {
          }
        }
      });
    });
    describe("true response code", () => {
      const vpToken = faker.string.alpha(10);
      const presentationSubmission = faker.string.alpha(10);
      const idToken = faker.string.alpha(10);
      const fakeCommon = {
        responseType: "vp_token id_token" as ResponseType,
        issuedAt: new Date().getTime() / 1000,
        expiredIn: 600,
      };
      const fakeRequest = {
        id: __requestId,
        ...fakeCommon,
      };
      const fakeResponse = {
        id: __responseCode,
        requestId: __requestId,
        payload: {
          vpToken,
          presentationSubmission,
          idToken,
        },
        ...fakeCommon,
      };
      it("should be success(without transaction id)", async () => {
        const ds: ResponseEndpointDatastore = {
          ...datastore,
          getResponse: async (responseCode: string) => {
            return fakeResponse;
          },
          getRequest: async (requestId: string) => {
            return fakeRequest;
          },
        };
        const responseEndpoint = initResponseEndpoint(ds);
        const result =
          await responseEndpoint.exchangeResponseCodeForAuthResponse(
            __responseCode,
          );
        if (result.ok) {
          const { payload } = result.payload;
          assert.equal(payload.vpToken, vpToken);
          assert.equal(payload.presentationSubmission, presentationSubmission);
          assert.equal(payload.idToken, idToken);
        } else {
          assert.fail("should not be ng");
        }
      });
      it("should be success(with transaction id)", async () => {
        const transactionId = faker.string.uuid();
        const ds: ResponseEndpointDatastore = {
          ...datastore,
          getResponse: async (responseCode: string) => {
            return fakeResponse;
          },
          getRequest: async (requestId: string) => {
            return {
              transactionId,
              ...fakeRequest,
            };
          },
        };
        const responseEndpoint = initResponseEndpoint(ds);
        const result =
          await responseEndpoint.exchangeResponseCodeForAuthResponse(
            __responseCode,
            transactionId,
          );
        if (result.ok) {
          const { payload } = result.payload;
          assert.equal(payload.vpToken, vpToken);
          assert.equal(payload.presentationSubmission, presentationSubmission);
          assert.equal(payload.idToken, idToken);
        } else {
          assert.fail("should not be ng");
        }
      });
    });
  });
});
