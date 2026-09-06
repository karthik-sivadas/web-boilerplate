import { z } from "zod";
const schema = z.object({
  HOST: z.string().default("0.0.0.0"),
  PORT: z.coerce.number().int().positive().default(3000),
});
export const serverEnv = schema.parse(process.env);
