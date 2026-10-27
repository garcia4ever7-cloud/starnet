import { higgsfield } from "@higgsfield/client/v2";
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

console.log("Higgsfield keys:", Object.keys(higgsfield));
console.log("Higgsfield full structure:", JSON.stringify(higgsfield, null, 2));
