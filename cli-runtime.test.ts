import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import {
  configurePiSdkPackageDir,
  configuredFallbackPackageRoots,
} from "./cli";

const missingPackageDir = "/tmp/pi-think-missing-package-dir";

function runCli(args: string[]) {
  return spawnSync("bun", ["./cli.ts", ...args], {
    cwd: import.meta.dir,
    encoding: "utf-8",
    input: "",
    timeout: 10000,
    env: {
      ...process.env,
      PI_PACKAGE_DIR: missingPackageDir,
    },
  });
}

describe("compiled-runtime CLI import boundaries", () => {
  test("--version does not import the Pi SDK package config", () => {
    const result = runCli(["--version"]);

    expect(result.status).toBe(0);
    expect(result.stdout).toBe("0.1.0\n");
    expect(result.stderr).not.toContain("ENOENT");
  });

  test("prompt execution configures the Pi SDK package dir before SDK import", () => {
    const previousPackageDir = process.env.PI_PACKAGE_DIR;

    try {
      process.env.PI_PACKAGE_DIR = missingPackageDir;
      configurePiSdkPackageDir(import.meta.dir);

      expect(process.env.PI_PACKAGE_DIR).not.toBe(missingPackageDir);
      expect(process.env.PI_PACKAGE_DIR).toContain(
        "node_modules/@earendil-works/pi-coding-agent",
      );
    } finally {
      if (previousPackageDir === undefined) {
        delete process.env.PI_PACKAGE_DIR;
      } else {
        process.env.PI_PACKAGE_DIR = previousPackageDir;
      }
    }
  });

  test("discovers configured package roots missing from loaded extensions", () => {
    const agentDir = mkdtempSync(join(tmpdir(), "pi-think-agent-"));
    const cwd = mkdtempSync(join(tmpdir(), "pi-think-project-"));
    const agentPackageRoot = join(
      agentDir,
      "npm",
      "node_modules",
      "pi-xai-oauth",
    );
    const projectPackageRoot = join(
      cwd,
      ".pi",
      "npm",
      "node_modules",
      "pi-project-provider",
    );

    try {
      mkdirSync(agentPackageRoot, { recursive: true });
      mkdirSync(projectPackageRoot, { recursive: true });
      writeFileSync(
        join(agentDir, "settings.json"),
        JSON.stringify({
          packages: ["npm:pi-xai-oauth", "npm:already-loaded"],
        }),
      );
      writeFileSync(
        join(agentPackageRoot, "package.json"),
        JSON.stringify({ name: "pi-xai-oauth" }),
      );
      writeFileSync(
        join(cwd, ".pi", "settings.json"),
        JSON.stringify({
          packages: ["npm:pi-project-provider", "npm:already-loaded"],
        }),
      );
      writeFileSync(
        join(projectPackageRoot, "package.json"),
        JSON.stringify({ name: "pi-project-provider" }),
      );

      expect(
        configuredFallbackPackageRoots(
          agentDir,
          new Set(["already-loaded"]),
          cwd,
        ),
      ).toEqual([agentPackageRoot, projectPackageRoot]);
    } finally {
      rmSync(agentDir, { recursive: true, force: true });
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
