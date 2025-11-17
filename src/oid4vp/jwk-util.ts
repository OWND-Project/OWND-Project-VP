import crypto from "crypto";

/**
 * Compute a hash value of jwk defined in RFC7638 JSON Web Key (JWK) Thumbprint(https://www.rfc-editor.org/rfc/rfc7638.html).
 * @param jwk
 * @param hashAlgorithm
 */
export const calculateJwkThumbprint = async (
  jwk: JsonWebKey,
  hashAlgorithm: string = "SHA-256",
): Promise<string> => {
  /*
  https://openid.github.io/SIOPv2/openid-connect-self-issued-v2-wg-draft.html#section-11-3.2.1
  The thumbprint value of JWK Thumbprint Subject Syntax Type is computed
   as the SHA-256 hash of the octets of the UTF-8 representation of a JWK constructed containing only the REQUIRED members to represent the key,
   with the member names sorted into lexicographic order, and with no white space or line breaks.
 */
  const sortedJwk = Object.keys(jwk)
    .sort() // the member names sorted into lexicographic order
    .reduce(
      (sortedObject, key) => {
        sortedObject[key] = jwk[key as keyof JsonWebKey];
        return sortedObject;
      },
      {} as Record<string, unknown>,
    );
  const encoder = new TextEncoder();
  const data = encoder.encode(JSON.stringify(sortedJwk));
  const hashBuffer = await crypto.subtle.digest(hashAlgorithm, data);
  return Buffer.from(hashBuffer).toString("base64url");
};

/**
 * Form a URI defined in RFC9278 JWK Thumbprint URI(https://www.rfc-editor.org/rfc/rfc9278.html) from a JSON Web Key (JWK) Thumbprint value.
 * @param jwk
 * @param hashAlgorithm
 */
export const toJwkThumbprintUri = async (
  jwk: JsonWebKey,
  hashAlgorithm: string = "SHA-256",
): Promise<string> => {
  const thumbprint = await calculateJwkThumbprint(jwk);
  return `urn:ietf:params:jwk:thumbprint:${hashAlgorithm.toLowerCase()}:${thumbprint}`;
};
