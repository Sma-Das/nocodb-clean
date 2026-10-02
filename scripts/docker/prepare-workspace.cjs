// Adapt this checkout's pnpm 10 configuration inside the Docker build only.
const fs = require("node:fs");
const path = require("node:path");

const directory = path.resolve(process.argv[2] || ".");
const manifest = JSON.parse(
  fs.readFileSync(path.join(directory, "package.json"), "utf8")
);
const { onlyBuiltDependencies = [], ...settings } = manifest.pnpm || {};
settings.allowBuilds = Object.fromEntries(
  onlyBuiltDependencies.map((name) => [name, true])
);
settings.shamefullyHoist = true;
settings.engineStrict = true;
// The existing allowlist skips other dependency scripts with a warning.
settings.strictDepBuilds = false;

// JSON values are valid YAML flow values. Preserve the existing workspace and
// dependency-source policies, adding the legacy manifest settings without a parser.
fs.appendFileSync(
  path.join(directory, "pnpm-workspace.yaml"),
  "\n" +
    Object.entries(settings)
      .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
      .join("\n") +
    "\n"
);
