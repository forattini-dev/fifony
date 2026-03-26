import { S3DB_MILESTONE_RESOURCE } from "../../concerns/constants.ts";

export default {
  name: S3DB_MILESTONE_RESOURCE,
  attributes: {
    id: "string|required",
    slug: "string|required",
    name: "string|required",
    description: "string|optional",
    status: "string|required",
    createdAt: "datetime|required",
    updatedAt: "datetime|required",
  },
  partitions: {
    byStatus: { fields: { status: "string" } },
    bySlug: { fields: { slug: "string" } },
  },
  asyncPartitions: true,
  behavior: "body-overflow",
  paranoid: false,
  timestamps: false,
  api: {
    enabled: false,
  },
};
