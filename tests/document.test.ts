/**
 * The single document-loading path used by both the file picker and the
 * Android share target.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { DocumentError, documentFromFile, isSupportedName } from "../src/document/document.js";

/** A minimal stand-in for the parts of File the loader touches. */
function fileLike(name: string, text: string): File {
  return { name, text: async () => text } as unknown as File;
}

test("only .md and .markdown are supported", () => {
  assert.equal(isSupportedName("notes.md"), true);
  assert.equal(isSupportedName("notes.markdown"), true);
  assert.equal(isSupportedName("NOTES.MD"), true);
  assert.equal(isSupportedName("notes.txt"), false);
  assert.equal(isSupportedName("notes.md.exe"), false);
  assert.equal(isSupportedName("markdown"), false);
  assert.equal(isSupportedName(""), false);
});

test("a supported file becomes a document with its source intact", async () => {
  const source = "# Title\n\nbody\n";
  const doc = await documentFromFile(fileLike("notes.md", source));
  assert.deepEqual(doc, { name: "notes.md", source });
});

test("an unsupported extension is rejected with a readable message", async () => {
  await assert.rejects(() => documentFromFile(fileLike("photo.png", "")), (error: unknown) => {
    assert.ok(error instanceof DocumentError);
    assert.match(error.message, /\.md or \.markdown/);
    return true;
  });
});

test("an unreadable file is reported rather than thrown at the user", async () => {
  const unreadable = {
    name: "notes.md",
    text: async () => {
      throw new Error("NotFoundError");
    },
  } as unknown as File;

  await assert.rejects(() => documentFromFile(unreadable), (error: unknown) => {
    assert.ok(error instanceof DocumentError);
    assert.match(error.message, /could not be read/);
    return true;
  });
});
