import "./globals.css";
import Link from "next/link";
export const metadata = { title: "Radar Integratorów", description: "Wewnętrzny system researchu i scoringu leadów" };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="pl"><body><header><Link href="/" className="brand">Radar Integratorów</Link><div className="sub">Research i scoring firm instalacyjnych • tylko publiczne dowody</div></header>{children}</body></html>;
}
