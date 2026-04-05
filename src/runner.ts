import { SetupConfig, RpmRepository } from "./parser.ts";

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
  const home = Deno.env.get("HOME") || "~";
  return `${home}/.local/state/yass-hat`;
}

// Resolves ~ in paths
export function resolvePath(filepath: string): string {
  if (filepath.startsWith("~/")) {
    const home = Deno.env.get("HOME") || "~";
    return filepath.replace("~", home);
  }
  return filepath;
}

export async function hasMarker(name: string): Promise<boolean> {
  const markerPath = `${getMarkerDirPath()}/${slugify(name)}.done`;
  try {
    const stat = await Deno.stat(markerPath);
    return stat.isFile;
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) {
      return false;
    }
    throw err;
  }
}

export async function setMarker(name: string): Promise<void> {
  const dirPath = getMarkerDirPath();
  try {
    await Deno.mkdir(dirPath, { recursive: true });
  } catch (err) {
    if (!(err instanceof Deno.errors.AlreadyExists)) {
      throw err;
    }
  }

  const markerPath = `${dirPath}/${slugify(name)}.done`;
  await Deno.writeTextFile(markerPath, "");
}

export async function runCommand(command: string[], env: Record<string, string> = {}): Promise<void> {
  if (command.length === 0) return;
  const cmd = new Deno.Command(command[0], {
    args: command.slice(1),
    stdout: "inherit",
    stderr: "inherit",
    env,
  });

  const { success, code } = await cmd.output();
  if (!success) {
    throw new Error(`Command '${command.join(" ")}' failed with exit code ${code}`);
  }
}

export async function setupRpmRepo(repo: RpmRepository): Promise<void> {
  const markerName = `repo-${repo.id}`;
  if (await hasMarker(markerName)) {
    console.log(`Skipping RPM Repo '${repo.id}' as it has already been set up.`);
    return;
  }

  console.log(`Setting up RPM Repo '${repo.id}'...`);

  if (repo.import_key) {
    console.log(`Importing GPG key for '${repo.id}'...`);
    await runCommand(["sudo", "rpm", "--import", repo.import_key]);
  }

  // To write to root-owned files without giving user sudo echo permissions hazard,
  // we can use a temporary file or bash -c "echo ... | sudo tee ..."
  // Safest approaches avoiding shell interpretation is to write standard tmp and sudo mv
  const tmpPath = await Deno.makeTempFile();
  await Deno.writeTextFile(tmpPath, repo.content);
  await runCommand(["sudo", "mv", tmpPath, repo.repo_file]);
  await runCommand(["sudo", "chmod", "644", repo.repo_file]);

  await setMarker(markerName);
  console.log(`Repo '${repo.id}' setup completed.`);
}

export async function appendToDotfiles(appName: string, contentToAppend: string, dotfiles: string[]): Promise<void> {
  for (const rawPath of dotfiles) {
    const dotfilePath = resolvePath(rawPath);
    let currentContent = "";
    try {
      currentContent = await Deno.readTextFile(dotfilePath);
    } catch (err) {
      if (err instanceof Deno.errors.NotFound) {
        console.warn(`Dotfile ${dotfilePath} does not exist. Skipping.`);
        continue;
      }
      throw err;
    }

    const startMarker = `# --- Setup Tool: ${appName} ---`;
    if (currentContent.includes(startMarker)) {
      console.log(`Dotfile append skipped for ${appName} in ${dotfilePath} (already exists).`);
      continue;
    }

    const endMarker = `# --- End Setup Tool: ${appName} ---`;
    const snippet = `\n${startMarker}\n${contentToAppend}${endMarker}\n`;
    await Deno.writeTextFile(dotfilePath, snippet, { append: true });
    console.log(`Appended ${appName} configuration to ${dotfilePath}`);
  }
}

export async function runScript(script: { name: string; run: string }): Promise<void> {
  if (await hasMarker(script.name)) {
    console.log(`Skipping script '${script.name}' as it has already run.`);
    return;
  }

  console.log(`Running script '${script.name}'...`);
  await runCommand(["bash", "-c", script.run]);
  await setMarker(script.name);
  console.log(`Script '${script.name}' completed.`);
}

export async function setupWorkstation(config: SetupConfig): Promise<void> {
  
  if (config.repositories?.rpm && config.repositories.rpm.length > 0) {
    for (const repo of config.repositories.rpm) {
      await setupRpmRepo(repo);
    }
  }

  if (config.packages?.dnf && config.packages.dnf.length > 0) {
    console.log(`Installing DNF packages: ${config.packages.dnf.join(", ")}`);
    await runCommand(["sudo", "dnf", "install", "-y", ...config.packages.dnf]);
  }

  if (config.packages?.flatpak && config.packages.flatpak.length > 0) {
    console.log(`Installing Flatpak packages: ${config.packages.flatpak.join(", ")}`);
    await runCommand(["flatpak", "install", "-y", "flathub", ...config.packages.flatpak]);
  }

  if (config.packages?.homebrew?.packages && config.packages.homebrew.packages.length > 0) {
    const brewPackages = config.packages.homebrew.packages;
    const names = brewPackages.map(p => p.name);
    console.log(`Installing Homebrew packages: ${names.join(", ")}`);
    
    // We can install them all at once for speed
    await runCommand(["brew", "install", ...names]);

    // Apply dotfiles logic
    if (config.dotfiles && config.dotfiles.length > 0) {
      for (const pkg of brewPackages) {
        if (pkg.append_to_dotfile) {
          await appendToDotfiles(pkg.name, pkg.append_to_dotfile, config.dotfiles);
        }
      }
    }
  }

  if (config.scripts && config.scripts.length > 0) {
    for (const script of config.scripts) {
      await runScript(script);
    }
  }
}
