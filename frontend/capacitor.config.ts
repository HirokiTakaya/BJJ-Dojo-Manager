import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.dojoManager.app',
  appName: 'Dojo Manager',
  webDir: 'out',
  server: {
    url: 'https://dojo-manager-94b96.web.app',
    cleartext: false
  }
};

export default config;
