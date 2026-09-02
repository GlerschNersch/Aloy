import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

export default defineConfig({
  base: '/docs',
  integrations: [
    starlight({
      title: 'Aloy Developer Docs',
      description: 'Technical Reference, Architecture, Pantheon Engines, Media Dispatcher & API Specs',
      customCss: [
        './src/styles/custom.css',
      ],
      social: {
        github: 'https://github.com/GlerschNersch/aloy',
      },
      sidebar: [
        {
          label: '🚀 Overview & Setup',
          autogenerate: { directory: 'guides' },
        },
        {
          label: '🏛️ System Architecture',
          autogenerate: { directory: 'architecture' },
        },
        {
          label: '⚡ The Pantheon Engines',
          autogenerate: { directory: 'pantheon' },
        },
        {
          label: '📺 Universal Media & Casting',
          autogenerate: { directory: 'media' },
        },
        {
          label: '📱 Aloy Mobile Companion',
          autogenerate: { directory: 'mobile' },
        },
        {
          label: '🔌 REST API Reference',
          autogenerate: { directory: 'api' },
        },
      ],
    }),
  ],
});
