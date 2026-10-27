import fs from "fs";
import { execSync } from "child_process";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

export async function upscaleAsset(imageUrl: string, resolution: "2k" | "4k" = "4k") {
  const credentials = process.env.HF_CREDENTIALS || process.env.HIGGSFIELD_CREDENTIALS || process.env.HIGGSFIELD_API_KEY;
  if (!credentials) {
    throw new Error("Credentials not found in environment!");
  }

  console.log(`[Upscaler] Reading source asset: ${imageUrl}`);
  const stats = fs.statSync(imageUrl);
  console.log(`[Upscaler] Original file size: ${(stats.size / (1024 * 1024)).toFixed(2)} MB`);

  let targetPath = imageUrl;

  // Compress cleanly and handle non-fatal ffmpeg warnings
  if (stats.size > 1.8 * 1024 * 1024) {
    console.log("[Upscaler] Compressing asset via ffmpeg to clear 2MB gateway limit...");
    targetPath = `/tmp/upscale-compressed.jpg`;
    try {
      execSync(`ffmpeg -y -i "${imageUrl}" -vframes 1 -q:v 8 "${targetPath}"`, { stdio: "ignore" });
    } catch (err) {
      // Fallback if ffmpeg exits with warnings
    }
  }

  if (!fs.existsSync(targetPath)) {
    targetPath = imageUrl;
  }

  const finalStats = fs.statSync(targetPath);
  console.log(`[Upscaler] Final payload size: ${(finalStats.size / (1024 * 1024)).toFixed(2)} MB`);

  const imageBuffer = fs.readFileSync(targetPath);
  const formData = new FormData();
  const blob = new Blob([imageBuffer], { type: "image/jpeg" });
  formData.append("image", blob, "asset.jpg");
  formData.append("target_resolution", resolution);
  formData.append("enhance", "true");

  console.log("[Upscaler] Sending request to Higgsfield API...");
  const response = await fetch("https://api.higgsfield.ai/v1/images/upscale", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${credentials}`
    },
    body: formData
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Higgsfield API Error (${response.status}): ${errText}`);
  }

  const data: any = await response.json();
  return data.url || data.image_url || data.output_url;
}

export default upscaleAsset;
