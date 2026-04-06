import { SetupConfig, RpmRepository } from "./parser.ts";
import { colors } from "@cliffy/ansi/colors";
import { SystemAdapter } from "./adapters/SystemAdapter.ts";

const info = colors.bold.blue;
const warn = colors.bold.yellow;
const success = colors.bold.green;
export const dry = colors.bold.magenta;


// --- Domain Logic ---

// Helper to sanitize strings for filesystem use
export const slugify = (text: string): string => {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)+/g, "");
};

// Ensure the setup state directory exists
export const getMarkerDirPath = (): string => {
  const xdgStateHome = Deno.env.get("XDG_STATE_HOME");
  if (xdgStateHome) {
    return `${xdgStateHome}/yass-hat`;
  }
  const home = Deno.env.get("HOME");
  if (!home) {
    throw new Error("HOME environment variable is not set. Cannot determine application state path.");
  }
  return `${home}/.local/state/yass-hat`;
};

// Resolves ~ in paths
export const resolvePath = (filepath: string): string => {
  if (filepath.startsWith("~/")) {
    const home = Deno.env.get("HOME");
    if (!home) {
      throw new Error("HOME environment variable is not set. Cannot resolve ~ paths.");
    }
    return filepath.replace("~", home);
  }
  return filepath;
};

export const hasMarker = async (name: string, sys: SystemAdapter): Promise<boolean> => {
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
};

export const setMarker = async (name: string, sys: SystemAdapter): Promise<void> => {
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
};

export const setupRpmRepo = async (repo: RpmRepository, sys: SystemAdapter): Promise<void> => {
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
};

export const appendToDotfiles = async (appName: string, contentToAppend: string, dotfiles: string[], sys: SystemAdapter): Promise<void> => {
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
};

export const runScript = async (script: { name: string; run: string }, sys: SystemAdapter): Promise<void> => {
  if (await hasMarker(script.name, sys)) {
    console.log(warn(`Skipping script '${script.name}' as it has already run.`));
    return;
  }

  console.log(info(`Running script '${script.name}'...`));
  await sys.runCommand(["bash", "-c", script.run]);
  await setMarker(script.name, sys);
  console.log(success(`Script '${script.name}' completed.`));
};

export const checkPrerequisites = async (config: SetupConfig, sys: SystemAdapter): Promise<void> => {
  const needsFlatpak = config.packages?.flatpak && config.packages.flatpak.length > 0;
  if (needsFlatpak) {
    const hasFlatpak = await sys.commandExists("flatpak");
    if (!hasFlatpak) {
      console.log(warn("Flatpak is requested in your configuration but is not installed."));
      const install = await sys.confirm("Would you like to install Flatpak now?");
      if (install) {
        console.log(info("Installing Flatpak..."));
        await sys.runCommand(["sudo", "dnf", "install", "-y", "flatpak"]);
        console.log(info("Adding Flathub repository..."));
        await sys.runCommand(["flatpak", "remote-add", "--if-not-exists", "flathub", "https://flathub.org/repo/flathub.flatpakrepo"]);
        console.log(success("Flatpak installed successfully!"));
      } else {
        console.log(warn("Skipping Flatpak installation. Flatpak dependencies may fail."));
      }
    }
  }

  const needsBrew = config.packages?.homebrew?.packages && config.packages.homebrew.packages.length > 0;
  
  if (needsBrew) {
    const hasBrew = await sys.commandExists("brew");
    if (!hasBrew) {
      console.log(warn("Homebrew is requested in your configuration but is not installed."));
      const install = await sys.confirm("Would you like to install Homebrew now?");
      if (install) {
        console.log(info("Installing Homebrew..."));
        await sys.runCommand(["bash", "-c", "NONINTERACTIVE=1 /bin/bash -c \"$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)\""]);
        console.log(success("Homebrew installed successfully!"));
      } else {
        console.log(warn("Skipping Homebrew installation. Brew dependencies may fail."));
      }
    }
  }
};

export const setupWorkstation = async (config: SetupConfig, sys: SystemAdapter): Promise<void> => {
  await checkPrerequisites(config, sys);

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
};
