import { higgsfield } from "@higgsfield/client/v2";
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

async function run() {
  const agents = (higgsfield as any).agents;
  console.log("Agents keys:", Object.keys(agents));
  console.log("Agents prototype:", Object.getOwnPropertyNames(Object.getPrototypeOf(agents)));
  if (agents.sessions) {
    console.log("Sessions keys:", Object.keys(agents.sessions));
    console.log("Sessions prototype:", Object.getOwnPropertyNames(Object.getPrototypeOf(agents.sessions)));
  }
}
run();
