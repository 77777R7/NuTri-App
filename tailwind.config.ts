import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './app/**/*.{js,jsx,ts,tsx}',
    './components/**/*.{js,jsx,ts,tsx}',
    './hooks/**/*.{js,jsx,ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        primary: '#2CC2B3',
        'primary-50': '#E6FAF8',
        'primary-100': '#C6F2EA',
        'primary-200': '#A2E8DE',
        'primary-300': '#7AE0D0',
        'primary-400': '#52D7C3',
        'primary-500': '#33D6C6',
        'primary-600': '#2CC2B3',
        'primary-700': '#1F9689',
        background: '#F4FBF9',
        surface: '#FFFFFF',
        border: '#E1F0EB',
        text: '#0F1F1C',
        muted: '#6A8C86',
        success: '#22C55E',
        danger: '#EF4444',
      },
      borderRadius: {
        '2xl': '1.25rem',
        16: '16px',
        20: '20px',
      },
      boxShadow: {
        soft: '0 10px 30px -15px rgba(44, 194, 179, 0.35)',
        card: '0 20px 45px -20px rgba(15, 31, 28, 0.25)',
      },
    },
  },
  plugins: [],
};

export default config;
