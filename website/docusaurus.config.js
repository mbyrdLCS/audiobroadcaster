// @ts-check
import {themes as prismThemes} from 'prism-react-renderer';

/** @type {import('@docusaurus/types').Config} */
const config = {
  title: 'Audio Broadcaster',
  tagline: 'Real-time audio streaming and translation for churches',
  favicon: 'img/favicon.ico',

  future: {
    v4: true,
  },

  url: 'https://mbyrdLCS.github.io',
  baseUrl: '/audiobroadcaster/',

  organizationName: 'mbyrdLCS',
  projectName: 'audiobroadcaster',
  trailingSlash: false,

  onBrokenLinks: 'throw',

  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },

  presets: [
    [
      'classic',
      /** @type {import('@docusaurus/preset-classic').Options} */
      ({
        docs: {
          sidebarPath: './sidebars.js',
          editUrl: 'https://github.com/mbyrdLCS/audiobroadcaster/tree/main/website/',
        },
        blog: false,
        theme: {
          customCss: './src/css/custom.css',
        },
      }),
    ],
  ],

  themeConfig:
    /** @type {import('@docusaurus/preset-classic').ThemeConfig} */
    ({
      colorMode: {
        respectPrefersColorScheme: true,
      },
      navbar: {
        title: 'Audio Broadcaster',
        items: [
          {
            type: 'docSidebar',
            sidebarId: 'setupSidebar',
            position: 'left',
            label: 'Setup Guide',
          },
          {
            type: 'docSidebar',
            sidebarId: 'listenerSidebar',
            position: 'left',
            label: 'Listener Guide',
          },
          {
            href: 'https://github.com/mbyrdLCS/audiobroadcaster',
            label: 'GitHub',
            position: 'right',
          },
        ],
      },
      footer: {
        style: 'dark',
        links: [
          {
            title: 'Guides',
            items: [
              { label: 'Setup Guide', to: '/docs/setup/intro' },
              { label: 'Listener Guide', to: '/docs/listener/intro' },
            ],
          },
          {
            title: 'Support',
            items: [
              { label: 'GitHub Issues', href: 'https://github.com/mbyrdLCS/audiobroadcaster/issues' },
              { label: 'Email', href: 'mailto:micheal@livechurchsolutions.org' },
              { label: 'ChurchApps', href: 'https://churchapps.org' },
            ],
          },
        ],
        copyright: `Copyright © ${new Date().getFullYear()} ChurchApps. Made with love for churches.`,
      },
      prism: {
        theme: prismThemes.github,
        darkTheme: prismThemes.dracula,
      },
    }),
};

export default config;
