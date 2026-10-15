import Link from "next/link";
export default function NotFound() {
  return (
    <main className="error-page">
      <h1>This page wandered off.</h1>
      <Link href="/" className="button primary">
        Back to Signal Notes
      </Link>
    </main>
  );
}
