import { expect, it } from "vitest";
import { configuration } from "./config";
import { createPool } from "./postgres";
const valid = {
  DATABASE_URL: "postgresql://synthetic:synthetic@127.0.0.1/test_config",
  BETTER_AUTH_SECRET: "synthetic-config-secret-000000000000000000",
  BETTER_AUTH_URL: "http://localhost:3000",
};
it("requires explicit runtime-only configuration and validates origin, secrets and port", () => {
  expect(configuration(valid)).toMatchObject({
    origin: "http://localhost:3000",
    port: 4000,
    hostname: "127.0.0.1",
  });
  expect(
    configuration({
      ...valid,
      BETTER_AUTH_URL: "https://app.example.test",
      API_PORT: "4001",
    }).port,
  ).toBe(4001);
  for (const override of [
    { DATABASE_URL: "" },
    { DATABASE_URL: "sqlite:/tmp/no" },
    { BETTER_AUTH_SECRET: "example-placeholder-secret-000000000000000" },
    { BETTER_AUTH_SECRET: "short" },
    { BETTER_AUTH_URL: "http://evil.test" },
    { BETTER_AUTH_URL: "https://app.test/path" },
    { BETTER_AUTH_URL: "https://user:pass@app.test" },
    { BETTER_AUTH_URL: "https://app.test/?query=x" },
    { API_PORT: "0" },
    { API_PORT: "65536" },
    { API_PORT: "not-a-port" },
  ])
    expect(() => configuration({ ...valid, ...override })).toThrow();
});
it("cannot override guard/timeouts/search_path through a connection URL", () => {
  expect(() =>
    createPool(
      `${valid.DATABASE_URL}?options=-c%20default_transaction_read_only=off`,
      { readOnly: true },
    ),
  ).toThrow("must not override");
  expect(() =>
    createPool(valid.DATABASE_URL, { schema: "public; DROP SCHEMA public" }),
  ).toThrow("Invalid owned test schema");
});
