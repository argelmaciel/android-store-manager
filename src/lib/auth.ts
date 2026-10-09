import { currentUser } from "@clerk/nextjs/server";

export async function getUserId(): Promise<string | null> {
  const user = await currentUser();
  return user?.id ?? null;
}
