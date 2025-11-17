import { faker } from "@faker-js/faker";
import { OID4VPInteractor } from "../../src/usecases/oid4vp-interactor.js";
import { OkResult } from "../../src/tool-box/index.js";
import {
  AuthRequestPresenter,
  AuthResponsePresenter,
} from "../../src/usecases/types.js";
import {
  AuthorizationRequest,
  camelToSnake,
  PresentationSubmission,
} from "../../src/oid4vp/index.js";
import {
  INPUT_DESCRIPTOR_ID1,
  INPUT_DESCRIPTOR_ID2,
} from "../../src/usecases/internal/input-descriptor.js";
import { createIdToken, createKeyPair, createSdJwt } from "../test-utils.js";
import { issueJwtUsingX5C } from "../oid4vp/test-utils.js";
import { issueJwt } from "../../src/helpers/jwt-helper.js";
import { setupEnv } from "./setenv.js";
import { publicJwkFromPrivate } from "elliptic-jwk";

export type PostFixtureHandler = ReturnType<typeof initPostFixtureHandler>;
export type PostFixtures = ReturnType<typeof initPostFixtures>;

type Ret = {
  requestId: string;
  nonce: string;
  definitionId: string;
};

const authRequest4PostPresenter: AuthRequestPresenter<Ret> = (
  authRequest: AuthorizationRequest,
  requestId: string,
) => {
  let nonce = "";
  let definitionId = "";
  if (authRequest.params) {
    definitionId =
      authRequest.params.presentation_definition_uri.split("id=")[1];
    nonce = authRequest.params.nonce;
  }
  // todo support signed request jwt
  return { requestId, nonce, definitionId };
};

const defaultResponse = {
  comment: "",
  url: "",
  claim: {
    idToken: "",
    organization: "",
    icon: "",
  },
};

export const initPostFixtureHandler = (interactor: OID4VPInteractor) => {
  const memo = {
    response1: { ...defaultResponse },
    response2: { ...defaultResponse },
  };

  /**
   *
   */
  const startFlow = async () => {
    setupEnv();
    const result = await interactor.generateAuthRequest<Ret>(
      { url: faker.internet.url(), comment: "test comment", boolValue: 1 },
      authRequest4PostPresenter,
    );
    return (result as OkResult<Ret>).payload;
  };
  /**
   *
   * @param vpRequest
   * @param payload
   */
  const receiveAuthResponse = async (vpRequest: Ret, payload?: any) => {
    const __payload = payload ?? (await f1(vpRequest));

    const authResponsePresenter: AuthResponsePresenter<string> = (
      redirectUri,
      responseCode,
    ) => {
      return responseCode;
    };
    const receiveAuthResponseResult =
      await interactor.receiveAuthResponse<string>(
        __payload,
        authResponsePresenter,
      );
    if (receiveAuthResponseResult.ok) {
      return receiveAuthResponseResult.payload;
    }
    return undefined;
  };

  const fix = initPostFixtures();

  const f1 = async (vpRequest: Ret) => {
    const res = await fix.response1(vpRequest);
    memo.response1 = fix.memo.response1;
    return res;
  };
  const f2 = async (vpRequest: Ret) => {
    const res = await fix.response2(vpRequest);
    memo.response2 = fix.memo.response2;
    return res;
  };

  return {
    startFlow,
    receiveAuthResponse,
    memo,
    authResponse1: f1,
    authResponse2: f2,
  };
};

/**
 *
 */
