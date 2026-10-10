import { currentUser } from "@clerk/nextjs/server";

import { getSupabaseAdmin } from "@/lib/supabase";

export async function getUserId(): Promise<string | null> {
  const user = await currentUser();
  return user?.id ?? null;
}

export interface AuthProfile {
  id: string;
  email: string;
  role: "customer" | "store_manager" | "admin";
}

const PROFILE_COLUMNS = "id, email, role";

/**
 * Perfil do usuário autenticado no Clerk.
 *
 * A identidade do app é do Clerk (não há Supabase Auth), então a linha da
 * tabela profiles é criada na primeira requisição autenticada.
 */
export async function getOrCreateProfile(): Promise<AuthProfile | null> {
  const user = await currentUser();
  if (!user) {
    return null;
  }

  const { data: existing } = await getSupabaseAdmin()
    .from("profiles")
    .select(PROFILE_COLUMNS)
    .eq("id", user.id)
    .maybeSingle();

  if (existing) {
    return existing as AuthProfile;
  }

  const email =
    user.emailAddresses.find(
      (address) => address.id === user.primaryEmailAddressId
    )?.emailAddress ??
    user.emailAddresses[0]?.emailAddress ??
    "";

  const fullName =
    [user.firstName, user.lastName].filter(Boolean).join(" ") || null;

  const { data: created } = await getSupabaseAdmin()
    .from("profiles")
    .insert({
      id: user.id,
      email,
      full_name: fullName,
      avatar_url: user.imageUrl,
    })
    .select(PROFILE_COLUMNS)
    .maybeSingle();

  return (created as AuthProfile | null) ?? null;
}
