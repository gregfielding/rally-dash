/**
 * Classify dropped files for bulk design upload: accept png/svg/pdf or ignore with reason.
 */

const IGNORED_EXT = new Set([
  "ai",
  "psd",
  "sketch",
  "xd",
  "tmp",
  "ds_store",
]);

export type IgnoredFileReason =
  | "unsupported_extension"
  | "hidden_file"
  | "zero_bytes"
  | "no_extension";

export type IgnoredFileEntry = {
  name: string;
  reason: IgnoredFileReason;
  detail?: string;
};

export type AcceptedFileEntry = {
  file: File;
  ext: string;
};

function getExt(name: string): string {
  const i = name.lastIndexOf(".");
  if (i === -1) return "";
  return name.slice(i + 1).toLowerCase();
}

function isHidden(name: string): boolean {
  const base = name.split(/[/\\]/).pop() ?? name;
  return base.startsWith(".") && base !== "." && base !== "..";
}

export function filterBulkDesignFiles(fileList: File[]): {
  accepted: AcceptedFileEntry[];
  ignored: IgnoredFileEntry[];
} {
  const accepted: AcceptedFileEntry[] = [];
  const ignored: IgnoredFileEntry[] = [];

  for (const file of fileList) {
    const name = file.name;
    if (isHidden(name)) {
      ignored.push({ name, reason: "hidden_file" });
      continue;
    }
    if (file.size === 0) {
      ignored.push({ name, reason: "zero_bytes" });
      continue;
    }
    const ext = getExt(name);
    if (!ext) {
      ignored.push({ name, reason: "no_extension" });
      continue;
    }
    if (IGNORED_EXT.has(ext)) {
      ignored.push({ name, reason: "unsupported_extension", detail: `.${ext}` });
      continue;
    }
    if (ext !== "png" && ext !== "svg" && ext !== "pdf") {
      ignored.push({ name, reason: "unsupported_extension", detail: `.${ext}` });
      continue;
    }
    accepted.push({ file, ext });
  }

  return { accepted, ignored };
}
