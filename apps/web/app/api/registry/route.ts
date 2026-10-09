import { NextResponse } from "next/server";

import { buildRegistryIndex } from "../../../lib/registry";

export function GET(): NextResponse {
  return NextResponse.json(buildRegistryIndex());
}
