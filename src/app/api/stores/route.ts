import { NextResponse } from "next/server";
import { getOrCreateProfile, getUserId } from "@/lib/auth";

import { dbErrorResponse } from "@/lib/http";
import { getSupabaseAdmin } from "@/lib/supabase";

export async function GET() {
  const { data, error } = await getSupabaseAdmin()
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

  // stores.owner_id referencia profiles(id): sem a linha de perfil o insert
  // falha na primeira vez que o usuário cria uma loja.
  const profile = await getOrCreateProfile();
  if (!profile) {
    return NextResponse.json(
      { error: "Perfil não encontrado para o usuário autenticado" },
      { status: 404 }
    );
  }

  const { data, error } = await getSupabaseAdmin()
    .from("stores")
    .insert({
      name,
      description,
      slug,
      logo_url,
      phone,
      address,
      owner_id: profile.id,
    })
    .select()
    .single();

  if (error) {
    return dbErrorResponse(error, "criar a loja", {
      "23505": "esse slug já está em uso",
    });
  }

  return NextResponse.json({ data }, { status: 201 });
}
