import { config, higgsfield } from "@higgsfield/client/v2";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

config({
  credentials: process.env.HF_CREDENTIALS,
});

async function generateVideo() {
  try {
    console.log("Submitting Seedance 2.5 Text-to-Video generation request...");
    
    const result = await higgsfield.subscribe(
      "bytedance/seedance-2.5/text-to-video",
      {
        input: {
          prompt: "A cinematic scene at sunset",
          duration: 5,
          resolution: "720p",
          aspect_ratio: "16:9",
          bitrate_mode: "high",
          output_format: "mp4",
          generate_audio: true,
        },
        withPolling: true,
      }
    );

    if (result.status === "completed") {
      const videoUrl = result.video?.url || (result as any).url;
      console.log("Generation completed successfully!");
      console.log("Generated Video URL:", videoUrl);
    } else {
      console.log(`Received terminal status: ${result.status}`, result);
    }
  } catch (error) {
    console.error("Error executing Higgsfield request:", error);
  }
}

generateVideo();
