// Blocks private data from being committed to this public repo.
// Reads regexes (one per line, case-insensitive) from .private-patterns, which is gitignored,
// and fails if any tracked file (or, with --staged, any staged file) matches one.
// Only file:line locations are printed, never the matching text.
import { existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const PATTERN_FILE = ".private-patterns";
if (!existsSync(PATTERN_FILE)) {
  console.log(`check-private: no ${PATTERN_FILE} file, nothing to check.`);
  process.exit(0);
}

const patterns = readFileSync(PATTERN_FILE, "utf8")
  .split("\n")
  .map((line) => line.trim())
  .filter((line) => line && !line.startsWith("#"))
  .map((p) => new RegExp(p, "i"));

const staged = process.argv.includes("--staged");
const git = (...args) => execFileSync("git", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
const files = (staged ? git("diff", "--cached", "--name-only", "--diff-filter=ACMR") : git("ls-files")).split("\n").filter(Boolean);

let hits = 0;
for (const file of files) {
  let text;
  try {
    text = staged ? git("show", `:${file}`) : readFileSync(file, "utf8");
  } catch {
    continue;
  }
  const lines = [file, ...text.split("\n")];
  lines.forEach((line, i) => {
    if (patterns.some((re) => re.test(line))) {
      console.error(i === 0 ? `${file}: file name matches a private pattern` : `${file}:${i} matches a private pattern`);
      hits += 1;
    }
  });
}

if (hits) {
  console.error(`check-private: ${hits} match(es). Remove the private data before committing.`);
  process.exit(1);
}
console.log(`check-private: ${files.length} file(s) clean.`);
