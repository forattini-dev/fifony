import { S3DB_DEV_SERVERS_RESOURCE } from "../../concerns/constants.ts";

export default {
  name: S3DB_DEV_SERVERS_RESOURCE,
  attributes: {
    id: "string|required",
    name: "string|required",
    command: "string|required",
    cwd: "string|optional",
    autoStart: "json|optional",
    updatedAt: "datetime|required",
  },
  asyncPartitions: false,
  behavior: "body-overflow",
  paranoid: false,
  timestamps: false,
  api: {
    enabled: false,
  },
};
