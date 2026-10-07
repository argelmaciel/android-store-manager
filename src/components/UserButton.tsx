"use client";

import { useAuth } from "@clerk/nextjs";
import { UserButton, SignInButton, SignUpButton } from "@clerk/nextjs";

export function AuthControls() {
  const { isSignedIn } = useAuth();

  return (
    <div className="flex items-center gap-4">
      {!isSignedIn ? (
        <>
          <SignInButton mode="modal" />
          <SignUpButton mode="modal" />
        </>
      ) : (
        <UserButton />
      )}
    </div>
  );
}
