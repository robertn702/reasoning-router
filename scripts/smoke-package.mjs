import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { packWorkspaces } from "./smoke-helpers.mjs";

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", ...options });
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed:\n${result.stdout}\n${result.stderr}`,
    );
  }
  return result.stdout;
}

async function unusedPort() {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const required = {
  "@reasoning-router/core": ["dist/index.js", "dist/index.d.ts"],
  "@reasoning-router/classifier-jev": ["dist/jev.js", "dist/jev.d.ts"],
  "@reasoning-router/opencode": [
    "dist/plugin.js",
    "dist/plugin-v2.js",
    "dist/plugin-runtime.js",
  ],
  "reasoning-router": ["dist/index.js"],
};

const temp = await mkdtemp(join(tmpdir(), "reasoning-router-package-"));
let child;
try {
  const tarballs = packWorkspaces(
    root,
    Object.keys(required),
    temp,
    process.argv.slice(2),
  );
  for (const [name, files] of Object.entries(required)) {
    const tarball = tarballs.get(name);
    assert.ok(tarball, `${name} was not packed`);
    const paths = run("tar", ["-tzf", tarball])
      .trim()
      .split("\n")
      .map((path) => path.replace(/^package\//, ""));
    for (const file of [...files, "README.md", "LICENSE"]) {
      assert.ok(paths.includes(file), `${name} is missing ${file}`);
    }
    assert.ok(
      !paths.includes("dist/plugin-v1.js"),
      `${name} still includes the V1 adapter`,
    );
    assert.ok(
      paths.every(
        (path) =>
          !path.startsWith("test/") &&
          !path.startsWith("src/") &&
          !path.startsWith("scripts/") &&
          !path.startsWith("dist/test/") &&
          (!path.endsWith(".ts") || path.endsWith(".d.ts")),
      ),
      `${name} includes development files: ${paths.join(", ")}`,
    );
  }

  run("npm", [
    "install",
    "--prefix",
    temp,
    "--omit=dev",
    "--no-audit",
    "--no-fund",
    ...tarballs.values(),
  ]);
  const binary = join(temp, "node_modules", ".bin", "reasoning-router");
  const help = run(binary, ["--help"], {
    cwd: temp,
    env: { ...process.env, REASONING_ROUTER_CLASSIFIER_API_KEY: "" },
  });
  assert.match(help, /Usage: reasoning-router/);

  const port = await unusedPort();
  child = spawn(binary, [], {
    cwd: temp,
    env: {
      ...process.env,
      TYPESAFE_API_KEY: undefined,
      JEV_ROUTER_API_KEY: undefined,
      JEV_ROUTER_BASE_URL: undefined,
      REASONING_ROUTER_CLASSIFIER_API_KEY: "smoke-test-key",
      REASONING_ROUTER_UPSTREAM_BASE_URL: "http://127.0.0.1:1/v1",
      REASONING_ROUTER_PORT: String(port),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (chunk) => {
    output += chunk;
  });
  child.stderr.on("data", (chunk) => {
    output += chunk;
  });
  let healthy = false;
  for (let attempt = 0; attempt < 50; attempt++) {
    if (child.exitCode !== null) break;
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      if (response.ok) {
        healthy = true;
        break;
      }
    } catch {
      /* Wait for the server to bind. */
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(
    healthy,
    `installed CLI did not start and serve /health:\n${output}`,
  );
  const installed = await Promise.all(
    Object.keys(required).map(async (name) =>
      JSON.parse(
        await readFile(
          join(temp, "node_modules", name, "package.json"),
          "utf8",
        ),
      ),
    ),
  );
  for (const manifest of installed) {
    assert.ok(
      !("@opencode/plugin" in (manifest.dependencies ?? {})),
      `OpenCode SDK must not be a production dependency of ${manifest.name}`,
    );
    assert.ok(
      !("@opencode/plugin" in (manifest.peerDependencies ?? {})),
      `OpenCode SDK must not be a peer dependency of ${manifest.name}`,
    );
  }
  const core = installed.find(
    (manifest) => manifest.name === "@reasoning-router/core",
  );
  assert.deepEqual(
    Object.keys(core.dependencies ?? {}),
    [],
    "core must not depend on a classifier SDK",
  );
  console.log(
    `Packed and ran ${installed.map((manifest) => `${manifest.name}@${manifest.version}`).join(", ")} with production dependencies only.`,
  );
} finally {
  if (child && child.exitCode === null) {
    child.kill();
    await new Promise((resolve) => child.once("exit", resolve));
  }
  await rm(temp, { recursive: true, force: true });
}
