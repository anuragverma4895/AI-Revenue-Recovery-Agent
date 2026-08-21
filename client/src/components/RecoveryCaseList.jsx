import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  Cog,
  Eye,
  Play,
  RefreshCw,
  ShieldCheck,
  XCircle
} from 'lucide-react';
import { executeRecovery, getRecoveryCase, getRecoveryCases } from '../services/api';

const formatDate = (d) => d ? new Date(d).toLocaleString() : '-';
const formatMoney = (n = 0) => `Rs. ${Number(n || 0).toLocaleString()}`;
const formatAction = (value) => value?.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) || '-';
const badge = (value) => `badge badge-${value || 'manual'}`;

export default function RecoveryCaseList() {
  const navigate = useNavigate();
  const [cases, setCases] = useState([]);
  const [pagination, setPagination] = useState({});
  const [filters, setFilters] = useState({ status: '', decisionSource: '', riskLevel: '', page: 1 });
  const [loading, setLoading] = useState(true);
  const [selectedCase, setSelectedCase] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState('');
  const [message, setMessage] = useState('');

  const stats = useMemo(() => cases.reduce((acc, item) => {
    acc.total += 1;
    acc.atRisk += item.amountAtRisk || 0;
    acc.recovered += item.amountRecovered || 0;
    if (item.policyApproved) acc.approved += 1;
    return acc;
  }, { total: 0, atRisk: 0, recovered: 0, approved: 0 }), [cases]);

  const fetchCases = async () => {
    setLoading(true);
    setMessage('');
    try {
      const params = { page: filters.page, limit: 20 };
      if (filters.status) params.status = filters.status;
      if (filters.decisionSource) params.decisionSource = filters.decisionSource;
      if (filters.riskLevel) params.riskLevel = filters.riskLevel;
      const res = await getRecoveryCases(params);
      setCases(res.data || []);
      setPagination(res.pagination || {});
    } catch (err) {
      setMessage(`Failed to load cases: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchCases(); }, [filters.status, filters.decisionSource, filters.riskLevel, filters.page]);

  const viewCase = async (caseId) => {
    if (selectedCase?.case?.caseId === caseId) {
      setSelectedCase(null);
      return;
    }
    setDetailLoading(true);
    setMessage('');
    try {
      const res = await getRecoveryCase(caseId);
      setSelectedCase(res.data);
    } catch (err) {
      setMessage(`Failed to load case detail: ${err.message}`);
    } finally {
      setDetailLoading(false);
    }
  };

  const runCase = async (caseId) => {
    setActionLoading(caseId);
    setMessage('');
    try {
      const res = await executeRecovery(caseId);
      const recovered = formatMoney(res.data?.amountRecovered || 0);
      setMessage(`Executed ${caseId}: ${formatAction(res.data?.actionStatus)} (${recovered} recovered)`);
      await fetchCases();
      if (selectedCase?.case?.caseId === caseId) {
        const detail = await getRecoveryCase(caseId);
        setSelectedCase(detail.data);
      }
    } catch (err) {
      setMessage(`Execution failed for ${caseId}: ${err.message}`);
    } finally {
      setActionLoading('');
    }
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Recovery Cases</h1>
          <p className="page-subtitle">Review AI and rule-based decisions before recovery execution</p>
        </div>
        <button className="btn btn-outline btn-sm" onClick={fetchCases} disabled={loading}>
          <RefreshCw size={14} /> Refresh
        </button>
      </div>

      <div className="metrics-grid compact">
        <div className="metric-card blue">
          <div className="metric-icon blue"><ShieldCheck size={20} /></div>
          <div className="metric-info"><div className="metric-label">Visible Cases</div><div className="metric-value">{stats.total}</div></div>
        </div>
        <div className="metric-card amber">
          <div className="metric-icon amber"><AlertTriangle size={20} /></div>
          <div className="metric-info"><div className="metric-label">Amount at Risk</div><div className="metric-value small">{formatMoney(stats.atRisk)}</div></div>
        </div>
        <div className="metric-card green">
          <div className="metric-icon green"><CheckCircle2 size={20} /></div>
          <div className="metric-info"><div className="metric-label">Recovered</div><div className="metric-value small">{formatMoney(stats.recovered)}</div></div>
        </div>
        <div className="metric-card purple">
          <div className="metric-icon purple"><Bot size={20} /></div>
          <div className="metric-info"><div className="metric-label">Policy Approved</div><div className="metric-value">{stats.approved}</div></div>
        </div>
      </div>

      <div className="filter-bar">
        <select className="filter-select" value={filters.status} onChange={e => setFilters(f => ({ ...f, status: e.target.value, page: 1 }))}>
          <option value="">All Status</option>
          <option value="open">Open</option>
          <option value="in_progress">In Progress</option>
          <option value="recovered">Recovered</option>
          <option value="failed">Failed</option>
          <option value="escalated">Escalated</option>
          <option value="closed">Closed</option>
        </select>
        <select className="filter-select" value={filters.decisionSource} onChange={e => setFilters(f => ({ ...f, decisionSource: e.target.value, page: 1 }))}>
          <option value="">All Sources</option>
          <option value="rule_engine">Rule Engine</option>
          <option value="ai_engine">AI Engine</option>
          <option value="fallback">Fallback</option>
          <option value="manual">Manual</option>
        </select>
        <select className="filter-select" value={filters.riskLevel} onChange={e => setFilters(f => ({ ...f, riskLevel: e.target.value, page: 1 }))}>
          <option value="">All Risk</option>
          <option value="low">Low</option>
          <option value="medium">Medium</option>
          <option value="high">High</option>
          <option value="critical">Critical</option>
        </select>
      </div>

      {message && <div className={`notice ${message.includes('failed') || message.includes('Failed') ? 'error' : 'success'}`}>{message}</div>}

      <div className="card">
        {loading ? (
          <div className="loading"><div className="spinner"></div> Loading recovery cases...</div>
        ) : cases.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-text">No recovery cases found</div>
            <div className="empty-state-hint">Seed data, then run Analyze from the Dashboard</div>
          </div>
        ) : (
          <>
            <div className="table-container">
              <table>
                <thead>
                  <tr>
                    <th>Case</th>
                    <th>Transaction</th>
                    <th>Status</th>
                    <th>Risk</th>
                    <th>Amount</th>
                    <th>Decision</th>
                    <th>Action</th>
                    <th>Policy</th>
                    <th>Next Retry</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {cases.map(item => {
                    const canExecute = item.policyApproved && item.status === 'open';
                    return (
                      <tr key={item.caseId}>
                        <td className="mono accent">{item.caseId}</td>
                        <td className="mono clickable-cell" onClick={() => navigate(`/transactions/${item.transactionId}`)}>{item.transactionId}</td>
                        <td><span className={badge(item.status)}><span className="badge-dot"></span>{formatAction(item.status)}</span></td>
                        <td><span className={badge(item.riskLevel)}>{formatAction(item.riskLevel)}</span></td>
                        <td>
                          <div className="money">{formatMoney(item.amountAtRisk)}</div>
                          {item.amountRecovered > 0 && <div className="subtle green">{formatMoney(item.amountRecovered)} recovered</div>}
                        </td>
                        <td><span className={badge(item.decisionSource)}>{formatAction(item.decisionSource)}</span></td>
                        <td>{formatAction(item.recommendedAction)}</td>
                        <td>
                          {item.policyApproved ? (
                            <span className="inline-status success"><CheckCircle2 size={14} /> Approved</span>
                          ) : (
                            <span className="inline-status error"><XCircle size={14} /> Rejected</span>
                          )}
                        </td>
                        <td className="nowrap">{formatDate(item.nextRetryAt)}</td>
                        <td>
                          <div className="row-actions">
                            <button className="icon-btn" title="View details" onClick={() => viewCase(item.caseId)}>
                              <Eye size={15} />
                            </button>
                            <button className="icon-btn primary" title="Execute recovery" disabled={!canExecute || actionLoading === item.caseId} onClick={() => runCase(item.caseId)}>
                              {actionLoading === item.caseId ? <Cog size={15} /> : <Play size={15} />}
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
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

      {detailLoading && <div className="loading"><div className="spinner"></div> Loading case detail...</div>}
      {selectedCase && !detailLoading && (
        <div className="detail-drawer">
          <div className="card-header">
            <div>
              <div className="card-title">Case Detail: {selectedCase.case.caseId}</div>
              <div className="card-subtitle">{selectedCase.transaction?.customerName || selectedCase.case.customerId}</div>
            </div>
            <button className="btn btn-outline btn-sm" onClick={() => navigate(`/transactions/${selectedCase.case.transactionId}`)}>Open Transaction</button>
          </div>
          <div className="detail-grid">
            <div className="detail-section">
              <h3><ShieldCheck size={16} /> Decision</h3>
              <div className="detail-row"><span className="detail-label">Reason</span><span className="detail-value">{selectedCase.case.decisionReason}</span></div>
              <div className="detail-row"><span className="detail-label">Confidence</span><span className="detail-value">{selectedCase.case.aiConfidence ? `${(selectedCase.case.aiConfidence * 100).toFixed(0)}%` : '-'}</span></div>
              <div className="detail-row"><span className="detail-label">Retries</span><span className="detail-value">{selectedCase.case.retryCount} / {selectedCase.case.maxRetries}</span></div>
              <div className="detail-row"><span className="detail-label">Policy</span><span className="detail-value">{selectedCase.case.policyApproved ? 'Approved' : selectedCase.case.policyRejectionReason}</span></div>
            </div>
            <div className="detail-section">
              <h3><Cog size={16} /> Actions</h3>
              {(selectedCase.actions || []).length === 0 ? (
                <div className="empty-state compact">No action executed yet</div>
              ) : selectedCase.actions.map(action => (
                <div className="detail-row" key={action.actionId}>
                  <span className="detail-label">{formatAction(action.action)}</span>
                  <span className="detail-value">{formatAction(action.status)} - {formatDate(action.executedAt)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
