import { InputDescriptor, VC_FORMAT_VC_SD_JWT } from "../../oid4vp/types.js";

export const submissionRequirementAffiliation = {
  name: "Affiliation",
  rule: "pick",
  count: 1,
  from: "A",
};

export const INPUT_DESCRIPTOR_ID2 = "affiliation_credential";

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
