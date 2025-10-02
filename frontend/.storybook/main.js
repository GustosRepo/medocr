import { dirname, join } from 'path';

/** @type { import('@storybook/react').StorybookConfig } */
export default {
  stories: [
    '../src/**/*.stories.@(js|jsx|ts|tsx)'
  ],
  addons: [
    '@storybook/addon-essentials',
    '@storybook/addon-interactions'
  ],
  framework: {
    name: '@storybook/react',
    options: {}
  },
  docs: { autodocs: 'tag' }
};
