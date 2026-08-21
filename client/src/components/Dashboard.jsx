import { useState, useEffect } from 'react';
import {
  IndianRupee, AlertTriangle, CheckCircle2, TrendingUp,
  Bot, Cog, UserX, BarChart3, Play, Database, Zap, RefreshCw
} from 'lucide-react';
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import {
  getMetricsSummary, getMetricsBreakdown, getAuditLogs,
  seedTransactions, analyzeTransactions, executeAllRecovery
} from '../services/api';

const COLORS = ['#3b82f6', '#8b5cf6', '#f59e0b', '#64748b'];
const ACTION_COLORS = {
  retry_payment: '#3b82f6',
  schedule_retry: '#06b6d4',
  request_payment_update: '#f59e0b',
  send_notification: '#8b5cf6',
  escalate: '#ef4444',
  stop_retry: '#64748b',
  do_not_retry: '#475569',
  manual_review: '#f97316'
};

const formatCurrency = (amount) => {
  if (amount >= 100000) return `₹${(amount / 100000).toFixed(2)}L`;
  if (amount >= 1000) return `₹${(amount / 1000).toFixed(1)}K`;
  return `₹${amount}`;
};

const formatAction = (action) => action?.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) || '';

const EVENT_COLORS = {
  risk_detected: '#f59e0b',
  rule_applied: '#3b82f6',
  ai_invoked: '#8b5cf6',
  ai_fallback: '#f97316',
  policy_approved: '#10b981',
  policy_rejected: '#ef4444',
  action_executed: '#06b6d4',
  action_failed: '#ef4444',
  case_resolved: '#10b981',
  case_escalated: '#f97316'
};

