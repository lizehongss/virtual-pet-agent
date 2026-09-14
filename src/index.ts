import { runCli } from "./cli";

const isDevelopment =
  process.argv.includes("--dev") || process.env.NODE_ENV === "development";

void runCli(undefined, isDevelopment);
