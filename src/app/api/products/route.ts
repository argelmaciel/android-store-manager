import { NextResponse } from "next/server";
import { getOrCreateProfile, getUserId } from "@/lib/auth";

import { dbErrorResponse } from "@/lib/http";
import { getSupabaseAdmin } from "@/lib/supabase";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const storeId = searchParams.get("store_id");

  let query = getSupabaseAdmin()
    .from("products")
    .select("*")
    .eq("is_active", true);

  if (storeId) {
    query = query.eq("store_id", storeId);
  }

  const { data, error } = await query.order("created_at", {
    ascending: false,
  });

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

  const {
    store_id,
    name,
    description,
    price,
    stock,
    image_url,
    sku,
  } = body as {
    store_id?: string;
    name?: string;
    description?: string;
    price?: number | string;
    stock?: number | string;
    image_url?: string;
    sku?: string;
  };

  if (!store_id || !name || price === undefined || stock === undefined) {
    return NextResponse.json(
      { error: "store_id, name, price and stock are required" },
      { status: 400 }
    );
  }

  const priceNumber = Number(price);
  const stockNumber = Number(stock);

  if (!Number.isFinite(priceNumber) || priceNumber < 0) {
    return NextResponse.json(
      { error: "price must be a number >= 0" },
      { status: 400 }
    );
  }

  if (!Number.isInteger(stockNumber) || stockNumber < 0) {
    return NextResponse.json(
      { error: "stock must be an integer >= 0" },
      { status: 400 }
    );
  }

  const profile = await getOrCreateProfile();
  if (!profile) {
    return NextResponse.json(
      { error: "Perfil não encontrado para o usuário autenticado" },
      { status: 404 }
    );
  }

  // Só o dono da loja (ou admin) pode cadastrar no catálogo dela.
  const { data: store, error: storeError } = await getSupabaseAdmin()
    .from("stores")
    .select("id, owner_id")
    .eq("id", store_id)
    .maybeSingle();

  if (storeError) {
    return dbErrorResponse(storeError, "consultar a loja");
  }

  if (!store) {
    return NextResponse.json({ error: "Loja não encontrada" }, { status: 404 });
  }

  if (store.owner_id !== profile.id && profile.role !== "admin") {
    return NextResponse.json(
      { error: "Forbidden" },
      { status: 403 }
    );
  }

  const { data, error } = await getSupabaseAdmin()
    .from("products")
    .insert({
      store_id,
      name,
      description,
      price: priceNumber,
      stock: stockNumber,
      image_url,
      sku,
    })
    .select()
    .single();

  if (error) {
    return dbErrorResponse(error, "cadastrar o produto");
  }

  return NextResponse.json({ data }, { status: 201 });
}
