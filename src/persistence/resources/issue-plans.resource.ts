import { S3DB_ISSUE_PLAN_RESOURCE } from "../../concerns/constants.ts";

export default {
  name: S3DB_ISSUE_PLAN_RESOURCE,
  attributes: {
    id: "string|required",
    issueId: "string|required",
    version: "number|required",
    current: "boolean|required",
    plan: "json|required",
  },
  partitions: {
    byIssue: { fields: { issueId: "string" } },
    byIssueCurrent: { fields: { issueId: "string", current: "boolean" } },
  },
  behavior: "body-overflow",
  paranoid: false,
  timestamps: true,
};
