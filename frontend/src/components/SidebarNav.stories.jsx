import React from 'react';
import SidebarNav from './SidebarNav.jsx';
import { MemoryRouter } from 'react-router-dom';

export default {
  title: 'Layout/SidebarNav',
  component: SidebarNav,
  args: { collapsed: false }
};

export const Expanded = (args) => (
  <MemoryRouter initialEntries={['/']}> <SidebarNav {...args} /> </MemoryRouter>
);
export const Collapsed = (args) => (
  <MemoryRouter initialEntries={['/analytics']}> <SidebarNav {...args} collapsed /> </MemoryRouter>
);
