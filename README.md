# YAML-Drive Setup

A CLI tool designed to completely automate and manage a Fedora Linux workstation
setup from a simple `packages.yaml` configuration profile.

It handles adding `.repo` configuration files, managing DNF, Flatpak, and
Homebrew applications, injecting commands into dotfiles, and executing
standalone shell scripts entirely driven by a yaml.

## Configuration

Your target system state is managed by a YAML. The CLI looks for a
`packages.yaml` format out-of-the-box:

```yaml
version: 1

# List arbitrary dotfiles to dynamically append installation instructions to later.
dotfiles:
  - ~/.zshrc

repositories:
  rpm:
    - id: vscode
      import_key: "https://packages.microsoft.com/keys/microsoft.asc"
      repo_file: /etc/yum.repos.d/vscode.repo
      content: |
        [code]
        name=Visual Studio Code
        baseurl=https://packages.microsoft.com/yumrepos/vscode
        enabled=1

packages:
  dnf:
    - htop
  flatpak:
    - com.bitwarden.desktop
  homebrew:
    packages:
      - name: atuin
        append_to_dotfile: |
          eval "$(atuin init zsh --disable-up-arrow)"

# You can supply completely arbitrary bash commands to run cleanly and safely!
scripts:
  - name: Install Rust
    run: curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
```

> **Note:** The CLI operates idempotently. Once a custom script executes or an
> RPM repository is created securely, the tool generates a hidden status marker
> (e.g., `install-rust.done`) inside your `~/.local/state/yass-hat/` state
> directory. Subsequent runs will skip duplicating those operations entirely.

## How to use the CLI

Either download the binary from the release page or run it using deno.

If you are using the binary, you can run it like this:

```bash
./yass-hat packages.yaml
```

If you are using deno, you can run it like this:

```bash
# Run against the default packages.yaml
deno run --allow-read --allow-write --allow-run --allow-env src/main.ts

# Pass a specific path
deno run --allow-read --allow-write --allow-run --allow-env src/main.ts ./custom_setup.yaml
```

> **Heads Up:** Operations that modify root directories (such as writing to
> `/etc/yum.repos.d/`) will dynamically trigger `sudo` blocks. Stay attentive to
> enter your root credentials if a timeout expires.

## Development

Running local edits and verifying changes against Deno standard definitions is
incredibly simple.

### Building a standalone binary

Deno makes it incredibly easy to compile your CLI tool into a standalone,
statically-linked executable so you don't even need Deno installed to run it
later!

You can build your CLI using the provided Deno task:

```bash
deno task build
```

This will compile the tool and output an executable named `yass-hat` in your
directory.

You can then run the standalone binary directly:

```bash
./yass-hat packages.yaml
```

### Running Tests

The project features multiple standardized parsing and pathing tests. Execute
them simply from the root directory:

```bash
deno test
```

### Modifying and Debugging

There is an integrated `.vscode/launch.json` profile designed for debugging
out-of-the-box. When you hit F5 or trigger the "Launch Program" tab from the VS
Code Debugger side panel, it attaches automatically to `main.ts` while executing
`packages.yaml`. You can smoothly plant breakpoints down `parser.ts` or
`runner.ts` and inspect objects line-by-line while parsing your layout
configuration schema dynamically.
