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
import { cpSync, existsSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
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
