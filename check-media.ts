import { higgsfield } from "@higgsfield/client/v2";
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

async function run() {
  const media = (higgsfield as any).media;
  console.log("Media keys:", Object.keys(media));
  console.log("Media prototype names:", Object.getOwnPropertyNames(Object.getPrototypeOf(media)));
}
run();
