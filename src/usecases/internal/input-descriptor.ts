import { InputDescriptor, VC_FORMAT_VC_SD_JWT } from "../../oid4vp/types.js";

export const submissionRequirementClaim = {
  name: "Claim",
  rule: "pick",
  count: 1,
  from: "A",
};
export const submissionRequirementAffiliation = {
  name: "Affiliation",
  rule: "pick",
  count: 1,
  from: "A",
};

export const INPUT_DESCRIPTOR_ID1 = "true_false_comment";
export const INPUT_DESCRIPTOR_ID2 = "affiliation_credential";

/**
 *
 * @param comment
 * @param boolValue
 */
export const inputDescriptorClaim = (
  url: string,
  comment: string,
  boolValue: number,
): InputDescriptor => {
  return {
    group: ["A"],
    id: INPUT_DESCRIPTOR_ID1,
    format: VC_FORMAT_VC_SD_JWT,
    constraints: {
      fields: [
        {
          path: ["$.vc.type"],
          filter: {
            type: "array",
            contains: {
              const: "CommentCredential",
            },
          },
        },
        {
          path: ["$.vc.credentialSubject.url"],
          filter: {
            type: "string",
            const: url,
          },
        },
        {
          path: ["$.vc.credentialSubject.comment"],
          filter: {
            type: "string",
            const: comment,
          },
        },
        {
          path: ["$.vc.credentialSubject.bool_value"],
          filter: {
            type: "number",
            minimum: boolValue,
            maximum: boolValue,
          },
        },
      ],
      limit_disclosure: "required",
    },
  };
};

export const INPUT_DESCRIPTOR_AFFILIATION: InputDescriptor = {
  group: ["A"],
  id: INPUT_DESCRIPTOR_ID2,
  name: "所属証明クレデンシャル",
  purpose: "身元を証明するために使用します",
  format: VC_FORMAT_VC_SD_JWT,
  constraints: {
    fields: [
      {
        path: ["$.vct"],
        filter: {
          type: "string",
          const: "OrganizationalAffiliationCertificate",
        },
      },
      {
        path: ["$.organization_name"],
        optional: false,
      },
      {
        path: ["$.family_name"],
        optional: false,
      },
      {
        path: ["$.given_name"],
        optional: true,
      },
      {
        path: ["$.portrait"],
        optional: true,
      }
    ],
    limitDisclosure: "required",
  },
};
