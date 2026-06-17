/* @vitest-environment node */

import { afterEach, describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import {
  createDomainApp,
  type CreateDomainAppProgressEvent,
} from "../cli/create-app.js";
import {
  cleanupTempDirs,
  createTrackedTargetDir,
} from "./create-app.test-fixtures.ts";

const tempDirs: string[] = [];

afterEach(async () => {
  await cleanupTempDirs(tempDirs);
});

describe("create-app scaffold generation", () => {
  it("emits progress events and writes the scaffold without install", async () => {
    // given: an empty target directory and a non-installing Next scaffold
    // request.
    const targetDir = await createTrackedTargetDir(tempDirs);
    const events: CreateDomainAppProgressEvent[] = [];

    // when: createDomainApp writes the scaffold.
    const result = await createDomainApp({
      directory: targetDir,
      framework: "next",
      install: false,
      packageManager: "pnpm",
      onProgress(event) {
        events.push(event);
      },
    });

    const packageJson = await readFile(join(targetDir, "package.json"), "utf8");
    const tsconfigJson = await readFile(join(targetDir, "tsconfig.json"), "utf8");
    const domainFile = await readFile(join(targetDir, "src", "domain.ts"), "utf8");
    const workbenchFile = await readFile(join(targetDir, "src", "app", "domain-workbench.tsx"), "utf8");
    const runtimeFile = await readFile(join(targetDir, "src", "runtime.ts"), "utf8");
    const routeFile = await readFile(
      join(targetDir, "src", "app", "api", "domain", "route.ts"),
      "utf8",
    );

    // then: the scaffold result reports no install/provision side effects,
    // progress reaches completion, and every generated file contains the
    // expected domain runtime integration points.
    expect(result.ok).toBe(true);
    expect(result.template).toBe("empty");
    expect(result.nextSteps.join("\n")).toContain("src/domain.ts");
    expect(result.nextSteps.join("\n")).not.toContain("supplyChain.order.launch");
    expect(result.installed).toBe(false);
    expect(result.adminTokenWritten).toBe(false);
    expect(result.envFile).toBeNull();
    expect(result.smoke).toBeNull();
    expect(events.some((event) => event.stage === "prepare-target" && event.status === "running")).toBe(true);
    expect(events.some((event) => event.stage === "write-files" && event.status === "completed")).toBe(true);
    expect(events.some((event) => event.stage === "complete" && event.status === "completed" && event.progress === 100)).toBe(true);
    const generatedPackageJson = JSON.parse(packageJson) as {
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    expect(generatedPackageJson.dependencies.next).toBe("16.2.6");
    expect(generatedPackageJson.dependencies.react).toBe("19.2.6");
    expect(generatedPackageJson.dependencies["react-dom"]).toBe("19.2.6");
    expect(generatedPackageJson.dependencies["@instantdb/admin"]).toBe("1.0.39");
    expect(generatedPackageJson.dependencies["@instantdb/core"]).toBe("1.0.39");
    expect(generatedPackageJson.dependencies["@instantdb/react"]).toBe("1.0.39");
    expect(generatedPackageJson.devDependencies.typescript).toBe("^6.0.3");
    const generatedTsconfig = JSON.parse(tsconfigJson) as {
      compilerOptions: { baseUrl?: string; jsx?: string; plugins?: Array<{ name: string }> };
      include: string[];
    };
    expect(generatedTsconfig.compilerOptions.baseUrl).toBeUndefined();
    expect(generatedTsconfig.compilerOptions.jsx).toBe("react-jsx");
    expect(generatedTsconfig.compilerOptions.plugins).toEqual([{ name: "next" }]);
    expect(generatedTsconfig.include).toContain(".next/dev/types/**/*.ts");
    expect(packageJson).toContain('"@vercel/oidc": "3.4.1"');
    expect(packageJson).toContain('"workflow": "5.0.0-beta.6"');
    expect(packageJson).not.toContain("@workflow/world-local");
    expect(domainFile).toContain('domain("app")');
    expect(domainFile).toContain(".withSchema({");
    expect(domainFile).toContain("baseDomain.withActions({})");
    expect(workbenchFile).toContain("DomainWorkbench");
    expect(workbenchFile).toContain("Add your first domain");
    expect(runtimeFile).toContain("export class AppRuntime");
    expect(runtimeFile).toContain("@ekairos/domain/runtime-handle");
    expect(routeFile).toContain("createRuntimeRouteHandler");
    expect(routeFile).toContain('from "@/runtime"');
    expect(routeFile).not.toContain("@ekairos/thread");
    expect(routeFile).not.toContain(".well-known");
  });

  it("writes the supply-chain scaffold when selected by template", async () => {
    const targetDir = await createTrackedTargetDir(tempDirs);

    const result = await createDomainApp({
      directory: targetDir,
      framework: "next",
      install: false,
      packageManager: "pnpm",
      template: "supply-chain",
    });

    const domainFile = await readFile(join(targetDir, "src", "domain.ts"), "utf8");
    const pageFile = await readFile(join(targetDir, "src", "app", "page.tsx"), "utf8");
    const workflowFile = await readFile(join(targetDir, "src", "workflows", "demo.workflow.ts"), "utf8");
    const domainDoc = await readFile(join(targetDir, "DOMAIN.md"), "utf8");

    expect(result.ok).toBe(true);
    expect(result.template).toBe("supply-chain");
    expect(result.nextSteps.join("\n")).toContain("supplyChain.order.launch");
    expect(domainFile).toContain('domain("supplyChain")');
    expect(domainFile).toContain("launchOrder");
    expect(pageFile).toContain("DomainShowcase");
    expect(workflowFile).toContain('ActiveDomain<typeof appDomain>');
    expect(domainDoc).toContain("Ekairos Supply Chain Domain");
  });

  it("writes the agent scaffold when selected by template", async () => {
    const targetDir = await createTrackedTargetDir(tempDirs);

    const result = await createDomainApp({
      directory: targetDir,
      framework: "next",
      install: false,
      packageManager: "pnpm",
      template: "agent",
    });

    const packageJson = await readFile(join(targetDir, "package.json"), "utf8");
    const componentsJson = await readFile(join(targetDir, "components.json"), "utf8");
    const schemaFile = await readFile(join(targetDir, "instant.schema.ts"), "utf8");
    const agentFile = await readFile(join(targetDir, "src", "agent.ts"), "utf8");
    const routeFile = await readFile(join(targetDir, "src", "app", "api", "agent", "react", "route.ts"), "utf8");
    const workbenchFile = await readFile(join(targetDir, "src", "app", "agent-workbench.tsx"), "utf8");

    const generatedPackageJson = JSON.parse(packageJson) as {
      dependencies: Record<string, string>;
      pnpm?: { overrides?: Record<string, string> };
    };

    expect(result.ok).toBe(true);
    expect(result.template).toBe("agent");
    expect(result.nextSteps.join("\n")).toContain("/api/agent/react");
    expect(result.nextSteps.join("\n")).toContain("Workbench v2");
    expect(result.nextSteps.join("\n")).toContain("src/agent.ts");
    expect(generatedPackageJson.dependencies["@ekairos/domain"]).toBe("1.22.82-beta.development.0");
    expect(generatedPackageJson.dependencies["@ekairos/events"]).toBe("1.22.82-beta.development.0");
    expect(generatedPackageJson.dependencies["@vercel/oidc"]).toBe("3.4.1");
    expect(generatedPackageJson.pnpm?.overrides?.["@ekairos/domain"]).toBe("1.22.82-beta.development.0");
    expect(generatedPackageJson.pnpm?.overrides?.["@instantdb/admin"]).toBe("1.0.39");
    expect(generatedPackageJson.pnpm?.overrides?.["@instantdb/core"]).toBe("1.0.39");
    expect(componentsJson).toContain("https://registry.ekairos.dev/r/{name}.json");
    expect(schemaFile).toContain('@ekairos/events/schema');
    expect(agentFile).toContain("createScriptedReactor");
    expect(agentFile).toContain("AGENT_TEMPLATE_OK");
    expect(routeFile).toContain("agentContext.react");
    expect(routeFile).toContain('from "@/runtime"');
    expect(workbenchFile).toContain("/api/agent/react");
  });

  it("links local agent packages coherently when workspace is selected", async () => {
    const targetDir = await createTrackedTargetDir(tempDirs);
    const workspacePath = join(targetDir, "..", "ekairos-base");

    const result = await createDomainApp({
      directory: targetDir,
      framework: "next",
      install: false,
      packageManager: "pnpm",
      template: "agent",
      workspacePath,
    });

    const packageJson = await readFile(join(targetDir, "package.json"), "utf8");
    const generatedPackageJson = JSON.parse(packageJson) as {
      dependencies: Record<string, string>;
      pnpm?: { overrides?: Record<string, string> };
    };

    expect(result.ok).toBe(true);
    expect(generatedPackageJson.dependencies["@ekairos/domain"]).toContain("file:");
    expect(generatedPackageJson.dependencies["@ekairos/events"]).toContain("file:");
    expect(generatedPackageJson.pnpm?.overrides?.["@ekairos/domain"]).toBe(
      generatedPackageJson.dependencies["@ekairos/domain"],
    );
    expect(generatedPackageJson.pnpm?.overrides?.["@instantdb/admin"]).toBe("1.0.39");
    expect(generatedPackageJson.pnpm?.overrides?.["@instantdb/core"]).toBe("1.0.39");
  });
});
