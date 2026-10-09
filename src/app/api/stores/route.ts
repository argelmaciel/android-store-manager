import { NextResponse } from "next/server";
import { getUserId } from "@/lib/auth";

import { supabaseAdmin } from "@/lib/supabase";

export async function GET() {
  const { data, error } = await supabaseAdmin
    .from("stores")
    .select("*")
    .eq("is_active", true)
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ data });
}

export async function POST(request: Request) {
  const userId = await getUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { name, description, slug, logo_url, phone, address } =
    body as {
      name?: string;
      description?: string;
      slug?: string;
      logo_url?: string;
      phone?: string;
      address?: string;
    };

  if (!name || !slug) {
    return NextResponse.json(
      { error: "name and slug are required" },
      { status: 400 }
    );
  }

  const { data, error } = await supabaseAdmin
    .from("stores")
    .insert({
      name,
      description,
      slug,
      logo_url,
      phone,
      address,
      owner_id: userId,
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ data }, { status: 201 });
}
