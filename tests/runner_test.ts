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
  SystemAdapter
} from "../src/runner.ts";

class MockSystemAdapter implements SystemAdapter {
  commandsRun: string[][] = [];
  filesWritten: Map<string, string> = new Map();
  filesRead: Map<string, string> = new Map();
  directoriesCreated: string[] = [];
  filesExist: Set<string> = new Set();
  tempFileCounter = 0;

  async runCommand(command: string[], _env?: Record<string, string>): Promise<void> {
    this.commandsRun.push(command);
  }

  async writeTextFile(path: string, content: string, options?: Deno.WriteFileOptions): Promise<void> {
    if (options?.append) {
      const current = this.filesWritten.get(path) || this.filesRead.get(path) || "";
      this.filesWritten.set(path, current + content);
    } else {
      this.filesWritten.set(path, content);
    }
    this.filesExist.add(path);
  }

  async readTextFile(path: string): Promise<string> {
    if (this.filesWritten.has(path)) {
      return this.filesWritten.get(path)!;
    }
    if (this.filesRead.has(path)) {
      return this.filesRead.get(path)!;
    }
    throw new Deno.errors.NotFound(`File not found: ${path}`);
  }

  async mkdir(path: string, _options?: Deno.MkdirOptions): Promise<void> {
    this.directoriesCreated.push(path);
  }

  async stat(path: string): Promise<Deno.FileInfo> {
    if (this.filesExist.has(path)) {
      return { isFile: true, isDirectory: false, isSymlink: false, size: 0, mtime: null, atime: null, birthtime: null, ctime: null, dev: 0, ino: null, mode: null, nlink: null, uid: null, gid: null, rdev: null, blksize: null, blocks: null, isBlockDevice: false, isCharDevice: false, isFifo: false, isSocket: false };
    }
    throw new Deno.errors.NotFound(`File not found: ${path}`);
  }

  async makeTempFile(): Promise<string> {
    this.tempFileCounter++;
    return `/tmp/mock-temp-file-${this.tempFileCounter}`;
  }
}

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
    const sys = new MockSystemAdapter();
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
    const sys = new MockSystemAdapter();
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
    const sys = new MockSystemAdapter();
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
    const sys = new MockSystemAdapter();
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
