import React from 'react';
import AppHeader from './AppHeader.jsx';

export default {
  title: 'Layout/AppHeader',
  component: AppHeader,
  args: { collapsed: false }
};

export const Default = (args) => <AppHeader {...args} />;
export const Collapsed = (args) => <AppHeader {...args} collapsed />;
