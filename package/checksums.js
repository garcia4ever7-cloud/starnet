#!/usr/bin/env node
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const packageVersion = require("./package.json").version;
const manifestPath = path.join(__dirname, "checksums.json");

function archiveNames(version) {
  return ["darwin", "linux", "windows"].flatMap((platform) =>
    ["amd64", "arm64"].map(
      (arch) => `hf_${version}_${platform}_${arch}.tar.gz`
    )
  );
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readManifest(version) {
  if (version !== packageVersion) {
    throw new Error(`checksum version does not match package version ${packageVersion}`);
  }

  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  } catch (err) {
    throw new Error(`cannot read bundled checksums.json: ${err.message}`);
  }
  if (
    !isObject(manifest) ||
    Object.keys(manifest).length !== 2 ||
    manifest.version !== version ||
    !isObject(manifest.archives)
  ) {
    throw new Error(`invalid checksum manifest for package version ${version}`);
  }

  const names = archiveNames(version);
  if (
    Object.keys(manifest.archives).length !== names.length ||
    names.some(
      (name) =>
        !Object.prototype.hasOwnProperty.call(manifest.archives, name) ||
        typeof manifest.archives[name] !== "string" ||
        !/^[a-f0-9]{64}$/i.test(manifest.archives[name])
    )
  ) {
    throw new Error("checksum manifest must contain exactly six valid archive SHA-256 hashes");
  }
  return manifest;
}

function getExpectedChecksum(version, archiveName) {
  const manifest = readManifest(version);
  if (!Object.prototype.hasOwnProperty.call(manifest.archives, archiveName)) {
    throw new Error(`no bundled SHA-256 checksum for ${archiveName}`);
  }
  return manifest.archives[archiveName].toLowerCase();
}

async function sha256File(filePath) {
  const hash = crypto.createHash("sha256");
  for await (const chunk of fs.createReadStream(filePath)) {
    hash.update(chunk);
  }
  return hash.digest("hex");
}

async function prepare(distDir) {
  const archives = {};
  for (const name of archiveNames(packageVersion)) {
    archives[name] = await sha256File(path.join(distDir, name));
  }
  const temporaryPath = `${manifestPath}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(
      temporaryPath,
      JSON.stringify({ version: packageVersion, archives }, null, 2) + "\n",
      { flag: "wx" }
    );
    fs.renameSync(temporaryPath, manifestPath);
  } finally {
    try {
      fs.unlinkSync(temporaryPath);
    } catch (err) {
      if (err.code !== "ENOENT") throw err;
    }
  }
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === "prepare" && args.length === 1) {
    await prepare(args[0]);
  } else if (command === "check" && args.length === 0) {
    readManifest(packageVersion);
  } else {
    throw new Error("usage: node checksums.js prepare <dist-directory> | check");
  }
}

module.exports = { sha256File, getExpectedChecksum };

if (require.main === module) {
  main().catch((err) => {
    console.error(`@higgsfield/cli: ${err.message}`);
    process.exitCode = 1;
  });
}
