import "./globals.css";

export const metadata = {
  title: "StudyBuddy - AI Engineering Assistant",
  description: "The ultimate workspace for engineering students powered by AI.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      {/* No antialiased class — it washes out text color */}
      <body style={{ WebkitFontSmoothing: "auto", MozOsxFontSmoothing: "auto" }}>
        {children}
      </body>
    </html>
  );
}