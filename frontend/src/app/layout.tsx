import type { Metadata } from 'next';
import Script from 'next/script';
import { SimProvider } from './components/SimContext';
import SimSharedConfig from './components/SimSharedConfig';
import Sidebar from './components/Sidebar';
import TopHeader from './components/TopHeader';
import UpdatePrompt from './components/UpdatePrompt';
import CloseBehaviorPrompt from './components/CloseBehaviorPrompt';
import DiscordInvitePrompt from './components/DiscordInvitePrompt';
import ChangelogPopup from './components/ChangelogPopup';
import ScrollToTopOnRouteChange from './components/ScrollToTopOnRouteChange';
import InitialSidebarRoute from './components/InitialSidebarRoute';
import MainScrollShell from './components/MainScrollShell';
import { AuthProvider } from './components/AuthContext';
import DataGuard from './components/DataGuard';
import { ActiveCharacterProvider } from './components/ActiveCharacterContext';
import DesktopIntegrationListener from './components/DesktopIntegrationListener';
import DesktopRichPresence from './components/DesktopRichPresence';
import CommandPalette from './components/CommandPalette';
import LanSessionLifecycle from './components/LanSessionLifecycle';
import PwaRegistration from './components/PwaRegistration';
import PwaUpdatePrompt from './components/PwaUpdatePrompt';
import PwaInstallPrompt from './components/PwaInstallPrompt';
import { NotificationProvider } from './components/shared/NotificationSystem';
import { GuidedTourProvider } from './components/GuidedTour';
import SimulationActivity from './components/SimulationActivity';
import SharedResultIntegrationListener from './components/SharedResultIntegrationListener';
import './globals.css';
import React from 'react';

export const metadata: Metadata = {
  title: 'WhyLowDps',
  description: 'Run SimulationCraft simulations from your browser',
  manifest: '/manifest.webmanifest',
  icons: {
    icon: '/icon.png',
    shortcut: '/icon.png',
    apple: '/icon.png',
  },
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#09090b',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <Script
          id="wowhead-config"
          strategy="afterInteractive"
        >{`const whTooltips = { colorLinks: false, iconizeLinks: false, renameLinks: false };`}</Script>
        <Script src="https://wow.zamimg.com/js/tooltips.js" strategy="afterInteractive" />
      </head>
      <body
        className="overflow-x-hidden"
        style={{
          ['--sidebar-width' as string]: '0rem',
          ['--app-header-height' as string]: '3rem',
        }}
      >
        <GuidedTourProvider>
          <NotificationProvider>
            <AuthProvider>
              <LanSessionLifecycle />
              <SharedResultIntegrationListener />
              <ActiveCharacterProvider>
                <DataGuard>
                  <SimProvider>
                    <TopHeader />
                    <UpdatePrompt />
                    <PwaRegistration />
                    <PwaUpdatePrompt />
                    <PwaInstallPrompt />
                    <CloseBehaviorPrompt />
                    <DiscordInvitePrompt />
                    <ChangelogPopup />
                    <SimulationActivity />
                    <DesktopIntegrationListener />
                    <DesktopRichPresence />
                    <CommandPalette />
                    <ScrollToTopOnRouteChange />
                    <InitialSidebarRoute />

                    <Sidebar />

                    <MainScrollShell>
                      <SimSharedConfig />
                      {children}
                    </MainScrollShell>
                  </SimProvider>
                </DataGuard>
              </ActiveCharacterProvider>
            </AuthProvider>
          </NotificationProvider>
        </GuidedTourProvider>
      </body>
    </html>
  );
}
