import { parseConfig } from "./parser.ts";
import { colors } from "@cliffy/ansi/colors";
import { setupWorkstation, RealSystemAdapter, DryRunSystemAdapter } from "./runner.ts";
import { Command } from "@cliffy/command";

if (import.meta.main) {
  const { args, options } = await new Command()
    .name("yass-hat")
    .version("v1.0.0")
    .description("Automate and manage your Fedora workstation setup from a YAML profile.")
    .arguments("[file:string]")
    .option("-d, --dry-run", "Preview the changes without actually mutating the system", { default: false })
    .option("-p, --plan", "Alias for --dry-run", { default: false })
    .parse(Deno.args);

  const fileArg = args[0] || "packages.yaml";
  const isDryRun = options.dryRun || options.plan;

  try {
    const yamlContent = await Deno.readTextFile(fileArg);
    const config = parseConfig(yamlContent);
    
    // Select the SystemAdapter conditionally
    const adapter = isDryRun ? new DryRunSystemAdapter() : new RealSystemAdapter();
    
    if (isDryRun) {
      console.log(colors.bold.yellow("--- Executing in DRY RUN mode. No system mutations will occur. ---"));
    }

    await setupWorkstation(config, adapter);
    console.log(colors.bold.green("✨ Workstation setup complete!"));
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      console.error(colors.bold.red(`Could not find configuration file at: ${fileArg}`));
      Deno.exit(1);
    }
    console.error(colors.bold.red("An error occurred during setup:"));
    // Display full stacktrace conditionally or error message
    console.error(error);
    Deno.exit(1);
  }
}
