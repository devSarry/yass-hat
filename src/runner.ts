import { SetupConfig, RpmRepository } from "./parser.ts";
import { colors } from "@cliffy/ansi/colors";

const info = colors.bold.blue;
const warn = colors.bold.yellow;
const success = colors.bold.green;
const dry = colors.bold.magenta;

// --- Adapter Interfaces & Implementations ---
export interface SystemAdapter {
  runCommand(command: string[], env?: Record<string, string>): Promise<void>;
  writeTextFile(path: string, content: string, options?: Deno.WriteFileOptions): Promise<void>;
  readTextFile(path: string): Promise<string>;
  mkdir(path: string, options?: Deno.MkdirOptions): Promise<void>;
  stat(path: string): Promise<Deno.FileInfo>;
  makeTempFile(): Promise<string>;
}

export class RealSystemAdapter implements SystemAdapter {
  async runCommand(command: string[], env: Record<string, string> = {}): Promise<void> {
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
  }
  writeTextFile(path: string, content: string, options?: Deno.WriteFileOptions): Promise<void> {
    return Deno.writeTextFile(path, content, options);
  }
  readTextFile(path: string): Promise<string> {
    return Deno.readTextFile(path);
  }
  mkdir(path: string, options?: Deno.MkdirOptions): Promise<void> {
    return Deno.mkdir(path, options);
  }
  stat(path: string): Promise<Deno.FileInfo> {
    return Deno.stat(path);
  }
  makeTempFile(): Promise<string> {
    return Deno.makeTempFile();
  }
}

export class DryRunSystemAdapter implements SystemAdapter {
  runCommand(command: string[], _env?: Record<string, string>): Promise<void> {
    console.log(`${dry("[DRY RUN]")} Would run command: ${command.join(" ")}`);
    return Promise.resolve();
  }
  writeTextFile(path: string, content: string, options?: Deno.WriteFileOptions): Promise<void> {
    console.log(`${dry("[DRY RUN]")} Would write ${content.length} bytes to ${path}${options?.append ? ' (append)' : ''}`);
    return Promise.resolve();
  }
  async readTextFile(path: string): Promise<string> {
    // We read the actual file so append logic works without error if dotfile exists.
    try {
      return await Deno.readTextFile(path);
    } catch {
      return "";
    }
  }
  mkdir(path: string, _options?: Deno.MkdirOptions): Promise<void> {
    console.log(`${dry("[DRY RUN]")} Would create directory: ${path}`);
    return Promise.resolve();
  }
  async stat(path: string): Promise<Deno.FileInfo> {
    // For hasMarker check real state during dry run so we know what would actually run next
    return await Deno.stat(path);
  }
  makeTempFile(): Promise<string> {
    return Promise.resolve("/tmp/dry-run-tmp-file");
  }
}

export const defaultSystemAdapter = new RealSystemAdapter();

// --- Domain Logic ---

// Helper to sanitize strings for filesystem use
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)+/g, "");
}

// Ensure the setup state directory exists
export function getMarkerDirPath(): string {
  const xdgStateHome = Deno.env.get("XDG_STATE_HOME");
  if (xdgStateHome) {
    return `${xdgStateHome}/yass-hat`;
  }
  const home = Deno.env.get("HOME");
  if (!home) {
    throw new Error("HOME environment variable is not set. Cannot determine application state path.");
  }
  return `${home}/.local/state/yass-hat`;
}

// Resolves ~ in paths
export function resolvePath(filepath: string): string {
  if (filepath.startsWith("~/")) {
    const home = Deno.env.get("HOME");
    if (!home) {
      throw new Error("HOME environment variable is not set. Cannot resolve ~ paths.");
    }
    return filepath.replace("~", home);
  }
  return filepath;
}

export async function hasMarker(name: string, sys: SystemAdapter): Promise<boolean> {
  const markerPath = `${getMarkerDirPath()}/${slugify(name)}.done`;
  try {
    const stats = await sys.stat(markerPath);
    return stats.isFile;
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) {
      return false;
    }
    throw err;
  }
}

export async function setMarker(name: string, sys: SystemAdapter): Promise<void> {
  const dirPath = getMarkerDirPath();
  try {
    await sys.mkdir(dirPath, { recursive: true });
  } catch (err) {
    if (!(err instanceof Deno.errors.AlreadyExists)) {
      throw err;
    }
  }

  const markerPath = `${dirPath}/${slugify(name)}.done`;
  await sys.writeTextFile(markerPath, "");
}

