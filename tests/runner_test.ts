import { assertEquals, assertThrows } from "@std/assert";
import {
  slugify,
  resolvePath,
  getMarkerDirPath,
  hasMarker,
  setMarker,
  setupRpmRepo,
  appendToDotfiles,
  runScript,
  checkPrerequisites} from "../src/runner.ts";
import { SystemAdapter } from "../src/adapters/SystemAdapter.ts";

interface MockSystemAdapter extends SystemAdapter {
  commandsRun: string[][];
  filesWritten: Map<string, string>;
  filesRead: Map<string, string>;
  directoriesCreated: string[];
  filesExist: Set<string>;
  tempFileCounter: number;
  mockCommandExists: Record<string, boolean>;
  mockConfirmResponse: boolean;
}

const createMockSystemAdapter = (): MockSystemAdapter => {
  const adapter: MockSystemAdapter = {
    commandsRun: [],
    filesWritten: new Map(),
    filesRead: new Map(),
    directoriesCreated: [],
    filesExist: new Set(),
    tempFileCounter: 0,
    mockCommandExists: {},
    mockConfirmResponse: true,

    commandExists: async (cmd: string): Promise<boolean> => {
      return adapter.mockCommandExists[cmd] ?? true;
    },

    confirm: async (_message: string): Promise<boolean> => {
      return adapter.mockConfirmResponse;
    },

    runCommand: async (command: string[], _env?: Record<string, string>): Promise<void> => {
      adapter.commandsRun.push(command);
    },

    writeTextFile: async (path: string, content: string, options?: Deno.WriteFileOptions): Promise<void> => {
      if (options?.append) {
        const current = adapter.filesWritten.get(path) || adapter.filesRead.get(path) || "";
        adapter.filesWritten.set(path, current + content);
      } else {
        adapter.filesWritten.set(path, content);
      }
      adapter.filesExist.add(path);
    },

    readTextFile: async (path: string): Promise<string> => {
      if (adapter.filesWritten.has(path)) {
        return adapter.filesWritten.get(path)!;
      }
      if (adapter.filesRead.has(path)) {
        return adapter.filesRead.get(path)!;
      }
      throw new Deno.errors.NotFound(`File not found: ${path}`);
    },

    mkdir: async (path: string, _options?: Deno.MkdirOptions): Promise<void> => {
      adapter.directoriesCreated.push(path);
    },

    stat: async (path: string): Promise<Deno.FileInfo> => {
      if (adapter.filesExist.has(path)) {
        return { isFile: true, isDirectory: false, isSymlink: false, size: 0, mtime: null, atime: null, birthtime: null, ctime: null, dev: 0, ino: null, mode: null, nlink: null, uid: null, gid: null, rdev: null, blksize: null, blocks: null, isBlockDevice: false, isCharDevice: false, isFifo: false, isSocket: false };
      }
      throw new Deno.errors.NotFound(`File not found: ${path}`);
    },

    makeTempFile: async (): Promise<string> => {
      adapter.tempFileCounter++;
      return `/tmp/mock-temp-file-${adapter.tempFileCounter}`;
    }
  };

  return adapter;
};

Deno.test("slugify - sanitizes string correctly", () => {
  assertEquals(slugify("Install Rust"), "install-rust");
  assertEquals(slugify("Create Projects Directory"), "create-projects-directory");
  assertEquals(slugify("Hello (World) & Universe!"), "hello-world-universe");
  assertEquals(slugify("---test---"), "test");
});

Deno.test("resolvePath - replaces ~ with HOME", () => {
  const originalHome = Deno.env.get("HOME");
  Deno.env.set("HOME", "/home/testuser");
  try {
    assertEquals(resolvePath("~/some/path"), "/home/testuser/some/path");
    assertEquals(resolvePath("/absolute/path"), "/absolute/path");
    assertEquals(resolvePath("relative/path"), "relative/path");
  } finally {
    if (originalHome) Deno.env.set("HOME", originalHome);
    else Deno.env.delete("HOME");
  }
});

Deno.test("resolvePath - throws when HOME is missing and using ~", () => {
  const originalHome = Deno.env.get("HOME");
  Deno.env.delete("HOME");
  try {
    assertThrows(() => {
      resolvePath("~/missing");
    });
  } finally {
    if (originalHome) Deno.env.set("HOME", originalHome);
  }
});

Deno.test("getMarkerDirPath - uses XDG_STATE_HOME or HOME", () => {
  const originalXdg = Deno.env.get("XDG_STATE_HOME");
  const originalHome = Deno.env.get("HOME");
  
  Deno.env.set("XDG_STATE_HOME", "/custom/state");
  try {
    assertEquals(getMarkerDirPath(), "/custom/state/yass-hat");
    
    Deno.env.delete("XDG_STATE_HOME");
    Deno.env.set("HOME", "/home/test");
    assertEquals(getMarkerDirPath(), "/home/test/.local/state/yass-hat");
    
    Deno.env.delete("HOME");
    assertThrows(() => {
      getMarkerDirPath();
    });
  } finally {
    if (originalXdg) Deno.env.set("XDG_STATE_HOME", originalXdg);
    else Deno.env.delete("XDG_STATE_HOME");
    
    if (originalHome) Deno.env.set("HOME", originalHome);
    else Deno.env.delete("HOME");
  }
});

Deno.test("hasMarker and setMarker - operate correctly", async () => {
  const originalHome = Deno.env.get("HOME");
  Deno.env.set("HOME", "/home/test");
  try {
    const sys = createMockSystemAdapter();
    const result1 = await hasMarker("my-task", sys);
    assertEquals(result1, false);

    await setMarker("my-task", sys);
    
    assertEquals(sys.directoriesCreated, ["/home/test/.local/state/yass-hat"]);
    assertEquals(sys.filesExist.has("/home/test/.local/state/yass-hat/my-task.done"), true);

    const result2 = await hasMarker("my-task", sys);
    assertEquals(result2, true);
  } finally {
    if (originalHome) Deno.env.set("HOME", originalHome);
    else Deno.env.delete("HOME");
  }
});

