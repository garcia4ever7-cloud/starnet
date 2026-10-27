import { higgsfield } from "@higgsfield/client/v2";
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

async function run() {
  console.log("Agents property:", (higgsfield as any).agents);
  try {
    if (typeof (higgsfield as any).agents?.list === "function") {
      const list = await (higgsfield as any).agents.list();
      console.log("Available agents list:", list);
    }
  } catch (e) {
    console.log("Could not auto-list agents via method, checking type:", typeof (higgsfield as any).agents);
  }
}
run();
