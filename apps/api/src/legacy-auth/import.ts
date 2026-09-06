import { DatabaseSync } from "node:sqlite";
import { isAbsolute } from "node:path";
import { createHash } from "node:crypto";
import type { Pool } from "pg";
import { transaction } from "../infrastructure/postgres";
import { z } from "zod";
import {
  sessionSchema,
  expectedSessionIdSchema,
} from "@workspace/contracts/v1";
const calendarTimestamp = z.iso.datetime({ offset: true });
const columns = {
  user: [
    "id",
    "name",
    "email",
    "emailVerified",
    "image",
    "createdAt",
    "updatedAt",
  ],
  account: [
    "id",
    "accountId",
    "providerId",
    "userId",
    "accessToken",
    "refreshToken",
    "idToken",
    "accessTokenExpiresAt",
    "refreshTokenExpiresAt",
    "scope",
    "password",
    "createdAt",
    "updatedAt",
  ],
  session: [
    "id",
    "expiresAt",
    "token",
    "createdAt",
    "updatedAt",
    "ipAddress",
    "userAgent",
    "userId",
  ],
  verification: [
    "id",
    "identifier",
    "value",
    "expiresAt",
    "createdAt",
    "updatedAt",
  ],
  rateLimit: ["id", "key", "count", "lastRequest"],
} as const;
type Table = keyof typeof columns;
const order: Table[] = [
  "user",
  "account",
  "session",
  "verification",
  "rateLimit",
];
const nullable = new Set([
  "image",
  "accessToken",
  "refreshToken",
  "idToken",
  "accessTokenExpiresAt",
  "refreshTokenExpiresAt",
  "scope",
  "password",
  "ipAddress",
  "userAgent",
]);
export interface LegacyAuthOptions {
  sourceCopy: string;
  confirmOffline: boolean;
  confirmStableSecret: boolean;
  stableSecret: string;
  timestampUnit?: "seconds" | "milliseconds";
}
function timestamp(value: unknown, unit: LegacyAuthOptions["timestampUnit"]) {
  let date: Date;
  if (typeof value === "number" && Number.isSafeInteger(value) && unit)
    date = new Date(value * (unit === "seconds" ? 1000 : 1));
  else if (
    typeof value === "string" &&
    /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?(?:Z|[+-]\d\d:\d\d)$/.test(
      value,
    ) &&
    calendarTimestamp.safeParse(value).success
  )
    date = new Date(value);
  else
    throw new Error(
      "Ambiguous legacy timestamp; choose an explicit numeric timestamp unit.",
    );
  if (
    !Number.isFinite(date.getTime()) ||
    date.getUTCFullYear() < 2000 ||
    date.getUTCFullYear() > 2100
  )
    throw new Error("Legacy timestamp outside supported range.");
  return date.toISOString();
}
export async function importLegacyAuth(pool: Pool, options: LegacyAuthOptions) {
  if (
    !isAbsolute(options.sourceCopy) ||
    !options.confirmOffline ||
    !options.confirmStableSecret ||
    options.stableSecret.length < 32
  )
    throw new Error(
      "Explicit absolute source COPY, offline confirmation and stable-secret confirmation required.",
    );
  // Secret cannot be inferred from a SQLite file; confirmation is an operator assertion.
  const source = new DatabaseSync(options.sourceCopy, { readOnly: true });
  const data = {} as Record<Table, Record<string, unknown>[]>;
  try {
    source.exec("BEGIN");
    for (const table of order) {
      const rows = source
        .prepare(
          `SELECT ${columns[table].map((name) => `"${name}"`).join(",")} FROM "${table}" ORDER BY id LIMIT 50001`,
        )
        .all();
      if (rows.length > 50000)
        throw new Error(
          "Legacy import exceeds the 50,000-row per-table limit.",
        );
      data[table] = rows.map((row) =>
        Object.fromEntries(
          columns[table].map((name) => {
            let value: unknown = row[name];
            if (value === null && nullable.has(name)) return [name, null];
            if (name.endsWith("At"))
              value = timestamp(value, options.timestampUnit);
            else if (name === "emailVerified") {
              if (value !== 0 && value !== 1)
                throw new Error("Invalid legacy boolean.");
              value = value === 1;
            } else if (name === "count" || name === "lastRequest") {
              if (
                typeof value !== "number" ||
                !Number.isSafeInteger(value) ||
                value < 0
              )
                throw new Error("Invalid legacy rate-limit integer.");
            } else if (
              typeof value !== "string" ||
              value.includes(String.fromCharCode(0)) ||
              (!nullable.has(name) && value.length === 0)
            )
              throw new Error("Invalid legacy text field.");
            return [name, value];
          }),
        ),
      );
      if (new Set(data[table].map((row) => row.id)).size !== rows.length)
        throw new Error("Duplicate legacy IDs.");
    }
    source.exec("COMMIT");
  } finally {
    source.close();
  }
  // Validate the preserved identity against the actual consuming wire contracts.
  // Never transform/remap source IDs or report success for an unusable identity.
  if (
    data.user.some(
      (row) =>
        !sessionSchema.shape.user.safeParse({
          id: row.id,
          name: row.name,
          email: row.email,
        }).success,
    ) ||
    data.session.some(
      (row) => !expectedSessionIdSchema.safeParse(row.id).success,
    )
  )
    throw new Error(
      "Legacy identity is incompatible with the runtime contract.",
    );
  const users = new Set(data.user.map((row) => row.id));
  if (
    data.account.some((row) => !users.has(row.userId)) ||
    data.session.some((row) => !users.has(row.userId))
  )
    throw new Error("Orphan legacy account or session.");
  const fingerprint = createHash("sha256")
    .update(JSON.stringify(data))
    .digest("hex");
  const counts = Object.fromEntries(
    order.map((table) => [table, data[table].length]),
  );
  return transaction(pool, "write", async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(187643210,2)");
    if (
      (
        await client.query(
          "SELECT fingerprint FROM legacy_auth_receipt WHERE fingerprint=$1",
          [fingerprint],
        )
      ).rowCount
    )
      return { fingerprint, counts, alreadyImported: true };
    for (const table of [...order, "workspace", "legacy_auth_receipt"])
      if ((await client.query(`SELECT 1 FROM "${table}" LIMIT 1`)).rowCount)
        throw new Error(
          "Legacy auth import requires an empty PostgreSQL destination.",
        );
    for (const table of order) {
      const names = columns[table];
      for (let offset = 0; offset < data[table].length; offset += 250) {
        const rows = data[table].slice(offset, offset + 250);
        const parameters = rows.flatMap((row) =>
          names.map((name) => row[name]),
        );
        const values = rows
          .map(
            (_, index) =>
              `(${names.map((_, column) => `$${index * names.length + column + 1}`).join(",")})`,
          )
          .join(",");
        await client.query(
          `INSERT INTO "${table}" (${names.map((name) => `"${name}"`).join(",")}) VALUES ${values}`,
          parameters,
        );
      }
    }
    await client.query(
      "INSERT INTO legacy_auth_receipt(fingerprint,counts) VALUES($1,$2)",
      [fingerprint, JSON.stringify(counts)],
    );
    return { fingerprint, counts, alreadyImported: false };
  });
}
