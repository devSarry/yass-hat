// --- Adapter Interfaces & Implementations ---

export interface SystemAdapter {
  runCommand(command: string[], env?: Record<string, string>): Promise<void>;
  commandExists(cmd: string): Promise<boolean>;
  confirm(message: string): Promise<boolean>;
  writeTextFile(path: string, content: string, options?: Deno.WriteFileOptions): Promise<void>;
  readTextFile(path: string): Promise<string>;
  mkdir(path: string, options?: Deno.MkdirOptions): Promise<void>;
  stat(path: string): Promise<Deno.FileInfo>;
  makeTempFile(): Promise<string>;
}
