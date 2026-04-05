import { assertEquals } from "@std/assert";
import { parseConfig } from "../src/parser.ts";

Deno.test("parseConfig - parses well-formed valid YAML", () => {
  const yamlString = `
version: 1
dotfiles:
  - ~/.zshrc
repositories:
  rpm:
    - id: vscode
      import_key: "https://example.com/key"
      repo_file: /etc/yum.repos.d/vscode.repo
      content: "[code]"
packages:
  dnf:
    - htop
    - git
  flatpak:
    - com.visualstudio.code
  homebrew:
    packages:
      - name: atuin
        append_to_dotfile: "eval"
scripts:
  - name: Install Rust
    run: curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
`;

  const config = parseConfig(yamlString);
  assertEquals(config.version, 1);
  assertEquals(config.dotfiles, ["~/.zshrc"]);
  
  assertEquals(config.repositories?.rpm?.length, 1);
  assertEquals(config.repositories?.rpm?.[0].id, "vscode");
  
  assertEquals(config.packages?.dnf, ["htop", "git"]);
  assertEquals(config.packages?.flatpak, ["com.visualstudio.code"]);
  
  assertEquals(config.packages?.homebrew?.packages?.length, 1);
  assertEquals(config.packages?.homebrew?.packages?.length, 1);
  assertEquals(config.packages?.homebrew?.packages?.[0].name, "atuin");
  assertEquals(config.packages?.homebrew?.packages?.[0].append_to_dotfile, "eval");
  
  assertEquals(config.scripts?.length, 1);
  assertEquals(config.scripts?.[0].name, "Install Rust");
});

Deno.test("parseConfig - handles empty YAML", () => {
  const yamlString = "";
  const config = parseConfig(yamlString);
  assertEquals(config.packages?.dnf, undefined);
  assertEquals(config.repositories?.rpm, undefined);
});
