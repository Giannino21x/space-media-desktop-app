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
    contentInset: 'always',
    backgroundColor: '#04070d',
    scheme: 'SPACE Media',
  },
  android: {
    backgroundColor: '#04070d',
    allowMixedContent: false,
  },
  plugins: {
    SplashScreen: {
      launchAutoHide: true,
      launchShowDuration: 1500,
      backgroundColor: '#04070d',
      androidScaleType: 'CENTER_CROP',
      showSpinner: false,
    },
    StatusBar: {
      style: 'DARK',
      backgroundColor: '#04070d',
    },
  },
};

export default config;