Deno.test("setupRpmRepo - sets up repo and sets marker", async () => {
  const originalHome = Deno.env.get("HOME");
  Deno.env.set("HOME", "/home/test");
  try {
    const sys = createMockSystemAdapter();
    const repo = {
      id: "google-chrome",
      name: "Google Chrome",
      repo_file: "/etc/yum.repos.d/google-chrome.repo",
      content: "[google-chrome]\nname=google-chrome\nbaseurl=http://dl.google.com/...",
      import_key: "https://dl.google.com/linux/linux_signing_key.pub",
    };

    await setupRpmRepo(repo, sys);

    assertEquals(sys.commandsRun.length, 3);
    assertEquals(sys.commandsRun[0].join(" "), "sudo rpm --import https://dl.google.com/linux/linux_signing_key.pub");
    assertEquals(sys.commandsRun[1].join(" "), "sudo mv /tmp/mock-temp-file-1 /etc/yum.repos.d/google-chrome.repo");
    assertEquals(sys.commandsRun[2].join(" "), "sudo chmod 644 /etc/yum.repos.d/google-chrome.repo");
    
    assertEquals(sys.filesWritten.get("/tmp/mock-temp-file-1"), repo.content);
    const markerTrue = await hasMarker("repo-google-chrome", sys);
    assertEquals(markerTrue, true);

    // Call again, should skip
    sys.commandsRun = [];
    await setupRpmRepo(repo, sys);
    assertEquals(sys.commandsRun.length, 0); // Skipping
  } finally {
    if (originalHome) Deno.env.set("HOME", originalHome);
    else Deno.env.delete("HOME");
  }
});

Deno.test("appendToDotfiles - appends uniquely", async () => {
  const originalHome = Deno.env.get("HOME");
  Deno.env.set("HOME", "/home/test");
  try {
    const sys = createMockSystemAdapter();
    sys.filesRead.set("/home/test/.bashrc", "echo 'hello'\n");

    await appendToDotfiles("my-app", "alias foo=bar", ["~/.bashrc", "~/.zshrc"], sys);

    // .bashrc should be appended
    const writtenBashrc = sys.filesWritten.get("/home/test/.bashrc");
    assertEquals(writtenBashrc?.includes("alias foo=bar"), true);

    // .zshrc does not exist in mock, should be skipped
    assertEquals(sys.filesWritten.has("/home/test/.zshrc"), false);

    // put the updated content back so second call reads it
    sys.filesRead.set("/home/test/.bashrc", writtenBashrc!);

    await appendToDotfiles("my-app", "alias foo=bar", ["~/.bashrc"], sys);
    // Write map should equal what was there before
    const writtenBashrc2 = sys.filesWritten.get("/home/test/.bashrc");
    assertEquals(writtenBashrc2, writtenBashrc); // Not appended twice
  } finally {
    if (originalHome) Deno.env.set("HOME", originalHome);
    else Deno.env.delete("HOME");
  }
});

Deno.test("runScript - executes bash script and sets marker", async () => {
  const originalHome = Deno.env.get("HOME");
  Deno.env.set("HOME", "/home/test");
  try {
    const sys = createMockSystemAdapter();
    await runScript({ name: "my-script", run: "echo 'hello world'" }, sys);

    assertEquals(sys.commandsRun.length, 1);
    assertEquals(sys.commandsRun[0], ["bash", "-c", "echo 'hello world'"]);
    
    const markerTrue = await hasMarker("my-script", sys);
    assertEquals(markerTrue, true);

    // Call again, should skip
    sys.commandsRun = [];
    await runScript({ name: "my-script", run: "echo 'hello world'" }, sys);
    assertEquals(sys.commandsRun.length, 0);
  } finally {
    if (originalHome) Deno.env.set("HOME", originalHome);
    else Deno.env.delete("HOME");
  }
});

Deno.test("checkPrerequisites - prompts to install flatpak if missing", async () => {
    const sys = createMockSystemAdapter();
    sys.mockCommandExists["flatpak"] = false;
    sys.mockConfirmResponse = true;

    await checkPrerequisites({
      version: 1,
      packages: {
        flatpak: ["org.gimp.GIMP"]
      }
    }, sys);

    assertEquals(sys.commandsRun.length, 2);
    assertEquals(sys.commandsRun[0], ["sudo", "dnf", "install", "-y", "flatpak"]);
});

Deno.test("checkPrerequisites - skips prompt if flatpak is installed", async () => {
    const sys = createMockSystemAdapter();
    sys.mockCommandExists["flatpak"] = true;

    await checkPrerequisites({
      version: 1,
      packages: {
        flatpak: ["org.gimp.GIMP"]
      }
    }, sys);

    assertEquals(sys.commandsRun.length, 0);
});

Deno.test("checkPrerequisites - prompts to install homebrew if missing", async () => {
    const sys = createMockSystemAdapter();
    sys.mockCommandExists["brew"] = false;
    sys.mockConfirmResponse = true;

    await checkPrerequisites({
      version: 1,
      packages: {
        homebrew: {
            packages: [{ name: "ripgrep" }]
        }
      }
    }, sys);

    assertEquals(sys.commandsRun.length, 1);
    assertEquals(sys.commandsRun[0][0], "bash");
    assertEquals(sys.commandsRun[0][2].includes("install.sh"), true);
});
