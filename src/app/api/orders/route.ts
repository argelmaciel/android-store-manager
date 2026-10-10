import { NextResponse } from "next/server";
import { getOrCreateProfile, getUserId } from "@/lib/auth";

import { dbErrorResponse } from "@/lib/http";
import { getSupabaseAdmin } from "@/lib/supabase";

export async function GET(request: Request) {
  const userId = await getUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const profile = await getOrCreateProfile();
  const role = profile?.role;

  let query = getSupabaseAdmin()
    .from("orders")
    .select("*")
    .order("created_at", { ascending: false });

  if (role === "store_manager" || role === "admin") {
    const { data: stores } = await getSupabaseAdmin()
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
    return dbErrorResponse(error, "listar os pedidos");
  }

  return NextResponse.json({ data });
}

interface EstoqueAtualizado {
  product_id: string;
  previousStock: number;
  newStock: number;
}

/**
 * Desfaz um pedido já gravado: devolve o estoque das baixas aplicadas (só se o
 * valor atual ainda for o que escrevemos) e apaga o pedido, cujos itens saem
 * por cascade.
 */
async function desfazerPedido(orderId: string, aplicadas: EstoqueAtualizado[]) {
  for (const update of aplicadas) {
    await getSupabaseAdmin()
      .from("products")
      .update({ stock: update.previousStock })
      .eq("id", update.product_id)
      .eq("stock", update.newStock);
  }

  await getSupabaseAdmin().from("orders").delete().eq("id", orderId);
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
      { error: "Perfil não encontrado para o usuário autenticado" },
      { status: 404 }
    );
  }

  // Agrega por produto: o mesmo produto repetido no carrinho não pode passar
  // duas vezes pela checagem de estoque e ser baixado em dobro.
  const quantidades = new Map<string, number>();
  for (const item of items) {
    if (
      !item.product_id ||
      !Number.isInteger(item.quantity) ||
      item.quantity <= 0
    ) {
      return NextResponse.json(
        { error: "Each item must have a valid product_id and quantity" },
        { status: 400 }
      );
    }

    quantidades.set(
      item.product_id,
      (quantidades.get(item.product_id) ?? 0) + item.quantity
    );
  }

  const { data: store, error: storeError } = await getSupabaseAdmin()
    .from("stores")
    .select("id")
    .eq("id", store_id)
    .eq("is_active", true)
    .maybeSingle();

  if (storeError) {
    return dbErrorResponse(storeError, "consultar a loja");
  }

  if (!store) {
    return NextResponse.json(
      { error: "Loja não encontrada ou inativa" },
      { status: 400 }
    );
  }

  let total = 0;
  const stockUpdates: EstoqueAtualizado[] = [];
  const orderItems: Array<{
    product_id: string;
    quantity: number;
    unit_price: number;
    subtotal: number;
  }> = [];

  for (const [productId, quantity] of quantidades) {
    // O produto tem de ser da loja do pedido: item de outra loja não entra.
    const { data: product, error: productError } = await getSupabaseAdmin()
      .from("products")
      .select("price, stock")
      .eq("id", productId)
      .eq("store_id", store_id)
      .eq("is_active", true)
      .single();

    if (productError || !product) {
      return NextResponse.json(
        { error: `Product not found or unavailable in this store: ${productId}` },
        { status: 400 }
      );
    }

    const previousStock = Number(product.stock);

    if (previousStock < quantity) {
      return NextResponse.json(
        { error: `Insufficient stock for product ${productId}` },
        { status: 400 }
      );
    }

    const unitPrice = Number(product.price);
    const subtotal = unitPrice * quantity;
    total += subtotal;

    orderItems.push({
      product_id: productId,
      quantity,
      unit_price: unitPrice,
      subtotal,
    });

    stockUpdates.push({
      product_id: productId,
      previousStock,
      newStock: previousStock - quantity,
    });
  }

  const orderPayload = {
    customer_id: userId,
    store_id,
    total,
    shipping_address: shipping_address ?? null,
    status: "pending",
  };

  const { data: order, error: orderError } = await getSupabaseAdmin()
    .from("orders")
    .insert(orderPayload)
    .select()
    .single();

  if (orderError) {
    return dbErrorResponse(orderError, "criar o pedido");
  }

  const orderItemRows = orderItems.map((item) => ({
    order_id: order.id,
    ...item,
  }));

  // Insert sem maybeSingle: um pedido pode ter vários itens e o maybeSingle
  // falhava com "JSON object requested, multiple (or no) rows returned".
  const { error: itemsError } = await getSupabaseAdmin()
    .from("order_items")
    .insert(orderItemRows);

  if (itemsError) {
    await getSupabaseAdmin().from("orders").delete().eq("id", order.id);
    return dbErrorResponse(itemsError, "registrar os itens do pedido");
  }

  // Baixa de estoque com compare-and-swap: se outra compra mexeu no estoque
  // entre a leitura e a gravação, o update não afeta nenhuma linha.
  const aplicadas: EstoqueAtualizado[] = [];

  for (const update of stockUpdates) {
    const { data: atualizado, error: stockError } = await getSupabaseAdmin()
      .from("products")
      .update({ stock: update.newStock })
      .eq("id", update.product_id)
      .eq("stock", update.previousStock)
      .select("id");

    if (stockError) {
      await desfazerPedido(order.id, aplicadas);
      return dbErrorResponse(stockError, "baixar o estoque");
    }

    if (!atualizado || atualizado.length === 0) {
      await desfazerPedido(order.id, aplicadas);
      return NextResponse.json(
        { error: "Estoque alterado por outra compra; tente novamente" },
        { status: 409 }
      );
    }

    aplicadas.push(update);
  }

  return NextResponse.json({ data: order }, { status: 201 });
}
