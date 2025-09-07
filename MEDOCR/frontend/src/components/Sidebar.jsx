import React from 'react';

export default function Sidebar({ activeView, setActiveView }) {
  return (
    <aside className="sidebar">
      <h2>MEDOCR</h2>
      <nav>
        <ul>
          <li><button className="link-like" onClick={() => setActiveView('process')}>Processing</button></li>
          <li><button className="link-like" onClick={() => setActiveView('checklist')}>Checklist</button></li>
        </ul>
      </nav>
    </aside>
  );
}