export default function Dashboard() {
  const [metrics, setMetrics] = useState(null);
  const [breakdown, setBreakdown] = useState(null);
  const [recentAudit, setRecentAudit] = useState([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState('');
  const [statusMessage, setStatusMessage] = useState('');

  const fetchData = async () => {
    try {
      setLoading(true);
      const [metricsRes, breakdownRes, auditRes] = await Promise.all([
        getMetricsSummary().catch(() => ({ data: null })),
        getMetricsBreakdown().catch(() => ({ data: null })),
        getAuditLogs({ limit: 10 }).catch(() => ({ data: [] }))
      ]);
      setMetrics(metricsRes.data);
      setBreakdown(breakdownRes.data);
      setRecentAudit(auditRes.data || []);
    } catch (err) {
      console.error('Failed to fetch dashboard data', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, []);

  const handleSeed = async () => {
    setActionLoading('seed');
    setStatusMessage('');
    try {
      const res = await seedTransactions();
      setStatusMessage(`✓ ${res.message}`);
      await fetchData();
    } catch (err) {
      setStatusMessage(`✗ Seed failed: ${err.message}`);
    }
    setActionLoading('');
  };

  const handleAnalyze = async () => {
    setActionLoading('analyze');
    setStatusMessage('');
    try {
      const res = await analyzeTransactions();
      setStatusMessage(`✓ Analysis complete: ${res.summary.casesCreated} cases created (${res.summary.ruleDecisions} rules, ${res.summary.aiDecisions} AI)`);
      await fetchData();
    } catch (err) {
      setStatusMessage(`✗ Analysis failed: ${err.message}`);
    }
    setActionLoading('');
  };

  const handleExecute = async () => {
    setActionLoading('execute');
    setStatusMessage('');
    try {
      const res = await executeAllRecovery();
      setStatusMessage(`✓ Executed ${res.summary.totalExecuted} recoveries: ${res.summary.successful} succeeded, ₹${res.summary.totalRecovered.toLocaleString()} recovered`);
      await fetchData();
    } catch (err) {
      setStatusMessage(`✗ Execution failed: ${err.message}`);
    }
    setActionLoading('');
  };

  // Prepare chart data
  const pieData = breakdown?.byDecisionSource ? Object.entries(breakdown.byDecisionSource).map(([key, val]) => ({
    name: formatAction(key),
    value: val.count
  })) : [];

  const barData = breakdown?.byAction ? Object.entries(breakdown.byAction).map(([key, val]) => ({
    name: formatAction(key),
    success: val.successCount || 0,
    failed: val.failCount || 0,
    total: val.count || 0
  })) : [];

  if (loading && !metrics) {
    return <div className="loading"><div className="spinner"></div> Loading dashboard...</div>;
  }

  return (
    <div>
      {/* Page Header with Actions */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Recovery Dashboard</h1>
          <p className="page-subtitle">AI-powered revenue recovery monitoring and execution</p>
        </div>
        <div className="btn-group">
          <button className="btn btn-outline btn-sm" onClick={handleSeed} disabled={!!actionLoading}>
            <Database size={14} /> {actionLoading === 'seed' ? 'Seeding...' : 'Seed Data'}
          </button>
          <button className="btn btn-primary btn-sm" onClick={handleAnalyze} disabled={!!actionLoading}>
            <Zap size={14} /> {actionLoading === 'analyze' ? 'Analyzing...' : 'Analyze'}
          </button>
          <button className="btn btn-success btn-sm" onClick={handleExecute} disabled={!!actionLoading}>
            <Play size={14} /> {actionLoading === 'execute' ? 'Executing...' : 'Execute All'}
          </button>
          <button className="btn btn-outline btn-sm" onClick={fetchData} disabled={!!actionLoading}>
            <RefreshCw size={14} />
          </button>
        </div>
      </div>

      {statusMessage && (
        <div style={{
          padding: '10px 16px',
          borderRadius: '8px',
          marginBottom: '16px',
          fontSize: '13px',
          fontWeight: 500,
          background: statusMessage.startsWith('✓') ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.1)',
          color: statusMessage.startsWith('✓') ? '#10b981' : '#ef4444',
          border: `1px solid ${statusMessage.startsWith('✓') ? 'rgba(16,185,129,0.2)' : 'rgba(239,68,68,0.2)'}`
        }}>
          {statusMessage}
        </div>
      )}

      {/* Metrics Grid */}
      <div className="metrics-grid">
        <div className="metric-card blue">
          <div className="metric-icon blue"><BarChart3 size={22} /></div>
          <div className="metric-info">
            <div className="metric-label">Total Transactions</div>
            <div className="metric-value">{metrics?.totalTransactions || 0}</div>
          </div>
        </div>
        <div className="metric-card red">
          <div className="metric-icon red"><AlertTriangle size={22} /></div>
          <div className="metric-info">
            <div className="metric-label">Revenue at Risk</div>
            <div className="metric-value small">{formatCurrency(metrics?.totalRevenueAtRisk || 0)}</div>
          </div>
        </div>
        <div className="metric-card green">
          <div className="metric-icon green"><IndianRupee size={22} /></div>
          <div className="metric-info">
            <div className="metric-label">Revenue Recovered</div>
            <div className="metric-value small">{formatCurrency(metrics?.totalRevenueRecovered || 0)}</div>
          </div>
        </div>
        <div className="metric-card teal">
          <div className="metric-icon teal"><TrendingUp size={22} /></div>
          <div className="metric-info">
            <div className="metric-label">Recovery Rate</div>
            <div className="metric-value">{metrics?.recoveryRate || 0}%</div>
          </div>
        </div>
      </div>

      <div className="metrics-grid">
        <div className="metric-card green">
          <div className="metric-icon green"><CheckCircle2 size={22} /></div>
          <div className="metric-info">
            <div className="metric-label">Successful Recoveries</div>
            <div className="metric-value">{metrics?.successfulRecoveries || 0}</div>
          </div>
        </div>
        <div className="metric-card red">
          <div className="metric-icon red"><AlertTriangle size={22} /></div>
          <div className="metric-info">
            <div className="metric-label">Failed Recoveries</div>
            <div className="metric-value">{metrics?.failedRecoveries || 0}</div>
          </div>
        </div>
        <div className="metric-card amber">
          <div className="metric-icon amber"><UserX size={22} /></div>
          <div className="metric-info">
            <div className="metric-label">Manual Escalations</div>
            <div className="metric-value">{metrics?.manualEscalations || 0}</div>
          </div>
        </div>
        <div className="metric-card purple">
          <div className="metric-icon purple"><Bot size={22} /></div>
          <div className="metric-info">
            <div className="metric-label">AI Decisions</div>
            <div className="metric-value">{breakdown?.byDecisionSource?.ai_engine?.count || 0}</div>
            <div className="metric-change" style={{ color: 'var(--accent-blue)' }}>
              vs {breakdown?.byDecisionSource?.rule_engine?.count || 0} rule-based
            </div>
          </div>
        </div>
      </div>

      {/* Charts */}
      {pieData.length > 0 && (
        <div className="charts-grid">
          <div className="chart-card">
            <div className="card-header">
              <div className="card-title">Decision Source Breakdown</div>
              <div className="card-subtitle">AI vs Rule Engine vs Fallback</div>
            </div>
            <ResponsiveContainer width="100%" height={280}>
              <PieChart>
                <Pie data={pieData} cx="50%" cy="50%" innerRadius={60} outerRadius={100} paddingAngle={4} dataKey="value" label={({ name, value }) => `${name}: ${value}`}>
                  {pieData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Pie>
                <Tooltip contentStyle={{ background: '#1e293b', border: '1px solid rgba(148,163,184,0.2)', borderRadius: '8px', color: '#f1f5f9' }} />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </div>

          <div className="chart-card">
            <div className="card-header">
              <div className="card-title">Recovery Actions</div>
              <div className="card-subtitle">Success vs Failed by action type</div>
            </div>
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={barData} layout="vertical" margin={{ left: 20 }}>
                <XAxis type="number" tick={{ fill: '#94a3b8', fontSize: 12 }} />
                <YAxis type="category" dataKey="name" tick={{ fill: '#94a3b8', fontSize: 11 }} width={140} />
                <Tooltip contentStyle={{ background: '#1e293b', border: '1px solid rgba(148,163,184,0.2)', borderRadius: '8px', color: '#f1f5f9' }} />
                <Bar dataKey="success" fill="#10b981" name="Success" radius={[0, 4, 4, 0]} />
                <Bar dataKey="failed" fill="#ef4444" name="Failed" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Recent Activity */}
      {recentAudit.length > 0 && (
        <div className="card">
          <div className="card-header">
            <div className="card-title">Recent Activity</div>
            <div className="card-subtitle">Latest recovery events</div>
          </div>
          <div className="activity-feed">
            {recentAudit.map((log, i) => (
              <div className="activity-item" key={log.logId || i}>
                <div className="activity-dot" style={{ background: EVENT_COLORS[log.eventType] || '#64748b' }}></div>
                <div>
                  <div className="activity-text">
                    <strong>{formatAction(log.eventType)}</strong> — {log.reason}
                    {log.transactionId && <span style={{ color: 'var(--text-muted)' }}> ({log.transactionId})</span>}
                  </div>
                  <div className="activity-time">
                    {new Date(log.timestamp).toLocaleString()}
                    {log.decisionSource && ` · ${formatAction(log.decisionSource)}`}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
