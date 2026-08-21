const API_BASE = '/api';

const handleResponse = async (res) => {
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'API request failed');
  }
  return data;
};

// ─── Transaction APIs ─────────────────────────────────────────────────────

export const seedTransactions = () =>
  fetch(`${API_BASE}/transactions/seed`, { method: 'POST' }).then(handleResponse);

export const getTransactions = (params = {}) => {
  const query = new URLSearchParams(params).toString();
  return fetch(`${API_BASE}/transactions?${query}`).then(handleResponse);
};

export const getTransaction = (id) =>
  fetch(`${API_BASE}/transactions/${id}`).then(handleResponse);

// ─── Recovery APIs ────────────────────────────────────────────────────────

export const analyzeTransactions = () =>
  fetch(`${API_BASE}/recovery/analyze`, { method: 'POST' }).then(handleResponse);

export const executeRecovery = (caseId) =>
  fetch(`${API_BASE}/recovery/execute/${caseId}`, { method: 'POST' }).then(handleResponse);

export const executeAllRecovery = () =>
  fetch(`${API_BASE}/recovery/execute-all`, { method: 'POST' }).then(handleResponse);

export const getRecoveryCases = (params = {}) => {
  const query = new URLSearchParams(params).toString();
  return fetch(`${API_BASE}/recovery/cases?${query}`).then(handleResponse);
};

export const getRecoveryCase = (caseId) =>
  fetch(`${API_BASE}/recovery/cases/${caseId}`).then(handleResponse);

// ─── Metrics APIs ─────────────────────────────────────────────────────────

export const getMetricsSummary = () =>
  fetch(`${API_BASE}/metrics/summary`).then(handleResponse);

export const getMetricsBreakdown = () =>
  fetch(`${API_BASE}/metrics/breakdown`).then(handleResponse);

// ─── Audit APIs ───────────────────────────────────────────────────────────

export const getAuditLogs = (params = {}) => {
  const query = new URLSearchParams(params).toString();
  return fetch(`${API_BASE}/audit?${query}`).then(handleResponse);
};

export const getAuditTrail = (transactionId) =>
  fetch(`${API_BASE}/audit/${transactionId}`).then(handleResponse);

// ─── Health API ───────────────────────────────────────────────────────────

export const getHealth = () =>
  fetch(`${API_BASE}/health`).then(handleResponse);
