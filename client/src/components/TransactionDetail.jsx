import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, CreditCard, User, Clock, ShieldCheck, Bot, Cog, AlertTriangle } from 'lucide-react';
import { getTransaction, getAuditTrail } from '../services/api';
import { getRecoveryCases } from '../services/api';

const formatDate = (d) => d ? new Date(d).toLocaleString() : '—';
const formatAction = (a) => a?.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) || '—';

const EVENT_COLORS = {
  risk_detected: 'amber', rule_applied: 'blue', ai_invoked: 'purple',
  ai_fallback: 'amber', policy_approved: 'green', policy_rejected: 'red',
  action_executed: 'blue', action_failed: 'red', case_resolved: 'green', case_escalated: 'amber'
};

export default function TransactionDetail() {
  const { transactionId } = useParams();
  const navigate = useNavigate();
  const [txn, setTxn] = useState(null);
  const [audit, setAudit] = useState([]);
  const [recoveryCase, setRecoveryCase] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetch = async () => {
      try {
        const [txnRes, auditRes, casesRes] = await Promise.all([
          getTransaction(transactionId),
          getAuditTrail(transactionId).catch(() => ({ data: [] })),
          getRecoveryCases({ limit: 100 }).catch(() => ({ data: [] }))
        ]);
        setTxn(txnRes.data);
        setAudit(auditRes.data || []);
        const matchedCase = (casesRes.data || []).find(c => c.transactionId === transactionId);
        setRecoveryCase(matchedCase || null);
      } catch (err) {
        console.error(err);
      }
      setLoading(false);
    };
    fetch();
  }, [transactionId]);

  if (loading) return <div className="loading"><div className="spinner"></div> Loading...</div>;
  if (!txn) return <div className="empty-state"><div className="empty-state-text">Transaction not found</div></div>;

  return (
    <div>
      <div className="detail-header">
        <button className="detail-back" onClick={() => navigate('/transactions')}>
          <ArrowLeft size={16} /> Back to Transactions
        </button>
        <span style={{ fontSize: 20, fontWeight: 700, fontFamily: 'monospace', color: 'var(--accent-blue)' }}>
          {txn.transactionId}
        </span>
        <span className={`badge badge-${txn.status}`}><span className="badge-dot"></span>{txn.status}</span>
      </div>

      <div className="detail-grid">
        {/* Transaction Info */}
        <div className="detail-section">
          <h3><CreditCard size={16} /> Transaction Details</h3>
          <div className="detail-row"><span className="detail-label">Amount</span><span className="detail-value" style={{ fontSize: 18, fontWeight: 700 }}>₹{txn.amount.toLocaleString()}</span></div>
          <div className="detail-row"><span className="detail-label">Currency</span><span className="detail-value">{txn.currency}</span></div>
          <div className="detail-row"><span className="detail-label">Payment Method</span><span className="detail-value" style={{ textTransform: 'uppercase' }}>{txn.paymentMethod}</span></div>
          <div className="detail-row"><span className="detail-label">Status</span><span className="detail-value"><span className={`badge badge-${txn.status}`}>{txn.status}</span></span></div>
          <div className="detail-row"><span className="detail-label">Failure Code</span><span className="detail-value">{txn.failureCode || '—'}</span></div>
          <div className="detail-row"><span className="detail-label">Failure Reason</span><span className="detail-value">{txn.failureReason || '—'}</span></div>
          <div className="detail-row"><span className="detail-label">Attempts</span><span className="detail-value">{txn.attemptCount} / {txn.maxAttempts}</span></div>
          <div className="detail-row"><span className="detail-label">Recurring</span><span className="detail-value">{txn.isRecurring ? 'Yes' : 'No'}</span></div>
          {txn.subscriptionId && <div className="detail-row"><span className="detail-label">Subscription</span><span className="detail-value">{txn.subscriptionId}</span></div>}
          <div className="detail-row"><span className="detail-label">Created</span><span className="detail-value">{formatDate(txn.createdAt)}</span></div>
        </div>

        {/* Customer Info */}
        <div className="detail-section">
          <h3><User size={16} /> Customer Info</h3>
          <div className="detail-row"><span className="detail-label">Customer ID</span><span className="detail-value">{txn.customerId}</span></div>
          <div className="detail-row"><span className="detail-label">Name</span><span className="detail-value">{txn.customerName}</span></div>
          <div className="detail-row"><span className="detail-label">Email</span><span className="detail-value">{txn.customerEmail}</span></div>
          <div className="detail-row"><span className="detail-label">Total Transactions</span><span className="detail-value">{txn.metadata?.customerTotalTransactions || 0}</span></div>
          <div className="detail-row"><span className="detail-label">Success Rate</span><span className="detail-value">{((txn.metadata?.customerSuccessRate || 0) * 100).toFixed(0)}%</span></div>
          <div className="detail-row"><span className="detail-label">Days Since Last Success</span><span className="detail-value">{txn.metadata?.daysSinceLastSuccess ?? '—'}</span></div>
          <div className="detail-row"><span className="detail-label">Platform</span><span className="detail-value" style={{ textTransform: 'capitalize' }}>{txn.metadata?.platform || '—'}</span></div>
        </div>

        {/* Recovery Decision */}
        {recoveryCase && (
          <div className="detail-section">
            <h3><ShieldCheck size={16} /> Recovery Decision</h3>
            <div className="detail-row"><span className="detail-label">Case ID</span><span className="detail-value" style={{ fontFamily: 'monospace' }}>{recoveryCase.caseId}</span></div>
            <div className="detail-row"><span className="detail-label">Status</span><span className="detail-value"><span className={`badge badge-${recoveryCase.status}`}>{recoveryCase.status}</span></span></div>
            <div className="detail-row"><span className="detail-label">Risk Level</span><span className="detail-value"><span className={`badge badge-${recoveryCase.riskLevel}`}>{recoveryCase.riskLevel}</span></span></div>
            <div className="detail-row"><span className="detail-label">Decision Source</span><span className="detail-value"><span className={`badge badge-${recoveryCase.decisionSource}`}>{recoveryCase.decisionSource === 'ai_engine' ? '🤖 AI Engine' : recoveryCase.decisionSource === 'rule_engine' ? '⚙️ Rule Engine' : formatAction(recoveryCase.decisionSource)}</span></span></div>
            {recoveryCase.ruleId && <div className="detail-row"><span className="detail-label">Rule ID</span><span className="detail-value">{recoveryCase.ruleId}</span></div>}
            <div className="detail-row"><span className="detail-label">Action</span><span className="detail-value">{formatAction(recoveryCase.recommendedAction)}</span></div>
            <div className="detail-row"><span className="detail-label">Reason</span><span className="detail-value">{recoveryCase.decisionReason}</span></div>
            {recoveryCase.aiConfidence !== null && <div className="detail-row"><span className="detail-label">AI Confidence</span><span className="detail-value">{(recoveryCase.aiConfidence * 100).toFixed(0)}%</span></div>}
            <div className="detail-row"><span className="detail-label">Policy Approved</span><span className="detail-value">{recoveryCase.policyApproved ? '✅ Yes' : `❌ No — ${recoveryCase.policyRejectionReason}`}</span></div>
            <div className="detail-row"><span className="detail-label">Amount at Risk</span><span className="detail-value">₹{recoveryCase.amountAtRisk?.toLocaleString()}</span></div>
            <div className="detail-row"><span className="detail-label">Amount Recovered</span><span className="detail-value" style={{ color: recoveryCase.amountRecovered > 0 ? 'var(--accent-green)' : 'inherit' }}>₹{recoveryCase.amountRecovered?.toLocaleString()}</span></div>
          </div>
        )}
      </div>

      {/* Audit Trail */}
      {audit.length > 0 && (
        <div className="card" style={{ marginTop: 20 }}>
          <div className="card-header">
            <div className="card-title"><Clock size={16} style={{ display: 'inline', marginRight: 8 }} />Audit Trail</div>
          </div>
          <div className="timeline">
            {audit.map((log, i) => (
              <div className="timeline-item" key={log.logId || i}>
                <div className={`timeline-dot ${EVENT_COLORS[log.eventType] || 'blue'}`}></div>
                <div className="timeline-content">
                  <div className="timeline-title">{formatAction(log.eventType)}</div>
                  <div className="timeline-description">{log.reason}</div>
                  {log.decisionSource && <div className="timeline-description" style={{ marginTop: 4 }}>Source: {formatAction(log.decisionSource)}{log.confidence ? ` · Confidence: ${(log.confidence * 100).toFixed(0)}%` : ''}</div>}
                  {log.action && <div className="timeline-description">Action: {formatAction(log.action)}</div>}
                  <div className="timeline-time">{formatDate(log.timestamp)}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
