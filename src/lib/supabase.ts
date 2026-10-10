import { createClient, type SupabaseClient } from "@supabase/supabase-js";

function required(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`Variável de ambiente ausente: ${name}`);
  }
  return value;
}

let browserClient: SupabaseClient | undefined;
let adminClient: SupabaseClient | undefined;

/**
 * Os clients são criados sob demanda de propósito: instanciar no topo do
 * módulo faz o build quebrar na coleta de dados das rotas quando as
 * variáveis de ambiente não existem no ambiente (ex.: Preview no Vercel).
 * A ausência de configuração passa a falhar na requisição, com mensagem clara.
 */
export function getSupabase(): SupabaseClient {
  browserClient ??= createClient(
    required("NEXT_PUBLIC_SUPABASE_URL", process.env.NEXT_PUBLIC_SUPABASE_URL),
    required(
      "NEXT_PUBLIC_SUPABASE_ANON_KEY",
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    ),
    {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
      },
    }
  );

  return browserClient;
}

export function getSupabaseAdmin(): SupabaseClient {
  adminClient ??= createClient(
    required("NEXT_PUBLIC_SUPABASE_URL", process.env.NEXT_PUBLIC_SUPABASE_URL),
    required("SUPABASE_SERVICE_ROLE_KEY", process.env.SUPABASE_SERVICE_ROLE_KEY),
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    }
  );

  return adminClient;
}
