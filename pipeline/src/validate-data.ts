import { readFileSync, readdirSync, existsSync } from "fs";
import { resolve } from "path";

const DATA_DIR = resolve(process.cwd(), "../data");

let errors = 0;
let warnings = 0;
let passed = 0;

function pass(msg: string) {
  console.log(`✓ ${msg}`);
  passed++;
}

function error(msg: string) {
  console.error(`✗ ERROR: ${msg}`);
  errors++;
}

function warn(msg: string) {
  console.warn(`⚠ WARNING: ${msg}`);
  warnings++;
}

function readJSON(filePath: string): unknown {
  const raw = readFileSync(filePath, "utf-8");
  return JSON.parse(raw);
}

function fileExists(relPath: string): boolean {
  return existsSync(resolve(DATA_DIR, relPath));
}

function dirJsonFiles(relDir: string): string[] {
  const dir = resolve(DATA_DIR, relDir);
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith(".json"));
}

// ============================================================
// A. File existence checks
// ============================================================
const requiredFiles = [
  "council-members.json",
  "population.json",
  "schedule.json",
  "updates.json",
  "finance/funds.json",
];

for (const f of requiredFiles) {
  if (fileExists(f)) {
    pass(`${f} exists`);
  } else {
    error(`${f} is missing`);
  }
}

const sessionFiles = dirJsonFiles("sessions");
if (sessionFiles.length > 0) {
  pass(`sessions/: ${sessionFiles.length} files`);
} else {
  error("sessions/: no JSON files found");
}

const votingFiles = dirJsonFiles("voting");
if (votingFiles.length > 0) {
  pass(`voting/: ${votingFiles.length} files`);
} else {
  error("voting/: no JSON files found");
}

// ============================================================
// B. Record count checks (zero-guard)
// ============================================================
if (fileExists("council-members.json")) {
  const data = readJSON(resolve(DATA_DIR, "council-members.json")) as {
    members?: unknown[];
  };
  const count = data.members?.length ?? 0;
  if (count > 0) {
    pass(`council-members.json: ${count} members`);
  } else {
    error("council-members.json: members array is empty");
  }
}

if (fileExists("population.json")) {
  const data = readJSON(resolve(DATA_DIR, "population.json")) as {
    history?: unknown[];
  };
  const count = data.history?.length ?? 0;
  if (count > 0) {
    pass(`population.json: ${count} history records`);
  } else {
    error("population.json: history array is empty");
  }
}

for (const f of sessionFiles) {
  const data = readJSON(resolve(DATA_DIR, "sessions", f)) as {
    bills?: unknown[];
  };
  const count = data.bills?.length ?? 0;
  if (count > 0) {
    pass(`sessions/${f}: ${count} bills`);
  } else {
    error(`sessions/${f}: bills array is empty`);
  }
}

for (const f of votingFiles) {
  const data = readJSON(resolve(DATA_DIR, "voting", f)) as {
    records?: unknown[];
  };
  const count = data.records?.length ?? 0;
  if (count > 0) {
    pass(`voting/${f}: ${count} records`);
  } else {
    // voting files can legitimately have 0 records (e.g. older sessions)
    warn(`voting/${f}: records array is empty`);
  }
}

// ============================================================
// C. Range checks on key values
// ============================================================
if (fileExists("population.json")) {
  const data = readJSON(resolve(DATA_DIR, "population.json")) as {
    current?: { population?: number; households?: number };
  };

  const pop = data.current?.population;
  if (pop != null) {
    if (pop >= 50_000 && pop <= 200_000) {
      pass(`population: ${pop.toLocaleString()} (range OK)`);
    } else {
      error(
        `population: ${pop.toLocaleString()} is outside expected range 50,000-200,000`
      );
    }
  } else {
    error("population: current.population is missing");
  }

  const hh = data.current?.households;
  if (hh != null) {
    if (hh >= 20_000 && hh <= 100_000) {
      pass(`households: ${hh.toLocaleString()} (range OK)`);
    } else {
      error(
        `households: ${hh.toLocaleString()} is outside expected range 20,000-100,000`
      );
    }
  } else {
    error("population: current.households is missing");
  }
}

if (fileExists("council-members.json")) {
  const data = readJSON(resolve(DATA_DIR, "council-members.json")) as {
    members?: unknown[];
  };
  const count = data.members?.length ?? 0;
  if (count >= 15 && count <= 30) {
    pass(`council member count: ${count} (range OK)`);
  } else {
    error(
      `council member count: ${count} is outside expected range 15-30`
    );
  }
}

if (fileExists("finance/funds.json")) {
  const data = readJSON(resolve(DATA_DIR, "finance/funds.json")) as {
    grandTotal?: number;
  };
  const total = data.grandTotal;
  if (total != null && total >= 0) {
    pass(`funds grandTotal: ${total.toLocaleString()} (>= 0)`);
  } else {
    error(`funds grandTotal: ${total} is negative or missing`);
  }
}

// ============================================================
// D. Referential integrity: voting memberNames vs council members
// ============================================================
if (fileExists("council-members.json") && votingFiles.length > 0) {
  const cmData = readJSON(resolve(DATA_DIR, "council-members.json")) as {
    members?: { name: string }[];
  };
  const memberNames = new Set(cmData.members?.map((m) => m.name) ?? []);

  for (const f of votingFiles) {
    const data = readJSON(resolve(DATA_DIR, "voting", f)) as {
      records?: { votes?: { memberName: string }[] }[];
    };
    const unknownNames = new Set<string>();
    for (const record of data.records ?? []) {
      for (const vote of record.votes ?? []) {
        if (!memberNames.has(vote.memberName)) {
          unknownNames.add(vote.memberName);
        }
      }
    }
    if (unknownNames.size > 0) {
      warn(
        `voting/${f}: ${unknownNames.size} unknown member(s): ${[...unknownNames].join(", ")}`
      );
    }
  }
}

// ============================================================
// Summary
// ============================================================
console.log("");
console.log("=== KPL Data Validation Summary ===");
console.log(`  ${passed} passed, ${warnings} warning(s), ${errors} error(s)`);

if (errors > 0) {
  console.error("\nValidation FAILED with errors.");
  process.exit(1);
} else if (warnings > 0) {
  console.log("\nValidation passed with warnings.");
} else {
  console.log("\nValidation passed.");
}
