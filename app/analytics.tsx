'use client';
import { useState, useEffect } from 'react';
import { GoogleTagManager } from '@next/third-parties/google';

export default function Analytics({ children }: { children: React.ReactNode }) {
  const [hasConsent, setHasConsent] = useState(false);

  useEffect(() => {
    const handleMessageEvent = (event: MessageEvent) => {
      if (event.data.message === 'consent_given') {
        setHasConsent(true);
      }
    };
    window.addEventListener('message', handleMessageEvent);
    return () => window.removeEventListener('message', handleMessageEvent);
  }, []);

  return (
    <>
      {hasConsent && <GoogleTagManager gtmId="GTM-T55CC768" />}
      {children}
    </>
  );
}
