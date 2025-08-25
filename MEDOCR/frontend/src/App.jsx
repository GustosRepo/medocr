

import { useState } from 'react';
import './App.css';


function App() {
  const [files, setFiles] = useState([]);
  const [results, setResults] = useState([]);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  const handleFileChange = (e) => {
    setFiles(Array.from(e.target.files));
    setResults([]);
    setError(null);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!files.length) return;
    setLoading(true);
    setResults([]);
    setError(null);
    const formData = new FormData();
    files.forEach((file) => formData.append('file', file));
    try {
      const res = await fetch('http://localhost:5000/ocr?lang=eng', {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();
      if (data.error) {
        setError(data.details || data.error);
      } else if (data.results) {
        // Array of results from backend
        setResults(data.results);
      } else {
        setResults([{ text: data.text }]);
      }
    } catch (err) {
      setError('Network or server error');
    }
    setLoading(false);
  };

  return (
    <div className="dashboard">
      <aside className="sidebar">
        <h2>MEDOCR</h2>
        <nav>
          <ul>
            <li><a href="#">Dashboard</a></li>
            <li><a href="#">Upload</a></li>
            <li><a href="#">Results</a></li>
          </ul>
        </nav>
      </aside>
      <main className="main-content">
        <header className="header">
          <h1>Medical OCR Dashboard</h1>
        </header>
        <section className="card upload-card">
          <h2>Upload Documents</h2>
          <form onSubmit={handleSubmit} className="ocr-form">
            <input type="file" accept="image/*,.pdf" multiple onChange={handleFileChange} />
            <button type="submit" disabled={!files.length || loading}>
              {loading ? 'Processing...' : 'Run Batch OCR'}
            </button>
          </form>
          {files.length > 0 && (
            <div className="selected-files">
              <b>Selected files:</b>
              <ul>
                {files.map((f) => (
                  <li key={f.name}>{f.name}</li>
                ))}
              </ul>
            </div>
          )}
          {error && <div className="ocr-error">Error: {error}</div>}
        </section>
        {results.length > 0 && (
          <section className="card result-card">
            <h2>Batch Results</h2>
            <div className="compare-list">
              {results.map((r, idx) => (
                <div key={idx} className="compare-row">
                  {/* Scan Preview */}
                  <div className="compare-preview">
                    <b>{r.filename || files[idx]?.name || `File ${idx+1}`}</b>
                    <div className="preview-box">
                      {files[idx] && files[idx].type.startsWith('image/') ? (
                        <img
                          src={URL.createObjectURL(files[idx])}
                          alt={files[idx].name}
                          className="preview-img"
                        />
                      ) : (
                        <div className="pdf-icon">
                          <span role="img" aria-label="PDF">📄</span>
                        </div>
                      )}
                    </div>
                  </div>
                  {/* OCR Text */}
                  <div className="compare-ocr">
                    {r.error ? (
                      <div className="ocr-error">Error: {r.details || r.error}</div>
                    ) : (
                      <>
                        <div className="col-title">OCR Text</div>
                        <pre className="ocr-text">{r.text}</pre>
                        {r.avg_conf !== undefined && (
                          <div className="confidence">Average Confidence: <b>{r.avg_conf}</b></div>
                        )}
                      </>
                    )}
                  </div>
                  {/* Filled Template */}
                  <div className="compare-template">
                    <div className="col-title">Filled Template</div>
                    <div 
                      className="template-html" 
                      dangerouslySetInnerHTML={{
                        __html: r.filled_template || '<p>No template filled.</p>'
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}

export default App;
