import { execFileSync, spawnSync } from "node:child_process";
import * as prettier from "prettier";
const paths = execFileSync(
  "git",
  ["diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z"],
  { encoding: "utf8" },
)
  .split("\0")
  .filter(Boolean);
let failed = false;
for (const path of paths) {
  const info = await prettier.getFileInfo(path, {
    ignorePath: ".prettierignore",
  });
  if (info.ignored || !info.inferredParser) continue;
  const source = execFileSync("git", ["show", `:${path}`], {
    encoding: "utf8",
  });
  if (
    !(await prettier.check(source, {
      ...(await prettier.resolveConfig(path)),
      filepath: path,
    }))
  ) {
    console.error(`Format the staged file: ${path}`);
    failed = true;
  }
}
if (failed) process.exit(1);
for (const task of ["lint", "typecheck", "test"]) {
  const result = spawnSync("npm", ["run", task], { stdio: "inherit" });
  if (result.status !== 0) process.exit(1);
}
