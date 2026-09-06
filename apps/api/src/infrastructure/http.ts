import { HTTPException } from "hono/http-exception";
import type { SessionDto } from "@workspace/contracts/v1";
export interface ApiEnvironment {
  Variables: {
    requestId: string;
    identity: SessionDto;
    requestExpired: boolean;
  };
}
export class HttpFailure extends HTTPException {
  constructor(
    status: 400 | 401 | 403 | 404 | 409 | 413 | 429 | 503,
    public code: string,
    message: string,
  ) {
    super(status, { message });
  }
}
