import { NextResponse } from "next/server";

import { RegistryError, buildRegistryItem } from "../../../../lib/registry";

export async function GET(
  _request: Request,
  context: { params: Promise<{ name: string }> },
): Promise<NextResponse> {
  const { name } = await context.params;
  try {
    return NextResponse.json(buildRegistryItem(name));
  } catch (error) {
    if (error instanceof RegistryError && error.code === "registry/not-found") {
      return NextResponse.json({ error: "Registry item was not found." }, { status: 404 });
    }
    // Misconfiguration or corrupt bundle: generic shape, no internals.
    return NextResponse.json({ error: "Registry unavailable." }, { status: 500 });
  }
}
