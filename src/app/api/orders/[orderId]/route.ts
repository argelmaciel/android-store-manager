import { NextResponse } from "next/server";
import { getOrCreateProfile, getUserId } from "@/lib/auth";

import { supabaseAdmin } from "@/lib/supabase";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ orderId: string }> }
) {
  const userId = await getUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { orderId } = await params;

  if (!orderId) {
    return NextResponse.json({ error: "orderId is required" }, { status: 400 });
  }

  const { data: order, error: orderError } = await supabaseAdmin
    .from("orders")
    .select("*")
    .eq("id", orderId)
    .single();

  if (orderError || !order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  const isCustomer = order.customer_id === userId;
  const profile = await getOrCreateProfile();
  const role = profile?.role;
  const isManager =
    (role === "store_manager" || role === "admin") &&
    (await supabaseAdmin
      .from("stores")
      .select("id")
      .eq("id", order.store_id)
      .eq("owner_id", userId)
      .single()
      .then((s) => !!s.data));

  if (!isCustomer && !isManager) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { data: items, error: itemsError } = await supabaseAdmin
    .from("order_items")
    .select("*")
    .eq("order_id", orderId);

  if (itemsError) {
    return NextResponse.json(
      { error: itemsError.message },
      { status: 500 }
    );
  }

  return NextResponse.json({ data: { ...order, items } });
}
