import type { Metadata } from 'next';
import './globals.css';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import { AuthProvider } from '@/context/AuthContext';
import { ReadingSessionProvider } from '@/context/ReadingSessionContext';
import NavigationProgress from '@/components/common/NavigationProgress';
import ContinueReadingMiniplayer from '@/components/reader/ContinueReadingMiniplayer';

export const metadata: Metadata = {
  title: 'NovelHub - N\u1ec1n T\u1ea3ng \u0110\u1ecdc Light Novel & Manga Tr\u1ef1c Tuy\u1ebfn',
  description: 'Kho Light Novel v\u00e0 Manga phong ph\u00fa, h\u1ed7 tr\u1ee3 theo d\u00f5i d\u1ecbch gi\u1ea3, l\u1ecbch s\u1eed \u0111\u1ecdc truy\u1ec7n th\u00f4ng minh, bookmark, fandom th\u1ea3o lu\u1eadn v\u00e0 qu\u1ea3n l\u00fd nh\u00f3m d\u1ecbch.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="vi" className="dark">
      <body className="min-h-screen flex flex-col bg-[#0d0d15] text-[#f3f4f6]">
        <AuthProvider>
          <ReadingSessionProvider>
            <NavigationProgress />
            <Navbar />
            <main className="flex-1">
              {children}
            </main>
            <Footer />
            <ContinueReadingMiniplayer />
          </ReadingSessionProvider>
        </AuthProvider>
      </body>
    </html>
  );
}