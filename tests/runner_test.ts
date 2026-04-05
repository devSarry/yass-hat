import { assertEquals } from "@std/assert";
import { slugify } from "../src/runner.ts";

Deno.test("slugify - sanitizes string correctly", () => {
  assertEquals(slugify("Install Rust"), "install-rust");
  assertEquals(slugify("Create Projects Directory"), "create-projects-directory");
  assertEquals(slugify("Hello (World) & Universe!"), "hello-world-universe");
  assertEquals(slugify("---test---"), "test");
});
