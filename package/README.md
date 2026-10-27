# @higgsfield/cli

Higgsfield AI CLI — generate images and videos from the terminal.

## Install

```bash
npm install -g @higgsfield/cli
```

Postinstall fetches the prebuilt `hf` binary for your platform from the [GitHub release](https://github.com/higgsfield-ai/cli/releases).
It verifies the archive's SHA-256 against checksums bundled in this npm package before extracting the binary. Installation fails if the checksum is missing or does not match.

Supported platforms: macOS, Linux, Windows (x64, arm64).

## Usage

```bash
higgsfield auth login
higgsfield generate create text2image_soul_v2 --prompt "a cat in a spaceship"
higgsfield --help
```

Aliases: `higgsfield`, `higgs`.

## Packaging

Release CI generates `checksums.json` from the six local GoReleaser archives before publishing. For local packaging, set `npm/package.json` to the release version and build its archives into `dist`, then run from the repository root:

```bash
node npm/checksums.js prepare dist
cd npm
npm pack
```

The generated manifest is included in the npm package. The `prepack` check rejects missing or invalid checksums and version mismatches.

## Links

- Source: https://github.com/higgsfield-ai/cli-src
- Releases: https://github.com/higgsfield-ai/cli/releases
- Higgsfield: https://higgsfield.ai
