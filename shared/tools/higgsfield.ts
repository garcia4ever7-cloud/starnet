import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

export interface HiggsfieldGenParams {
  prompt: string;
  resolution?: string;
  aspect_ratio?: string;
}

export async function generateHiggsfieldImage(params: HiggsfieldGenParams): Promise<string> {
  const apiKey = process.env.HF_KEY;
  if (!apiKey) {
    throw new Error("HF_KEY missing from environment variables.");
  }

  const res = await fetch("https://api.higgsfield.ai/higgsfield-ai/soul/v2/standard", {
    method: "POST",
    headers: {
      "Authorization": `Key ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      prompt: params.prompt,
      resolution: params.resolution || "1080p",
      aspect_ratio: params.aspect_ratio || "4:3"
    })
  });

  const initData = await res.json();
  if (!res.ok || !initData.status_url) {
    throw new Error(`Higgsfield submission failed: ${JSON.stringify(initData)}`);
  }

  const statusUrl = initData.status_url;
  let attempts = 0;

  while (attempts < 40) {
    attempts++;
    await sleep(3000);

    const pollRes = await fetch(statusUrl, {
      headers: { "Authorization": `Key ${apiKey}` }
    });
    const pollData = await pollRes.json();

    if (pollData.status === "completed") {
      const imageUrl = pollData.images?.[0]?.url || pollData.output?.[0];
      if (!imageUrl) throw new Error("Completed response missing image URL");
      return imageUrl;
    } else if (pollData.status === "failed") {
      throw new Error(`Higgsfield generation failed: ${JSON.stringify(pollData)}`);
    }
  }

  throw new Error("Higgsfield generation timed out after 120 seconds.");
}

