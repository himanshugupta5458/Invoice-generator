import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * Quick Fill's item catalogue is a markdown file the route reads at runtime
   * (`lib/quick-fill-catalog.ts`). Output file tracing works by statically
   * analysing imports and `fs` usage, and it cannot see through a path built at
   * runtime — so without this entry the file is left out of a production build
   * and the catalogue silently goes missing. Listed against the one route that
   * reads it rather than globally.
   */
  outputFileTracingIncludes: {
    "/api/quick-fill": [".claude/skills/indian-invoice-items/SKILL.md"],
  },
};

export default nextConfig;