export async function setupRpmRepo(repo: RpmRepository, sys: SystemAdapter): Promise<void> {
  const markerName = `repo-${repo.id}`;
  if (await hasMarker(markerName, sys)) {
    console.log(warn(`Skipping RPM Repo '${repo.id}' as it has already been set up.`));
    return;
  }

  console.log(info(`Setting up RPM Repo '${repo.id}'...`));

  if (repo.import_key) {
    console.log(info(`Importing GPG key for '${repo.id}'...`));
    await sys.runCommand(["sudo", "rpm", "--import", repo.import_key]);
  }

  const tmpPath = await sys.makeTempFile();
  await sys.writeTextFile(tmpPath, repo.content);
  await sys.runCommand(["sudo", "mv", tmpPath, repo.repo_file]);
  await sys.runCommand(["sudo", "chmod", "644", repo.repo_file]);

  await setMarker(markerName, sys);
  console.log(success(`Repo '${repo.id}' setup completed.`));
}

export async function appendToDotfiles(appName: string, contentToAppend: string, dotfiles: string[], sys: SystemAdapter): Promise<void> {
  for (const rawPath of dotfiles) {
    const dotfilePath = resolvePath(rawPath);
    let currentContent = "";
    try {
      currentContent = await sys.readTextFile(dotfilePath);
    } catch (err) {
      if (err instanceof Deno.errors.NotFound) {
        console.warn(warn(`Dotfile ${dotfilePath} does not exist. Skipping.`));
        continue;
      }
      throw err;
    }

    const startMarker = `# --- Setup Tool: ${appName} ---`;
    if (currentContent.includes(startMarker)) {
      console.log(warn(`Dotfile append skipped for ${appName} in ${dotfilePath} (already exists).`));
      continue;
    }

    const endMarker = `# --- End Setup Tool: ${appName} ---`;
    const snippet = `\n${startMarker}\n${contentToAppend}\n${endMarker}\n`;
    await sys.writeTextFile(dotfilePath, snippet, { append: true });
    console.log(success(`Appended ${appName} configuration to ${dotfilePath}`));
  }
}

export async function runScript(script: { name: string; run: string }, sys: SystemAdapter): Promise<void> {
  if (await hasMarker(script.name, sys)) {
    console.log(warn(`Skipping script '${script.name}' as it has already run.`));
    return;
  }

  console.log(info(`Running script '${script.name}'...`));
  await sys.runCommand(["bash", "-c", script.run]);
  await setMarker(script.name, sys);
  console.log(success(`Script '${script.name}' completed.`));
}

export async function setupWorkstation(config: SetupConfig, sys: SystemAdapter = defaultSystemAdapter): Promise<void> {
  if (config.repositories?.rpm && config.repositories.rpm.length > 0) {
    for (const repo of config.repositories.rpm) {
      await setupRpmRepo(repo, sys);
    }
  }

  if (config.packages?.dnf && config.packages.dnf.length > 0) {
    console.log(info(`Installing DNF packages: ${config.packages.dnf.join(", ")}`));
    await sys.runCommand(["sudo", "dnf", "install", "-y", ...config.packages.dnf]);
  }

  if (config.packages?.flatpak && config.packages.flatpak.length > 0) {
    console.log(info(`Installing Flatpak packages: ${config.packages.flatpak.join(", ")}`));
    await sys.runCommand(["flatpak", "install", "-y", "flathub", ...config.packages.flatpak]);
  }

  if (config.packages?.homebrew?.packages && config.packages.homebrew.packages.length > 0) {
    const brewPackages = config.packages.homebrew.packages;
    const names = brewPackages.map(p => p.name);
    console.log(info(`Installing Homebrew packages: ${names.join(", ")}`));
    
    await sys.runCommand(["brew", "install", ...names]);

    if (config.dotfiles && config.dotfiles.length > 0) {
      for (const pkg of brewPackages) {
        if (pkg.append_to_dotfile) {
          await appendToDotfiles(pkg.name, pkg.append_to_dotfile, config.dotfiles, sys);
        }
      }
    }
  }

  if (config.scripts && config.scripts.length > 0) {
    for (const script of config.scripts) {
      await runScript(script, sys);
    }
  }
}
