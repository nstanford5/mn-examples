// Copies the compiled calculator ZK artifacts into public/ so the browser can
// fetch them.
//
// Why: in Node the harness reads keys from disk (NodeZkConfigProvider). A browser
// can't, so the UI uses FetchZkConfigProvider, which GETs
//   <base>/keys/<circuit>.prover, <base>/keys/<circuit>.verifier, <base>/zkir/<circuit>.bzkir
// We serve them from /managed/calculator/ (see src/midnight/providers.ts).
//
// `yarn dev` and `yarn build` run it first (Yarn 4 does not run pre* scripts).
// The source is the gitignored output of `yarn compile` in examples/calculator,
// and the destination (public/managed/) is gitignored too.
//
// It also refuses to run on a Node older than the repo root's engines.node:
// Yarn 4 doesn't enforce `engines`, and a shell defaulting to Node 20 crashed
// the dev server in hello-world/ui with an unrelated-looking error. This is
// the first thing `dev` and `build` run, so it fails early and clearly.
import { cpSync, existsSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

const range = JSON.parse(readFileSync(path.resolve(here, "../../../../package.json"), "utf8")).engines?.node;
const min = Number(/^>=\s*(\d+)/.exec(range ?? "")?.[1]);
if (min && Number(process.versions.node.split(".")[0]) < min) {
  console.error(
    `[copy:zk] Node ${process.versions.node} is too old: this repo needs Node ${range} (see .nvmrc). Try \`nvm use\`.`,
  );
  process.exit(1);
}
const src = path.resolve(here, "../../contract/managed/calculator");
const dest = path.resolve(here, "../public/managed/calculator");

for (const dir of ["keys", "zkir"]) {
  if (!existsSync(path.join(src, dir))) {
    console.error(
      `[copy:zk] ${path.join(src, dir)} not found.\n` +
        "Compile the contract first:  yarn workspace @midnight-ntwrk/example-calculator run compile",
    );
    process.exit(1);
  }
}

rmSync(dest, { recursive: true, force: true });
for (const dir of ["keys", "zkir"]) {
  cpSync(path.join(src, dir), path.join(dest, dir), { recursive: true });
}
console.log(`[copy:zk] copied keys/ and zkir/ to ${path.relative(process.cwd(), dest)}`);
