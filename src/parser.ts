import { parse } from "@std/yaml";

export interface RpmRepository {
  id: string;
  import_key?: string;
  repo_file: string;
  content: string;
}

export interface HomebrewPackage {
  name: string;
  append_to_dotfile?: string;
}

export interface HomebrewConfig {
  packages?: HomebrewPackage[];
}

export interface PackagesConfig {
  dnf?: string[];
  flatpak?: string[];
  homebrew?: HomebrewConfig;
}

export interface SetupConfig {
  version?: number;
  dotfiles?: string[];
  repositories?: {
    rpm?: RpmRepository[];
  };
  packages?: PackagesConfig;
  scripts?: { name: string; run: string }[];
}

export function parseConfig(yamlContent: string): SetupConfig {
  const parsedConfig: SetupConfig = {};
  if (!yamlContent || yamlContent.trim() === "") {
    return parsedConfig;
  }

  // deno-lint-ignore no-explicit-any
  const result = parse(yamlContent) as any;
  if (!result || typeof result !== "object") {
    return parsedConfig;
  }

  parsedConfig.version = typeof result.version === "number" ? result.version : undefined;
  
  if (Array.isArray(result.dotfiles)) {
    parsedConfig.dotfiles = result.dotfiles;
  }

  if (result.repositories && result.repositories.rpm && Array.isArray(result.repositories.rpm)) {
    parsedConfig.repositories = { rpm: result.repositories.rpm };
  }

  if (result.packages) {
    parsedConfig.packages = {};
    if (Array.isArray(result.packages.dnf)) {
      parsedConfig.packages.dnf = result.packages.dnf;
    }
    if (Array.isArray(result.packages.flatpak)) {
      parsedConfig.packages.flatpak = result.packages.flatpak;
    }
    if (result.packages.homebrew && Array.isArray(result.packages.homebrew.packages)) {
      parsedConfig.packages.homebrew = { packages: result.packages.homebrew.packages };
    }
  }

  if (Array.isArray(result.scripts)) {
    parsedConfig.scripts = result.scripts;
  }

  return parsedConfig;
}
