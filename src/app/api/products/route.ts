import { NextResponse } from "next/server";
import { getUserId } from "@/lib/auth";

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

  const { data, error } = await getSupabaseAdmin()
    .from("products")
    .insert({
      store_id,
      name,
      description,
      price: Number(price),
      stock: Number(stock),
      image_url,
      sku,
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ data }, { status: 201 });
}
