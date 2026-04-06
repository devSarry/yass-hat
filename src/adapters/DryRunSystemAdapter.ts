import { SystemAdapter } from "./SystemAdapter.ts";
import { dry } from "../runner.ts";

export const createDryRunSystemAdapter = (): SystemAdapter => {
  return {
    commandExists: (_cmd: string): Promise<boolean> => {
      return Promise.resolve(true); // default true to plan effectively
    },
    confirm: (message: string): Promise<boolean> => {
      console.log(`${dry("[DRY RUN]")} Prompt: ${message} (auto-yes)`);
      return Promise.resolve(true);
    },
    runCommand: (command: string[], _env?: Record<string, string>): Promise<void> => {
      console.log(`${dry("[DRY RUN]")} Would run command: ${command.join(" ")}`);
      return Promise.resolve();
    },
    writeTextFile: (path: string, content: string, options?: Deno.WriteFileOptions): Promise<void> => {
      console.log(`${dry("[DRY RUN]")} Would write ${content.length} bytes to ${path}${options?.append ? ' (append)' : ''}`);
      return Promise.resolve();
    },
    readTextFile: async (path: string): Promise<string> => {
      // We read the actual file so append logic works without error if dotfile exists.
      try {
        return await Deno.readTextFile(path);
      } catch {
        return "";
      }
    },
    mkdir: (path: string, _options?: Deno.MkdirOptions): Promise<void> => {
      console.log(`${dry("[DRY RUN]")} Would create directory: ${path}`);
      return Promise.resolve();
    },
    stat: async (path: string): Promise<Deno.FileInfo> => {
      // For hasMarker check real state during dry run so we know what would actually run next
      return await Deno.stat(path);
    },
    makeTempFile: (): Promise<string> => {
      return Promise.resolve("/tmp/dry-run-tmp-file");
    }
  };
};
