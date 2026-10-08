import { AuthControls } from "@/components/UserButton";

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-24">
      <h1 className="text-4xl font-bold">MacApp</h1>
      <p className="mt-4 text-lg text-gray-600">Gestão de lojas de celulares</p>
      <div className="mt-8">
        <AuthControls />
      </div>
    </main>
  );
}
