import type { Metadata } from 'next';
import './globals.css';
import '../styles/skin-aemeath.css';
import '../styles/skin-aemeath-icons.css';
import '../styles/skin-aemeath-controls.css';
import '../styles/skin-aemeath-content.css';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import { AuthProvider } from '@/context/AuthContext';
import { ReadingSessionProvider } from '@/context/ReadingSessionContext';
import NavigationProgress from '@/components/common/NavigationProgress';
import SkinEffects from '@/components/common/SkinEffects';
import NavTracker from '@/components/common/NavTracker';
import RateLimitNotice from '@/components/common/RateLimitNotice';
import ContinueReadingMiniplayer from '@/components/reader/ContinueReadingMiniplayer';
import { THEME_INIT_SCRIPT } from '@/lib/themeScript';

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
    <html lang="vi" suppressHydrationWarning>
      <head>
        {/* Apply the saved theme before first paint so the page never flashes the wrong colours */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="min-h-screen flex flex-col text-white">
        <AuthProvider>
          <ReadingSessionProvider>
            <NavigationProgress />
            <NavTracker />
            <SkinEffects />
            <RateLimitNotice />
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