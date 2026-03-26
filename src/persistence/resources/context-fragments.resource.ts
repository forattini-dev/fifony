import { EMBEDDING_VECTOR_DIMENSIONS, S3DB_CONTEXT_FRAGMENT_RESOURCE } from "../../concerns/constants.ts";

export default {
  name: S3DB_CONTEXT_FRAGMENT_RESOURCE,
  attributes: {
    id: "string|required",
    projectKey: "string|required",
    kind: "string|required",
    sourcePath: "string|optional",
    sourceId: "string|required",
    issueId: "string|optional",
    role: "string|optional",
    hash: "string|required",
    text: "string|required",
    embedding: `embedding:${EMBEDDING_VECTOR_DIMENSIONS}|optional:true`,
    createdAt: "datetime|required",
    updatedAt: "datetime|required",
  },
  partitions: {
    byProject: { fields: { projectKey: "string" } },
    byProjectKind: { fields: { projectKey: "string", kind: "string" } },
    byProjectHash: { fields: { projectKey: "string", hash: "string" } },
    byIssueId: { fields: { issueId: "string" } },
  },
  asyncPartitions: true,
  behavior: "body-overflow",
  paranoid: false,
  timestamps: false,
  api: {
    auth: false,
    methods: ["GET", "HEAD", "OPTIONS"],
    description: "Indexed semantic context fragments for hybrid retrieval",
  },
};
