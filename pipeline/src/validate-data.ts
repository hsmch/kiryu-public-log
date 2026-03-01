import { readFileSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  populationSchema,
  councilMembersSchema,
  sessionSchema,
  votingSchema,
  questionsSchema,
  scheduleSchema,
  updatesSchema,
  fundsSchema,
  budgetHistorySchema,
  votingAnalysisSchema,
  tagsSchema,
} from "./schemas";

const DATA_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../data");

let passed = 0;
let failed = 0;

function validate(label: string, schema: any, filePath: string) {
  try {
    const raw = readFileSync(filePath, "utf-8");
    const data = JSON.parse(raw);
    schema.parse(data);
    console.log("  PASS: " + label);
    passed++;
  } catch (err: any) {
    console.error("  FAIL: " + label);
    if (err.issues) {
      for (const issue of err.issues.slice(0, 3)) {
        console.error("    " + JSON.stringify(issue.path) + ": " + issue.message);
      }
      if (err.issues.length > 3) {
        console.error("    ... and " + (err.issues.length - 3) + " more issues");
      }
    } else {
      console.error("    " + err.message);
    }
    failed++;
  }
}

function validateDir(label: string, schema: any, dirPath: string) {
  const files = readdirSync(dirPath).filter((f: string) => f.endsWith(".json"));
  for (const file of files) {
    validate(label + "/" + file, schema, resolve(dirPath, file));
  }
}

console.log("Validating existing data against Zod schemas...");

validate("population.json", populationSchema, resolve(DATA_DIR, "population.json"));
validate("council-members.json", councilMembersSchema, resolve(DATA_DIR, "council-members.json"));
validate("schedule.json", scheduleSchema, resolve(DATA_DIR, "schedule.json"));
validate("updates.json", updatesSchema, resolve(DATA_DIR, "updates.json"));
validate("finance/funds.json", fundsSchema, resolve(DATA_DIR, "finance/funds.json"));
validate("finance/budget-history.json", budgetHistorySchema, resolve(DATA_DIR, "finance/budget-history.json"));
validate("voting-analysis.json", votingAnalysisSchema, resolve(DATA_DIR, "voting-analysis.json"));
validate("tags.json", tagsSchema, resolve(DATA_DIR, "tags.json"));

validateDir("sessions", sessionSchema, resolve(DATA_DIR, "sessions"));
validateDir("voting", votingSchema, resolve(DATA_DIR, "voting"));
validateDir("questions", questionsSchema, resolve(DATA_DIR, "questions"));

console.log("Results: " + passed + " passed, " + failed + " failed");
process.exit(failed > 0 ? 1 : 0);