export const initPostFixtures = () => {
  const memo = {
    response1: { ...defaultResponse },
    response2: { ...defaultResponse },
  };

  const holderKeyPair = createKeyPair();
  const issuerKeyPair = createKeyPair();
  const header = { alg: "ES256", jwk: publicJwkFromPrivate(issuerKeyPair) };

  const response1 = async (vpRequest: Ret) => {
    const { requestId, nonce, definitionId } = vpRequest;

    // ------------------------ presentation submission -------------------------
    const w3cVpPath = "$.vp.verifiableCredential[0]";
    const map1 = {
      id: INPUT_DESCRIPTOR_ID1,
      path: "$",
      format: "jwt_vp_json",
      path_nested: {
        path: w3cVpPath,
        format: "jwt_vc_json",
      },
    };
    const submission: PresentationSubmission = {
      id: faker.string.uuid(),
      definitionId: definitionId!,
      descriptorMap: [map1],
    };

    // ------------------------ id_token -------------------------
    const keyPair = createKeyPair("secp256k1");
    const idToken = await createIdToken({ privateJwk: keyPair, nonce });

    // ------------------------ comment vc -------------------------
    const { credential, url } = genCommentData();
    const vc = await issueJwt(header, credential, issuerKeyPair);
    const presentation = {
      nonce,
      vp: { verifiableCredential: [vc] },
    };
    const vpToken = await issueJwt(
      { ...header, jwk: holderKeyPair },
      presentation,
      holderKeyPair,
    );

    // use value when assertion
    memo.response1.claim.idToken = idToken;
    memo.response1.url = url;
    memo.response1.comment = vc;

    return {
      state: requestId,
      vp_token: vpToken,
      id_token: idToken,
      presentation_submission: JSON.stringify(camelToSnake(submission)),
    };
  };

  const response2 = async (vpRequest: Ret) => {
    const { requestId, nonce, definitionId } = vpRequest;

    // ------------------------ presentation submission -------------------------
    const w3cVpPath = "$.vp.verifiableCredential[0]";
    const map1 = {
      id: INPUT_DESCRIPTOR_ID1,
      path: "$[0]",
      format: "jwt_vp_json",
      path_nested: {
        path: w3cVpPath,
        format: "jwt_vc_json",
      },
    };
    const map2 = {
      id: INPUT_DESCRIPTOR_ID2,
      path: "$[1]",
      format: "vc+sd-jwt",
    };
    const submission: PresentationSubmission = {
      id: faker.string.uuid(),
      definitionId: definitionId!,
      descriptorMap: [map1, map2],
    };

    // ------------------------ id_token -------------------------
    const keyPair = createKeyPair("secp256k1");
    const idToken = await createIdToken({ privateJwk: keyPair, nonce });

    // ------------------------ comment vc -------------------------
    const { credential, url } = genCommentData();
    const vc = await issueJwt(header, credential, issuerKeyPair);
    const presentation = {
      nonce,
      vp: { verifiableCredential: [vc] },
    };
    const vpToken = await issueJwt(
      { ...header, jwk: holderKeyPair },
      presentation,
      holderKeyPair,
    );

    // ------------------------ affiliation vc -------------------------
    const { claims, disClosureFrame } = genAffiliationData();
    const affiliation = await createSdJwt(claims, disClosureFrame, {
      holderPublicJwk: holderKeyPair,
    });
    const kbJwt = await issueJwt({ alg: "ES256" }, { nonce }, holderKeyPair);
    const vpToken2 = affiliation + kbJwt;

    // use value when assertion
    memo.response2.claim.idToken = idToken;
    memo.response2.url = url;
    memo.response2.comment = vc;
    memo.response2.claim.icon = claims.portrait;
    memo.response2.claim.organization = vpToken2;

    return {
      state: requestId,
      vp_token: [vpToken, vpToken2],
      id_token: idToken,
      presentation_submission: JSON.stringify(camelToSnake(submission)),
    };
  };
  return { memo, response1, response2 };
};

/**
 *
 */
const genCommentData = () => {
  const url = faker.internet.url();
  const credential = {
    vc: {
      credentialSubject: {
        url,
        comment: "test",
        boolValue: 1,
      },
    },
  };
  return { url, credential };
};

/**
 *
 */
export const genAffiliationData = () => {
  const claims = {
    given_name: faker.person.firstName(),
    family_name: faker.person.lastName(),
    portrait: faker.image.dataUri({ type: "svg-base64" }),
    title: faker.company.buzzNoun(),
    organization_name: faker.company.name(),
    organization_unit_name: faker.string.alpha(10),
    organization_url: faker.internet.url(),
    sns_x: `https://x.com/${faker.string.alpha(5)}`,
  };
  const disClosureFrame = [
    "given_name",
    "family_name",
    "portrait",
    "title",
    "organization_name",
    "organization_unit_name",
    "organization_url",
    "sns_x",
  ];
  return { claims, disClosureFrame };
};
