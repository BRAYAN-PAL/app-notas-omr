import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.corrector.examenes',
  appName: 'Corrector de Exámenes',
  webDir: 'www',
  plugins: {
    Camera: {
      permissions: true
    }
  }
};

export default config;
