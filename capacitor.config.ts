import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'app.cutroom.editor',
  appName: 'CutRoom',
  webDir: 'dist',
  // Everything is bundled; the app makes no network requests at runtime.
  server: {
    androidScheme: 'https',
    iosScheme: 'https',
  },
  ios: {
    contentInset: 'automatic',
    backgroundColor: '#101014',
  },
}

export default config
