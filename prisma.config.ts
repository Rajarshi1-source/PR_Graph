import "dotenv/config";
import { defineConfig, env } from "prisma/config";

// Prisma 7 config: connection URL + migration paths for the CLI live here (no longer in
// schema.prisma). The application connects via a driver adapter (see src/lib/db/prisma.ts).
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: env("DATABASE_URL"),
  },
});
