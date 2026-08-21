import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Activity, Filter, RefreshCw, Search, ScrollText } from 'lucide-react';
import { getAuditLogs } from '../services/api';

const formatDate = (d) => d ? new Date(d).toLocaleString() : '-';
const formatAction = (value) => value?.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) || '-';

const EVENT_COLORS = {
  risk_detected: 'amber',
  rule_applied: 'blue',
  ai_invoked: 'purple',
  ai_fallback: 'amber',
  policy_approved: 'green',
  policy_rejected: 'red',
  action_executed: 'blue',
  action_failed: 'red',
  case_resolved: 'green',
  case_escalated: 'amber',
  system_error: 'red'
};

export default function AuditLog() {
  const navigate = useNavigate();
  const [logs, setLogs] = useState([]);
  const [pagination, setPagination] = useState({});
  const [filters, setFilters] = useState({ eventType: '', transactionId: '', page: 1 });
  const [transactionSearch, setTransactionSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');

  const fetchLogs = async () => {
    setLoading(true);
    setMessage('');
    try {
      const params = { page: filters.page, limit: 50 };
      if (filters.eventType) params.eventType = filters.eventType;
      if (filters.transactionId) params.transactionId = filters.transactionId;
      const res = await getAuditLogs(params);
      setLogs(res.data || []);
      setPagination(res.pagination || {});
    } catch (err) {
      setMessage(`Failed to load audit log: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchLogs(); }, [filters.eventType, filters.transactionId, filters.page]);

  const applyTransactionFilter = () => {
    setFilters(f => ({ ...f, transactionId: transactionSearch.trim(), page: 1 }));
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Audit Log</h1>
          <p className="page-subtitle">Immutable decision trail across risk, policy, AI, and execution events</p>
        </div>
        <button className="btn btn-outline btn-sm" onClick={fetchLogs} disabled={loading}>
          <RefreshCw size={14} /> Refresh
        </button>
      </div>

      <div className="filter-bar">
        <div style={{ position: 'relative' }}>
          <Search size={14} style={{ position: 'absolute', left: 10, top: 10, color: 'var(--text-muted)' }} />
          <input
            className="filter-input"
            placeholder="Filter by transaction ID"
            value={transactionSearch}
            onChange={e => setTransactionSearch(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') applyTransactionFilter(); }}
            style={{ paddingLeft: 32, width: 240 }}
          />
        </div>
        <button className="btn btn-outline btn-sm" onClick={applyTransactionFilter}>
          <Filter size={14} /> Apply
        </button>
        <select className="filter-select" value={filters.eventType} onChange={e => setFilters(f => ({ ...f, eventType: e.target.value, page: 1 }))}>
          <option value="">All Events</option>
          <option value="risk_detected">Risk Detected</option>
          <option value="rule_applied">Rule Applied</option>
          <option value="ai_invoked">AI Invoked</option>
          <option value="ai_fallback">AI Fallback</option>
          <option value="policy_approved">Policy Approved</option>
          <option value="policy_rejected">Policy Rejected</option>
          <option value="action_executed">Action Executed</option>
          <option value="action_failed">Action Failed</option>
          <option value="case_resolved">Case Resolved</option>
          <option value="case_escalated">Case Escalated</option>
          <option value="system_error">System Error</option>
        </select>
        {(filters.transactionId || filters.eventType) && (
          <button className="btn btn-outline btn-sm" onClick={() => { setTransactionSearch(''); setFilters({ eventType: '', transactionId: '', page: 1 }); }}>
            Clear
          </button>
        )}
      </div>

      {message && <div className="notice error">{message}</div>}

      <div className="card">
        <div className="card-header">
          <div>
            <div className="card-title"><ScrollText size={16} style={{ display: 'inline', marginRight: 8 }} />Event Stream</div>
            <div className="card-subtitle">{pagination.total || 0} events found</div>
          </div>
        </div>

        {loading ? (
          <div className="loading"><div className="spinner"></div> Loading audit events...</div>
        ) : logs.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-text">No audit events found</div>
            <div className="empty-state-hint">Run analysis or recovery execution to generate events</div>
          </div>
        ) : (
          <>
            <div className="audit-list">
              {logs.map(log => (
                <div className="audit-item" key={log.logId}>
                  <div className={`timeline-dot ${EVENT_COLORS[log.eventType] || 'blue'}`}></div>
                  <div className="audit-content">
                    <div className="audit-main">
                      <div>
                        <div className="audit-title">
                          <Activity size={14} />
                          {formatAction(log.eventType)}
                          {log.decisionSource && <span className={`badge badge-${log.decisionSource}`}>{formatAction(log.decisionSource)}</span>}
                        </div>
                        <div className="audit-reason">{log.reason}</div>
                      </div>
                      <div className="audit-time">{formatDate(log.timestamp)}</div>
                    </div>
                    <div className="audit-meta">
                      <button className="link-button" onClick={() => navigate(`/transactions/${log.transactionId}`)}>{log.transactionId}</button>
                      {log.caseId && <span>{log.caseId}</span>}
                      {log.action && <span>{formatAction(log.action)}</span>}
                      {log.confidence !== null && log.confidence !== undefined && <span>{(log.confidence * 100).toFixed(0)}% confidence</span>}
                      {log.previousState && log.newState && <span>{formatAction(log.previousState)} to {formatAction(log.newState)}</span>}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {pagination.totalPages > 1 && (
              <div className="pagination">
                <button className="pagination-btn" onClick={() => setFilters(f => ({ ...f, page: f.page - 1 }))} disabled={filters.page <= 1}>Prev</button>
                <span className="pagination-info">Page {pagination.page} of {pagination.totalPages}</span>
                <button className="pagination-btn" onClick={() => setFilters(f => ({ ...f, page: f.page + 1 }))} disabled={filters.page >= pagination.totalPages}>Next</button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
