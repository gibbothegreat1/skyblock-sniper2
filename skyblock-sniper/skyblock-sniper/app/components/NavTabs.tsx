"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

export default function NavTabs({ favCount = 0 }: { favCount?: number }) {
  const path = usePathname();
  const isFav = path?.startsWith("/favourites");

  return (
    <div className="mt-5 flex gap-3 justify-center">
      {isFav ? (
        <>
          <Link href="/" className="px-4 py-2 rounded-full border bg-transparent border-slate-300 hover:bg-white/70">
            All
          </Link>
          <span className="px-4 py-2 rounded-full border bg-white border-slate-300 shadow">
            Favourites {favCount ? `(${favCount})` : ""}
          </span>
        </>
      ) : (
        <>
          <span className="px-4 py-2 rounded-full border bg-white border-slate-300 shadow">
            All
          </span>
          <Link href="/favourites" className="px-4 py-2 rounded-full border bg-transparent border-slate-300 hover:bg-white/70">
            Favourites
          </Link>
        </>
      )}
    </div>
  );
}
