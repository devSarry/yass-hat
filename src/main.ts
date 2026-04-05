import { parseConfig } from "./parser.ts";
import { setupWorkstation } from "./runner.ts";
import { Command } from "@cliffy/command";

if (import.meta.main) {
  const { args } = await new Command()
    .name("yass-hat")
    .version("v1.0.0")
    .description("Automate and manage your Fedora workstation setup from a YAML profile.")
    .arguments("[file:string]")
    .parse(Deno.args);

  const fileArg = args[0] || "packages.yaml";

  try {
    const yamlContent = await Deno.readTextFile(fileArg);
    const config = parseConfig(yamlContent);
    await setupWorkstation(config);
    console.log("Workstation setup complete!");
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      console.error(`Could not find configuration file at: ${fileArg}`);
      Deno.exit(1);
    }
    console.error("An error occurred during setup:", error);
    Deno.exit(1);
  }
}
