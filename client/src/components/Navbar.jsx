import { NavLink, useLocation } from 'react-router-dom';
import { LayoutDashboard, ArrowLeftRight, ShieldCheck, ScrollText, Bot } from 'lucide-react';

export default function Navbar() {
  return (
    <nav className="navbar">
      <div className="navbar-brand">
        <div className="navbar-logo">RR</div>
        <div>
          <div className="navbar-title">Revenue Recovery Agent</div>
          <div className="navbar-subtitle">AI-Powered Recovery System</div>
        </div>
      </div>

      <div className="navbar-links">
        <NavLink to="/" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`} end>
          <LayoutDashboard size={16} /> Dashboard
        </NavLink>
        <NavLink to="/transactions" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
          <ArrowLeftRight size={16} /> Transactions
        </NavLink>
        <NavLink to="/recovery" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
          <ShieldCheck size={16} /> Recovery Cases
        </NavLink>
        <NavLink to="/audit" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
          <ScrollText size={16} /> Audit Log
        </NavLink>
      </div>

      <div className="navbar-actions">
        <div className="ai-mode-badge">
          <div className="ai-mode-dot"></div>
          <Bot size={14} />
          Mock AI
        </div>
      </div>
    </nav>
  );
}
