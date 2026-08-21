import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Filter } from 'lucide-react';
import { getTransactions } from '../services/api';

const statusBadge = (status) => `badge badge-${status}`;
const formatDate = (d) => d ? new Date(d).toLocaleString() : '—';

export default function TransactionList() {
  const [transactions, setTransactions] = useState([]);
  const [pagination, setPagination] = useState({});
  const [filters, setFilters] = useState({ status: '', paymentMethod: '', search: '', page: 1 });
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  const fetchData = async () => {
    setLoading(true);
    try {
      const params = {};
      if (filters.status) params.status = filters.status;
      if (filters.paymentMethod) params.paymentMethod = filters.paymentMethod;
      if (filters.search) params.search = filters.search;
      params.page = filters.page;
      params.limit = 20;

      const res = await getTransactions(params);
      setTransactions(res.data);
      setPagination(res.pagination);
    } catch (err) {
      console.error(err);
    }
    setLoading(false);
  };

  useEffect(() => { fetchData(); }, [filters.status, filters.paymentMethod, filters.page]);

  const handleSearch = (e) => {
    if (e.key === 'Enter') {
      setFilters(f => ({ ...f, page: 1 }));
      fetchData();
    }
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Transactions</h1>
          <p className="page-subtitle">All payment transactions in the system</p>
        </div>
      </div>

      <div className="filter-bar">
        <div style={{ position: 'relative' }}>
          <Search size={14} style={{ position: 'absolute', left: 10, top: 10, color: 'var(--text-muted)' }} />
          <input
            className="filter-input"
            placeholder="Search by ID, customer..."
            value={filters.search}
            onChange={e => setFilters(f => ({ ...f, search: e.target.value }))}
            onKeyDown={handleSearch}
            style={{ paddingLeft: 32, width: 240 }}
          />
        </div>
        <select className="filter-select" value={filters.status} onChange={e => setFilters(f => ({ ...f, status: e.target.value, page: 1 }))}>
          <option value="">All Status</option>
          <option value="success">Success</option>
          <option value="failed">Failed</option>
          <option value="pending">Pending</option>
          <option value="abandoned">Abandoned</option>
        </select>
        <select className="filter-select" value={filters.paymentMethod} onChange={e => setFilters(f => ({ ...f, paymentMethod: e.target.value, page: 1 }))}>
          <option value="">All Methods</option>
          <option value="upi">UPI</option>
          <option value="card">Card</option>
          <option value="netbanking">Net Banking</option>
          <option value="wallet">Wallet</option>
        </select>
      </div>

      <div className="card">
        {loading ? (
          <div className="loading"><div className="spinner"></div> Loading...</div>
        ) : transactions.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-text">No transactions found</div>
            <div className="empty-state-hint">Seed data from the Dashboard to get started</div>
          </div>
        ) : (
          <>
            <div className="table-container">
              <table>
                <thead>
                  <tr>
                    <th>Transaction ID</th>
                    <th>Customer</th>
                    <th>Amount</th>
                    <th>Method</th>
                    <th>Status</th>
                    <th>Failure Reason</th>
                    <th>Attempts</th>
                    <th>Date</th>
                  </tr>
                </thead>
                <tbody>
                  {transactions.map(txn => (
                    <tr key={txn.transactionId} className="clickable" onClick={() => navigate(`/transactions/${txn.transactionId}`)}>
                      <td style={{ fontFamily: 'monospace', fontWeight: 600, color: 'var(--accent-blue)' }}>{txn.transactionId}</td>
                      <td>{txn.customerName}</td>
                      <td style={{ fontWeight: 600 }}>₹{txn.amount.toLocaleString()}</td>
                      <td style={{ textTransform: 'uppercase', fontSize: 12 }}>{txn.paymentMethod}</td>
                      <td><span className={statusBadge(txn.status)}><span className="badge-dot"></span>{txn.status}</span></td>
                      <td style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{txn.failureReason || '—'}</td>
                      <td>{txn.attemptCount}/{txn.maxAttempts}</td>
                      <td style={{ fontSize: 12, whiteSpace: 'nowrap' }}>{formatDate(txn.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {pagination.totalPages > 1 && (
              <div className="pagination">
                <button className="pagination-btn" onClick={() => setFilters(f => ({ ...f, page: f.page - 1 }))} disabled={filters.page <= 1}>← Prev</button>
                <span className="pagination-info">Page {pagination.page} of {pagination.totalPages}</span>
                <button className="pagination-btn" onClick={() => setFilters(f => ({ ...f, page: f.page + 1 }))} disabled={filters.page >= pagination.totalPages}>Next →</button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
