import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.mycoscheduler.app',
  appName: 'MycoScheduler',
  webDir: 'dist',
  server: {
    androidScheme: 'https'
  }
};

export default config;
