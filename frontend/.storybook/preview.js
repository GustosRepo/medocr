import React from 'react';
import { MantineProvider } from '@mantine/core';
import theme from '../src/theme.js';
import '../src/app.css';
import '@mantine/core/styles.css';
import '@mantine/notifications/styles.css';
import { MemoryRouter } from 'react-router-dom';

export const decorators = [
  (render) => (
    <MantineProvider defaultColorScheme="dark" theme={theme}>
      <MemoryRouter>
        {render()}
      </MemoryRouter>
    </MantineProvider>
  )
];
