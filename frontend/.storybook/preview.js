import React from 'react';
import '../src/app.css';
import { MemoryRouter } from 'react-router-dom';

// Mantine was removed from the project; this file previously wrapped stories in MantineProvider.
// We keep a simple router + dark mode container so stories still render.
export const decorators = [
  (render) => (
    <div className="dark bg-[#0d1117] text-white min-h-screen">
      <MemoryRouter>
        {render()}
      </MemoryRouter>
    </div>
  )
];
