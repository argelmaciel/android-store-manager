import { NextResponse } from "next/server";
import { getOrCreateProfile, getUserId } from "@/lib/auth";

import { supabaseAdmin } from "@/lib/supabase";

export async function GET(request: Request) {
  const userId = await getUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const profile = await getOrCreateProfile();
  const role = profile?.role;

  let query = supabaseAdmin
    .from("orders")
    .select("*")
    .order("created_at", { ascending: false });

  if (role === "store_manager" || role === "admin") {
    const { data: stores } = await supabaseAdmin
      .from("stores")
      .select("id")
      .eq("owner_id", userId);

    if (stores && stores.length > 0) {
      const storeIds = stores.map((s) => s.id);
      query = query.in("store_id", storeIds);
    } else {
      query = query.eq("store_id", null).eq("id", null);
    }
  } else {
    query = query.eq("customer_id", userId);
  }

  const { data, error } = await query;

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
    items,
    shipping_address,
  } = body as {
    store_id?: string;
    items?: Array<{
      product_id: string;
      quantity: number;
    }>;
    shipping_address?: string;
  };

  if (!store_id || !items || !Array.isArray(items) || items.length === 0) {
    return NextResponse.json(
      { error: "store_id and items are required" },
      { status: 400 }
    );
  }

  const profile = await getOrCreateProfile();

  if (!profile) {
    return NextResponse.json(
      { error: "Profile not found" },
      { status: 404 }
    );
  }

  let total = 0;
  const stockUpdates: Array<{ product_id: string; newStock: number }> = [];
  const orderItems: Array<{
    product_id: string;
    quantity: number;
    unit_price: number;
    subtotal: number;
  }> = [];

  for (const item of items) {
    if (!item.product_id || !item.quantity || item.quantity <= 0) {
      return NextResponse.json(
        { error: "Each item must have a valid product_id and quantity" },
        { status: 400 }
      );
    }

    const { data: product, error: productError } = await supabaseAdmin
      .from("products")
      .select("price, stock")
      .eq("id", item.product_id)
      .eq("is_active", true)
      .single();

    if (productError || !product) {
      return NextResponse.json(
        { error: `Product not found or unavailable: ${item.product_id}` },
        { status: 400 }
      );
    }

    if (Number(product.stock) < item.quantity) {
      return NextResponse.json(
        { error: `Insufficient stock for product ${item.product_id}` },
        { status: 400 }
      );
    }

    const unitPrice = Number(product.price);
    const subtotal = unitPrice * item.quantity;
    total += subtotal;

    orderItems.push({
      product_id: item.product_id,
      quantity: item.quantity,
      unit_price: unitPrice,
      subtotal,
    });

    stockUpdates.push({
      product_id: item.product_id,
      newStock: Number(product.stock) - item.quantity,
    });
  }

  const orderPayload = {
    customer_id: userId,
    store_id,
    total,
    shipping_address: shipping_address ?? null,
    status: "pending",
  };

  const { data: order, error: orderError } = await supabaseAdmin
    .from("orders")
    .insert(orderPayload)
    .select()
    .single();

  if (orderError) {
    return NextResponse.json(
      { error: orderError.message },
      { status: 500 }
    );
  }

  const orderItemRows = orderItems.map((item) => ({
    order_id: order.id,
    ...item,
  }));

  const { error: itemsError } = await supabaseAdmin
    .from("order_items")
    .insert(orderItemRows)
    .select()
    .maybeSingle();

  if (itemsError) {
    await supabaseAdmin.from("orders").delete().eq("id", order.id);
    return NextResponse.json(
      { error: itemsError.message },
      { status: 500 }
    );
  }

  for (const update of stockUpdates) {
    const { error: stockError } = await supabaseAdmin
      .from("products")
      .update({ stock: update.newStock })
      .eq("id", update.product_id);

    if (stockError) {
      return NextResponse.json(
        { error: stockError.message },
        { status: 500 }
      );
    }
  }

  return NextResponse.json({ data: order }, { status: 201 });
}
