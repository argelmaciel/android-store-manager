import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";

const file = new URL("../supabase/migrations/001_initial_schema.sql", import.meta.url);
const sql = readFileSync(file, "utf8");

const db = new PGlite();
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

// 1. A migração roda do zero
try {
  await db.exec(sql);
  check("migração aplica sem erro", true);
} catch (err) {
  check("migração aplica sem erro", false, String(err.message));
  console.log("\nRESULTADO: falhou ao aplicar");
  process.exit(1);
}

// 2. Segunda execução (idempotência de re-execução)
try {
  await db.exec(sql);
  check("re-execução da migração é idempotente", true);
} catch (err) {
  check("re-execução da migração é idempotente", false, String(err.message));
}

// 3. Tabelas esperadas
const tables = (
  await db.query(
    "select table_name from information_schema.tables where table_schema='public' order by 1"
  )
).rows.map((r) => r.table_name);
const expected = ["order_items", "orders", "products", "profiles", "stores"];
check("tabelas criadas", expected.every((t) => tables.includes(t)), tables.join(","));

// 4. Tipo das chaves de usuário (id do Clerk é TEXT, não UUID)
const cols = (
  await db.query(
    "select table_name, column_name, data_type from information_schema.columns where table_schema='public' and column_name in ('id','owner_id','customer_id') and table_name in ('profiles','stores','orders') order by 1,2"
  )
).rows;
const profileId = cols.find((c) => c.table_name === "profiles" && c.column_name === "id");
const ownerId = cols.find((c) => c.table_name === "stores" && c.column_name === "owner_id");
const customerId = cols.find((c) => c.table_name === "orders" && c.column_name === "customer_id");
check(
  "chaves de usuário são TEXT",
  profileId?.data_type === "text" && ownerId?.data_type === "text" && customerId?.data_type === "text",
  `${profileId?.data_type}/${ownerId?.data_type}/${customerId?.data_type}`
);

// 5. Fluxo do usuário: perfil -> loja -> produto -> pedido (ids no formato do Clerk)
const clerkId = "user_2abcDefGhiJklMnoPqr";
let storeId, productId, orderId;
try {
  await db.query("insert into profiles (id, email, role) values ($1,$2,$3)", [
    clerkId,
    "dono@loja.com",
    "store_manager",
  ]);
  storeId = (
    await db.query(
      "insert into stores (name, slug, owner_id, is_active) values ($1,$2,$3,true) returning id",
      ["Loja Central", "loja-central", clerkId]
    )
  ).rows[0].id;
  productId = (
    await db.query(
      "insert into products (store_id, name, price, stock) values ($1,$2,$3,$4) returning id",
      [storeId, "iPhone 15", 5000.0, 10]
    )
  ).rows[0].id;
  orderId = (
    await db.query(
      "insert into orders (customer_id, store_id, total, status) values ($1,$2,$3,$4) returning id",
      [clerkId, storeId, 5000.0, "pending"]
    )
  ).rows[0].id;
  await db.query(
    "insert into order_items (order_id, product_id, quantity, unit_price, subtotal) values ($1,$2,$3,$4,$5)",
    [orderId, productId, 1, 5000.0, 5000.0]
  );
  check("fluxo perfil/loja/produto/pedido/item grava com id do Clerk", true);
} catch (err) {
  check("fluxo perfil/loja/produto/pedido/item grava com id do Clerk", false, String(err.message));
}

// 6. Padrões de consulta usados pelas rotas
const listStores = await db.query(
  "select * from stores where is_active = true order by created_at desc"
);
const listProducts = await db.query(
  "select * from products where is_active = true and store_id = $1 order by created_at desc",
  [storeId]
);
const managerOrders = await db.query(
  "select * from orders where store_id = any($1::uuid[]) order by created_at desc",
  [[storeId]]
);
const storeByOwner = await db.query("select id from stores where owner_id = $1", [clerkId]);
const orderItems = await db.query("select * from order_items where order_id = $1", [orderId]);
check("GET /api/stores", listStores.rows.length === 1);
check("GET /api/products?store_id=", listProducts.rows.length === 1);
check("GET /api/orders (gerente vê os da loja)", managerOrders.rows.length === 1);
check("lookup de loja por dono (Clerk id)", storeByOwner.rows.length === 1);
check("itens do pedido", orderItems.rows.length === 1);

// 7. Decremento de estoque do POST /api/orders e o CHECK (stock >= 0)
const stockUpdate = await db.query(
  "update products set stock = $1 where id = $2 returning stock",
  [9, productId]
);
check("decremento de estoque grava", stockUpdate.rows[0].stock === 9);
let negativeRejected = false;
try {
  await db.query("update products set stock = $1 where id = $2", [-1, productId]);
} catch {
  negativeRejected = true;
}
check("CHECK rejeita estoque negativo", negativeRejected);

// 8. Trigger de updated_at e views
const touched = await db.query(
  "update stores set name = $1 where id = $2 returning updated_at > created_at as bumped",
  ["Loja Central 2", storeId]
);
check("trigger atualiza updated_at", touched.rows[0].bumped === true);
const inventory = await db.query("select * from store_inventory");
const details = await db.query("select * from order_details");
check("view store_inventory", inventory.rows.length === 1);
check("view order_details", details.rows.length === 1);

// 9. RLS: outro usuário não enxerga o pedido, o dono da loja enxerga
try {
  await db.exec(`
    create role app_user login;
    grant usage on schema public to app_user;
    grant select on all tables in schema public to app_user;
    insert into profiles (id, email) values ('user_2outroUsuario', 'outro@loja.com');
  `);
  await db.exec(`set role app_user; set request.jwt.claims = '{"sub":"user_2outroUsuario"}';`);
  const otherSees = await db.query("select id from orders");
  const otherProfile = (await db.query("select id from profiles")).rows.map((r) => r.id);
  await db.exec(`set request.jwt.claims = '{"sub":"${clerkId}"}';`);
  const ownerSees = await db.query("select id from orders");
  const ownProfile = (await db.query("select id from profiles")).rows.map((r) => r.id);
  await db.exec("reset role");

  check(
    "RLS: cliente não vê pedido de outro",
    otherSees.rows.length === 0,
    `viu ${otherSees.rows.length}`
  );
  check(
    "RLS: dono da loja vê o pedido",
    ownerSees.rows.length === 1,
    `viu ${ownerSees.rows.length}`
  );
  check(
    "RLS: cada usuário só enxerga o próprio perfil",
    otherProfile.length === 1 &&
      otherProfile[0] === "user_2outroUsuario" &&
      ownProfile.length === 1 &&
      ownProfile[0] === clerkId,
    `outro=[${otherProfile.join(",")}] proprio=[${ownProfile.join(",")}]`
  );
} catch (err) {
  check("RLS testável", false, String(err.message));
}

const failed = results.filter((r) => !r.ok);
console.log(`\nRESULTADO: ${results.length - failed.length}/${results.length} verificações passaram`);
if (failed.length) {
  console.log("FALHAS:");
  for (const f of failed) console.log(` - ${f.name}${f.detail ? `: ${f.detail}` : ""}`);
  process.exit(1);
}
