import { NextResponse } from "next/server";

import { buildHealthPayload } from "./payload";

export function GET(): NextResponse {
  return NextResponse.json(buildHealthPayload());
}
