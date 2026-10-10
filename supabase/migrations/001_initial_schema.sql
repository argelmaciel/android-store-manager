-- ============================================
-- MacApp - Schema Inicial do Supabase
--
-- A identidade do app é do Clerk, portanto as chaves de usuário são
-- TEXT (ex.: user_2abc...) e não UUID, e não existe dependência de
-- auth.users. Aplique este arquivo no SQL Editor do Supabase.
-- ============================================

-- ============================================
-- Helper: id do usuário Clerk a partir do JWT
-- (claim "sub" do token emitido pelo Clerk)
-- ============================================
CREATE OR REPLACE FUNCTION public.clerk_user_id()
RETURNS TEXT AS $$
  SELECT NULLIF(
    current_setting('request.jwt.claims', true)::json->>'sub',
    ''
  );
$$ LANGUAGE sql STABLE;

-- ============================================
-- Profiles (usuários vinculados ao Clerk)
-- ============================================
CREATE TABLE IF NOT EXISTS profiles (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  full_name TEXT,
  avatar_url TEXT,
  role TEXT CHECK (role IN ('customer', 'store_manager', 'admin')) DEFAULT 'customer',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- RLS: usuários só veem seu próprio perfil
DROP POLICY IF EXISTS "Users can view own profile" ON profiles;
CREATE POLICY "Users can view own profile" ON profiles
  FOR SELECT USING (public.clerk_user_id() = id);

DROP POLICY IF EXISTS "Users can insert own profile" ON profiles;
CREATE POLICY "Users can insert own profile" ON profiles
  FOR INSERT WITH CHECK (public.clerk_user_id() = id);

DROP POLICY IF EXISTS "Users can update own profile" ON profiles;
CREATE POLICY "Users can update own profile" ON profiles
  FOR UPDATE USING (public.clerk_user_id() = id);

-- Trigger para atualizar updated_at
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_profiles_updated_at ON profiles;
CREATE TRIGGER update_profiles_updated_at
  BEFORE UPDATE ON profiles
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

-- ============================================
-- Stores (lojas / organizações)
-- ============================================
CREATE TABLE IF NOT EXISTS stores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  owner_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  slug TEXT UNIQUE NOT NULL,
  logo_url TEXT,
  phone TEXT,
  address TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE stores ENABLE ROW LEVEL SECURITY;

-- RLS: todos podem ver lojas ativas
DROP POLICY IF EXISTS "Anyone can view active stores" ON stores;
CREATE POLICY "Anyone can view active stores" ON stores
  FOR SELECT USING (is_active = TRUE);

-- Apenas owner pode modificar sua loja
DROP POLICY IF EXISTS "Owner can manage own store" ON stores;
CREATE POLICY "Owner can manage own store" ON stores
  FOR ALL USING (owner_id = public.clerk_user_id());

DROP TRIGGER IF EXISTS update_stores_updated_at ON stores;
CREATE TRIGGER update_stores_updated_at
  BEFORE UPDATE ON stores
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

-- ============================================
-- Products (produtos)
-- ============================================
CREATE TABLE IF NOT EXISTS products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  price NUMERIC(10,2) NOT NULL CHECK (price >= 0),
  stock INTEGER DEFAULT 0 CHECK (stock >= 0),
  image_url TEXT,
  sku TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE products ENABLE ROW LEVEL SECURITY;

-- RLS: todos podem ver produtos ativos
DROP POLICY IF EXISTS "Anyone can view active products" ON products;
CREATE POLICY "Anyone can view active products" ON products
  FOR SELECT USING (is_active = TRUE);

-- Apenas o dono da loja pode gerenciar produtos
DROP POLICY IF EXISTS "Store owner can manage products" ON products;
CREATE POLICY "Store owner can manage products" ON products
  FOR ALL USING (
    store_id IN (
      SELECT id FROM stores WHERE owner_id = public.clerk_user_id()
    )
  );

DROP TRIGGER IF EXISTS update_products_updated_at ON products;
CREATE TRIGGER update_products_updated_at
  BEFORE UPDATE ON products
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

-- ============================================
-- Orders (pedidos)
-- ============================================
CREATE TABLE IF NOT EXISTS orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  status TEXT CHECK (status IN ('pending', 'paid', 'shipped', 'delivered', 'cancelled')) DEFAULT 'pending',
  total NUMERIC(10,2) NOT NULL CHECK (total >= 0),
  shipping_address TEXT,
  payment_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE orders ENABLE ROW LEVEL SECURITY;

-- RLS: cliente vê seus pedidos, store_manager vê pedidos de sua loja
DROP POLICY IF EXISTS "Customers can view own orders" ON orders;
CREATE POLICY "Customers can view own orders" ON orders
  FOR SELECT USING (customer_id = public.clerk_user_id());

DROP POLICY IF EXISTS "Store managers can view store orders" ON orders;
CREATE POLICY "Store managers can view store orders" ON orders
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM stores
      WHERE id = orders.store_id AND owner_id = public.clerk_user_id()
    )
  );

DROP POLICY IF EXISTS "Customers can create orders" ON orders;
CREATE POLICY "Customers can create orders" ON orders
  FOR INSERT WITH CHECK (customer_id = public.clerk_user_id());

DROP TRIGGER IF EXISTS update_orders_updated_at ON orders;
CREATE TRIGGER update_orders_updated_at
  BEFORE UPDATE ON orders
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

-- ============================================
-- Order Items (itens do pedido)
-- ============================================
CREATE TABLE IF NOT EXISTS order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_price NUMERIC(10,2) NOT NULL CHECK (unit_price >= 0),
  subtotal NUMERIC(10,2) NOT NULL CHECK (subtotal >= 0),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE order_items ENABLE ROW LEVEL SECURITY;

-- RLS: acesso via ordem (usando RLS de orders)
DROP POLICY IF EXISTS "Order items accessible via orders" ON order_items;
CREATE POLICY "Order items accessible via orders" ON order_items
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM orders
      WHERE id = order_items.order_id
      AND (
        customer_id = public.clerk_user_id()
        OR EXISTS (
          SELECT 1 FROM stores
          WHERE id = orders.store_id
          AND owner_id = public.clerk_user_id()
        )
      )
    )
  );

-- ============================================
-- Views úteis
-- ============================================

-- View de estoque por loja
CREATE OR REPLACE VIEW store_inventory AS
SELECT
  s.id AS store_id,
  s.name AS store_name,
  p.id AS product_id,
  p.name AS product_name,
  p.price,
  p.stock,
  p.sku
FROM stores s
JOIN products p ON p.store_id = s.id
WHERE s.is_active = TRUE AND p.is_active = TRUE;

-- View de pedidos com itens
CREATE OR REPLACE VIEW order_details AS
SELECT
  o.id AS order_id,
  o.customer_id,
  o.store_id,
  o.status,
  o.total,
  o.shipping_address,
  o.payment_id,
  o.created_at,
  json_agg(
    json_build_object(
      'id', oi.id,
      'product_id', oi.product_id,
      'quantity', oi.quantity,
      'unit_price', oi.unit_price,
      'subtotal', oi.subtotal
    )
  ) AS items
FROM orders o
LEFT JOIN order_items oi ON oi.order_id = o.id
GROUP BY o.id;
