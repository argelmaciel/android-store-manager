import { NextResponse } from "next/server";

/** Erro devolvido pelo PostgREST (supabase-js), com o código SQLSTATE. */
export interface DbError {
  code?: string | null;
  message: string;
}

const POR_CODIGO: Record<string, { status: number; mensagem: string }> = {
  "23505": { status: 409, mensagem: "esse registro já existe" },
  "23503": { status: 400, mensagem: "referência inexistente" },
  "23514": { status: 400, mensagem: "valor fora do permitido" },
  "22P02": { status: 400, mensagem: "formato inválido" },
};

/**
 * Converte o erro do banco em resposta HTTP, sem vazar nome de constraint nem
 * SQLSTATE para o cliente. O texto original fica no log do servidor.
 */
export function dbErrorResponse(
  error: DbError,
  acao: string,
  mensagens?: Record<string, string>
) {
  console.error(`[api] falha ao ${acao}:`, error.code ?? "-", error.message);

  const mensagem =
    (error.code ? mensagens?.[error.code] : undefined) ??
    (error.code ? POR_CODIGO[error.code]?.mensagem : undefined);

  if (!mensagem) {
    return NextResponse.json({ error: `Não foi possível ${acao}` }, { status: 500 });
  }

  const status =
    (error.code ? POR_CODIGO[error.code]?.status : undefined) ?? 400;

  return NextResponse.json(
    { error: `Não foi possível ${acao}: ${mensagem}` },
    { status }
  );
}
