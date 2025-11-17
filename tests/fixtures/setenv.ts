import { faker } from "@faker-js/faker";

export const setupEnv = () => {
  const clientId = faker.internet.url();
  const clientName = faker.string.alpha();
  const responseUri = `${clientId}/response`;
  process.env.OID4VP_CLIENT_ID = clientId;
  process.env.OID4VP_CLIENT_METADATA_NAME = clientName;
  process.env.OID4VP_RESPONSE_URI = responseUri;
  process.env.OID4VP_REDIRECT_URI_RETURNED_BY_RESPONSE_URI = `${clientId}/oid4vp/response-code/exchange`;
};
