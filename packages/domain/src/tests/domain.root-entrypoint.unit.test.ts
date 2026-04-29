/* @vitest-environment node */

import { readFileSync } from "node:fs";
import { describe, expect, afterEach, it } from "vitest";
import { i } from "@instantdb/core";

import {
  configureDomainDocLoader,
  configureDomainDocNormalizer,
  domain,
} from "../index.ts";
import { domainDocNormalizer } from "../domain-doc.ts";

describe("domain root entrypoint", () => {
  afterEach(() => {
    configureDomainDocLoader(null);
    configureDomainDocNormalizer(null);
  });

  it("does not statically import the domain-doc parser", () => {
    const rootEntrypoint = readFileSync(new URL("../index.ts", import.meta.url), "utf8");

    expect(rootEntrypoint).not.toMatch(/from\s+["']\.\/domain-doc(?:\.js)?["']/);
    expect(rootEntrypoint).not.toMatch(/export\s+.*from\s+["']\.\/domain-doc(?:\.js)?["']/);
  });

  it("uses raw docs unless a domain doc normalizer is configured explicitly", () => {
    const rawRootDoc = `# domain: root

## Overview
ROOT RAW DOC
`;

    const rawSubdomainDoc = `# domain: child

## Overview
CHILD RAW DOC

## Entities
- child_items: Visible entity docs.
- hidden_items: This entity is not in the app schema.
`;

    configureDomainDocLoader(({ scope, meta }) => {
      if (scope === "root") return { doc: rawRootDoc, docPath: "DOMAIN.md" };
      if (meta?.name === "child") {
        return { doc: rawSubdomainDoc, docPath: "child/DOMAIN.md" };
      }
      return null;
    });

    const childDomain = domain("child").schema({
      entities: { child_items: i.entity({ value: i.string() }) },
      links: {},
      rooms: {},
    });

    const rootDomain = domain("root").includes(childDomain).schema({
      entities: { root_items: i.entity({ value: i.string() }) },
      links: {},
      rooms: {},
    });

    expect(rootDomain.context().registry[0]?.doc).toContain("hidden_items");

    configureDomainDocNormalizer(domainDocNormalizer);

    const normalizedDoc = rootDomain.context().registry[0]?.doc ?? "";
    expect(normalizedDoc).toContain("child_items");
    expect(normalizedDoc).not.toContain("hidden_items");
  });
});
