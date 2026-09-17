"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  ["/", "All Items"],
  ["/sets", "Sets"],
  ["/favourites", "Favourites"],
  ["/old", "Old Dragon"],
] as const;

export default function SiteChrome({
  title,
  subtitle,
}: {
  title: string;
  subtitle: string;
}) {
  const pathname = usePathname();

  return (
    <>
      <div className="ambient ambient-a" />
      <div className="ambient ambient-b" />
      <header className="site-header">
        <div className="brand-mark">G</div>
        <div>
          <p className="eyebrow">HYPIXEL SKYBLOCK EXOTICS DATABASE</p>
          <h1>{title}</h1>
          <p className="header-copy">{subtitle}</p>
        </div>
      </header>
      <nav className="top-nav" aria-label="Main navigation">
        {links.map(([href, label]) => {
          const active = href === "/" ? pathname === "/" : pathname?.startsWith(href);
          return (
            <Link key={href} className={`nav-pill${active ? " active" : ""}`} href={href}>
              {label}
            </Link>
          );
        })}
      </nav>
    </>
  );
}
