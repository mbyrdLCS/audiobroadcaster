/** @type {import('@docusaurus/plugin-content-docs').SidebarsConfig} */
const sidebars = {
  setupSidebar: [
    {
      type: 'category',
      label: 'Setup Guide',
      items: [
        'setup/intro',
        'setup/installation',
        'setup/network',
        'setup/first-run',
        'setup/troubleshooting',
      ],
    },
  ],
  listenerSidebar: [
    {
      type: 'category',
      label: 'Listener Guide',
      items: [
        'listener/intro',
        'listener/connecting',
        'listener/languages',
        'listener/troubleshooting',
      ],
    },
  ],
};

export default sidebars;
