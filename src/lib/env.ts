import { z } from "zod";
const publicSchema = z.object({
  VITE_APP_NAME: z.string().min(1).default("Workbench"),
});
const serverSchema = z.object({
  HOST: z.string().default("0.0.0.0"),
  PORT: z.coerce.number().int().positive().default(3000),
});
export const publicEnv = publicSchema.parse({
  VITE_APP_NAME:
    typeof import.meta.env.VITE_APP_NAME === "string"
      ? import.meta.env.VITE_APP_NAME
      : undefined,
});
export const serverEnv =
  typeof window === "undefined" ? serverSchema.parse(process.env) : undefined;
