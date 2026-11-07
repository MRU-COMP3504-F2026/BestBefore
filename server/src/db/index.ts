import "../env.js";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema.js";

export const db = drizzle(neon(process.env.DATABASE_URL!), { schema });


// import { config } from "dotenv";
// import { neon } from "@neondatabase/serverless";
// import { drizzle } from "drizzle-orm/neon-http";
// import * as schema from "./schema.js";

// // 1. Load the .env file immediately
// config();

// // 2. Add a safety check so you know exactly what's failing
// if (!process.env.DATABASE_URL) {
//   throw new Error("DATABASE_URL is missing! Check your .env file location.");
// }

// // 3. Connect
// export const db = drizzle(neon(process.env.DATABASE_URL), { schema });