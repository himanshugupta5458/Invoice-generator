import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * Quick Fill's item catalogue is a markdown file the route reads at runtime
   * (`lib/quick-fill-catalog.ts`). Output file tracing works by statically
   * analysing imports and `fs` usage, and it cannot see through a path built at
   * runtime — so without this entry the file is left out of a production build
   * and the catalogue silently goes missing. Living under `lib/` does not change
   * that: tracing follows imports, not directories. Listed against the one route
   * that reads it rather than globally.
   *
   * Kept in step with `CATALOG_PATH` in `lib/quick-fill-catalog.ts`; a test
   * asserts the file is readable at that path so the two cannot drift silently.
   */
  outputFileTracingIncludes: {
    "/api/quick-fill": ["lib/data/indian-invoice-items.md"],
  },
};

export default nextConfig;
