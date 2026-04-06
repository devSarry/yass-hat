import { Confirm } from "@cliffy/prompt/confirm";
import { SystemAdapter } from "./SystemAdapter.ts";

export const createRealSystemAdapter = (): SystemAdapter => {
  return {
    commandExists: async (cmd: string): Promise<boolean> => {
      try {
        const process = new Deno.Command("which", { args: [cmd], stdout: "null", stderr: "null" });
        const { success } = await process.output();
        return success;
      } catch {
        return false;
      }
    },
    confirm: async (message: string): Promise<boolean> => {
      return await Confirm.prompt({ message, default: true });
    },
    runCommand: async (command: string[], env: Record<string, string> = {}): Promise<void> => {
      if (command.length === 0) return;
      const cmd = new Deno.Command(command[0], {
        args: command.slice(1),
        stdout: "inherit",
        stderr: "inherit",
        env,
      });
      const { success: cmdSuccess, code } = await cmd.output();
      if (!cmdSuccess) {
        throw new Error(`Command '${command.join(" ")}' failed with exit code ${code}`);
      }
    },
    writeTextFile: (path: string, content: string, options?: Deno.WriteFileOptions): Promise<void> => {
      return Deno.writeTextFile(path, content, options);
    },
    readTextFile: (path: string): Promise<string> => {
      return Deno.readTextFile(path);
    },
    mkdir: (path: string, options?: Deno.MkdirOptions): Promise<void> => {
      return Deno.mkdir(path, options);
    },
    stat: (path: string): Promise<Deno.FileInfo> => {
      return Deno.stat(path);
    },
    makeTempFile: (): Promise<string> => {
      return Deno.makeTempFile();
    }
  };
};
