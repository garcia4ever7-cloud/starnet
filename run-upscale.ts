import fs from "fs";
import path from "path";
import { upscaleAsset } from "./shared/tools/upscaler";

async function main() {
  const sourcePath = "/data/data/com.termux/files/home/.local/share/StarNet/workspaces/webdesigner/outbox/gothic-blackletter-jesus-4k.png";
  
  console.log(`Reading source asset from: ${sourcePath}`);
  if (!fs.existsSync(sourcePath)) {
    console.error("Error: Source image file not found on disk!");
    return;
  }

  console.log("Initiating Higgsfield 4K upscale...");
  const upscaledUrl = await upscaleAsset(sourcePath, "4k");

  if (upscaledUrl) {
    console.log(`Downloading upscaled asset from: ${upscaledUrl}`);
    const response = await fetch(upscaledUrl);
    const buffer = Buffer.from(await response.arrayBuffer());

    const outboxDir = path.join(process.cwd(), "outbox");
    if (!fs.existsSync(outboxDir)) {
      fs.mkdirSync(outboxDir, { recursive: true });
    }

    const outputPath = path.join(outboxDir, "higgsfield-upscaled-gothic-jesus.png");
    fs.writeFileSync(outputPath, buffer);
    console.log(`Success! Saved 4K print-ready asset to: ${outputPath}`);
  } else {
    console.error("Upscale failed to return a valid URL.");
  }
}

main();
