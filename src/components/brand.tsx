import { AudioLines } from "lucide-react";
import Link from "next/link";
export function Brand({ dark = false }: { dark?: boolean }) {
  return (
    <Link
      href="/"
      className={`brand ${dark ? "brand-dark" : ""}`}
      aria-label="Signal Notes home"
    >
      <span className="brand-mark">
        <AudioLines size={22} strokeWidth={2.5} />
      </span>
      <span>
        signal<span className="brand-light">notes</span>
      </span>
    </Link>
  );
}
