#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const https = require("https");
const zlib = require("zlib");
const { pipeline } = require("stream");
const { promisify } = require("util");
const { getExpectedChecksum, sha256File } = require("./checksums");

const pipelineAsync = promisify(pipeline);

const pkg = require("./package.json");
const VERSION = pkg.version;

const PLATFORM_MAP = { darwin: "darwin", linux: "linux", win32: "windows" };
const ARCH_MAP = { x64: "amd64", arm64: "arm64" };

const platform = "linux"; // PLATFORM_MAP[process.platform];
const arch = ARCH_MAP[process.arch];

if (!platform || !arch) {
  console.error(
    `@higgsfield/cli: unsupported platform ${process.platform}/${process.arch}`
  );
  console.error("Supported: darwin|linux|windows × x64|arm64");
  process.exit(1);
}

const binName = platform === "windows" ? "hf.exe" : "hf";
const tarball = `hf_${VERSION}_${platform}_${arch}.tar.gz`;
const url = `https://github.com/higgsfield-ai/cli/releases/download/v${VERSION}/${tarball}`;

const vendorDir = path.join(__dirname, "vendor");
const metadataPath = path.join(vendorDir, "install.json");

function detectPackageManager() {
  const ua = process.env.npm_config_user_agent || "";
  if (ua.startsWith("pnpm/")) return "pnpm";
  if (ua.startsWith("yarn/")) return "yarn";
  if (ua.startsWith("bun/")) return "bun";
  return "npm";
}

async function download(targetUrl, dest, redirects = 0) {
  if (redirects > 5) throw new Error("too many redirects");
  const res = await new Promise((resolve, reject) => {
    https.get(targetUrl, resolve).on("error", reject);
  });
  if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
    res.resume();
    return download(new URL(res.headers.location, targetUrl), dest, redirects + 1);
  }
  if (res.statusCode !== 200) {
    res.resume();
    throw new Error(`HTTP ${res.statusCode} for ${targetUrl}`);
  }
  const file = fs.createWriteStream(dest, { flags: "wx", mode: 0o600 });
  await pipelineAsync(res, file);
}

// Minimal tar reader: pulls exactly one top-level regular file out of the
// archive. Shelling out to `tar` breaks on Windows, where the vendor path is a
// backslash path with a drive-letter colon and tar reads it as a remote
// host spec ("Cannot connect to ...\cli\vendor..."), so hf.exe never lands.
// Doing it in-process also drops the dependency on a system tar binary.
function extractFileFromTarGz(archivePath, wantName, destPath) {
  const buf = zlib.gunzipSync(fs.readFileSync(archivePath));
  const BLOCK = 512;

  for (let off = 0; off + BLOCK <= buf.length; ) {
    const header = buf.subarray(off, off + BLOCK);
    // Two consecutive zero blocks terminate the archive.
    if (header.every((b) => b === 0)) break;

    const name = header.subarray(0, 100).toString("utf8").replace(/\0.*$/, "");
    const sizeField = header
      .subarray(124, 136)
      .toString("utf8")
      .replace(/\0.*$/, "")
      .trim();
    const size = parseInt(sizeField, 8);
    if (!Number.isFinite(size) || size < 0) {
      throw new Error(`malformed tar header for entry "${name}"`);
    }
    const typeFlag = String.fromCharCode(header[156]);
    const dataOff = off + BLOCK;

    // Entry names come from a remote archive: never let one escape vendorDir.
    // We only ever match a bare basename, so anything with a separator or a
    // ".." segment is simply not the entry we want.
    const isRegular = typeFlag === "0" || typeFlag === "\0";
    if (isRegular && name === wantName) {
      if (dataOff + size > buf.length) {
        throw new Error(`truncated tar entry "${name}"`);
      }
      fs.writeFileSync(destPath, buf.subarray(dataOff, dataOff + size));
      return true;
    }

    off = dataOff + Math.ceil(size / BLOCK) * BLOCK;
  }
  return false;
}

(async () => {
  const expectedChecksum = getExpectedChecksum(VERSION, tarball);
  fs.mkdirSync(vendorDir, { recursive: true });
  const stagingDir = fs.mkdtempSync(path.join(vendorDir, ".install-"));
  const tarballPath = path.join(stagingDir, tarball);
  try {
    console.log(`@higgsfield/cli: downloading ${url}`);
    await download(url, tarballPath);
    if ((await sha256File(tarballPath)) !== expectedChecksum) {
      throw new Error(`SHA-256 mismatch for ${tarball}; refusing to install`);
    }
    const binPath = path.join(vendorDir, binName);
    if (!extractFileFromTarGz(tarballPath, binName, binPath)) {
      throw new Error(`${binName} not found in ${tarball}`);
    }
    if (platform !== "windows") {
      fs.chmodSync(binPath, 0o755);
    }
    fs.writeFileSync(
      metadataPath,
      JSON.stringify(
        {
          install_method: "npm",
          package_manager: detectPackageManager(),
          package_name: pkg.name,
          version: VERSION,
        },
        null,
        2
      ) + "\n"
    );
  } finally {
    if (fs.existsSync(tarballPath)) fs.unlinkSync(tarballPath);
    fs.rmdirSync(stagingDir);
  }
  console.log("@higgsfield/cli: installed");
})().catch((err) => {
  console.error("@higgsfield/cli: install failed —", err.message);
  process.exit(1);
});
