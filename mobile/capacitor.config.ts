import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'ch.spacemedia.app',
  appName: 'SPACE Media',
  webDir: 'www',
  server: {
    url: 'https://space-media-app.vercel.app',
    cleartext: false,
    androidScheme: 'https',
  },
  ios: {
    /* 'never': die Web-App handhabt Safe-Areas selbst (viewport-fit=cover +
       env(safe-area-inset-*)). 'always' hat den Bottom-Inset doppelt
       angewendet → sichtbarer Rand unter der App. */
    contentInset: 'never',
    backgroundColor: '#04070d',
    scheme: 'SPACE Media',
  },
  android: {
    backgroundColor: '#04070d',
    allowMixedContent: false,
  },
  /* Keine plugins-Blöcke: @capacitor/status-bar & splash-screen sind nicht
     installiert; Statusbar-Styling läuft nativ (Info.plist / styles.xml),
     der Launch-Screen über die nativen Themes. */
};

export default config;
