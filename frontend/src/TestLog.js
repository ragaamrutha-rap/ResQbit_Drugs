import React, { useCallback, useEffect, useState } from 'react';

const API = 'http://127.0.0.1:5000';

const resultColor = (c) => {
  if (c === 'Positive') return '#c62828';
  if (c === 'Negative') return '#2e7d32';
  return '#ef6c00';
};

function TestLog() {
  const [tests, setTests] = useState([]);
  const [q, setQ] = useState('');
  const [resultFilter, setResultFilter] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [verify, setVerify] = useState(null);
  const [openId, setOpenId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      if (q.trim()) params.append('q', q.trim());
      if (resultFilter) params.append('result', resultFilter);
      const res = await fetch(`${API}/tests?${params.toString()}`);
      const data = await res.json();
      setTests(data.tests || []);
    } catch (err) {
      setError('Could not load the log: ' + err.message);
    } finally {
      setLoading(false);
    }
  }, [q, resultFilter]);

  useEffect(() => {
    load();
  }, [load]);

  const runVerify = async () => {
    setVerify(null);
    setError('');
    try {
      const res = await fetch(`${API}/verify`);
      setVerify(await res.json());
    } catch (err) {
      setError('Could not verify: ' + err.message);
    }
  };

  const openMap = (lat, lon) => {
    const url = `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=17/${lat}/${lon}`;
    window.open(url, '_blank', 'noopener');
  };

  return (
    <div style={{ padding: '1rem', fontFamily: 'Arial', maxWidth: '520px', margin: '0 auto' }}>
      <h2>Test Log</h2>

      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search operator, date or image hash"
        style={{ width: '100%', padding: '0.5rem', fontSize: '1rem', boxSizing: 'border-box' }}
      />

      <div style={{ marginTop: '0.5rem', display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
        <select
          value={resultFilter}
          onChange={(e) => setResultFilter(e.target.value)}
          style={{ padding: '0.5rem', fontSize: '1rem' }}
        >
          <option value="">All results</option>
          <option value="Positive">Positive</option>
          <option value="Negative">Negative</option>
          <option value="Inconclusive">Inconclusive</option>
        </select>
        <button onClick={runVerify} style={{ padding: '0.5rem 1rem', fontSize: '1rem' }}>
          Verify chain integrity
        </button>
      </div>

      {verify && (
        <div
          style={{
            marginTop: '0.75rem',
            padding: '0.6rem',
            borderRadius: 6,
            color: '#fff',
            background: verify.valid ? '#2e7d32' : '#c62828'
          }}
        >
          {verify.valid
            ? `Chain intact: ${verify.total_records} records verified.`
            : `Tampering detected at record #${verify.broken_at_id}: ${verify.reason}.`}
        </div>
      )}

      {error && <p style={{ color: '#b71c1c' }}>{error}</p>}
      {loading && <p>Loading...</p>}
      {!loading && tests.length === 0 && !error && <p>No records found.</p>}

      {tests.map((t) => (
        <div
          key={t.id}
          style={{ border: '1px solid #ccc', borderRadius: 8, padding: '0.6rem', marginTop: '0.6rem' }}
        >
          <div
            onClick={() => setOpenId(openId === t.id ? null : t.id)}
            style={{ cursor: 'pointer', display: 'flex', justifyContent: 'space-between' }}
          >
            <span>
              <strong>#{t.id}</strong> {t.operator_id}
            </span>
            <span style={{ color: resultColor(t.classification), fontWeight: 'bold' }}>
              {t.classification}
            </span>
          </div>
          <div style={{ fontSize: '0.8rem', color: '#555' }}>{t.timestamp}</div>

          {openId === t.id && (
            <div style={{ marginTop: '0.5rem' }}>
              <img
                src={`${API}/image/${t.image_hash}`}
                alt={`Test ${t.id}`}
                style={{ width: '100%', borderRadius: 6 }}
              />
              <p style={{ fontSize: '0.85rem' }}>
                Location: {t.gps_lat.toFixed(5)}, {t.gps_lon.toFixed(5)}{' '}
                <button
                  onClick={() => openMap(t.gps_lat, t.gps_lon)}
                  style={{ fontSize: '0.8rem' }}
                >
                  View on map
                </button>
              </p>
              <p style={{ fontSize: '0.75rem', wordBreak: 'break-all' }}>Image hash: {t.image_hash}</p>
              <p style={{ fontSize: '0.75rem', wordBreak: 'break-all' }}>Record signature: {t.record_hash}</p>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

export default TestLog;