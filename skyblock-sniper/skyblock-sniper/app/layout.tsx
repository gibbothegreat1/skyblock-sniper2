import "./globals.css";
export const metadata = {
  title: "Skyblock Sniper",
  description: "Search Skyblock items by name, colour, or UUID",
};
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
