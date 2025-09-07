import { useState } from 'react';
import { 
  ocr as apiOcr,
  batchOcr as apiBatchOcr,
} from '../lib/api';

export default function useOcrProcessing() {
  const [files, setFiles] = useState([]);
  const [results, setResults] = useState([]);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [batchResults, setBatchResults] = useState(null);
  const [errorsCount, setErrorsCount] = useState(0);
  const [intakeDate] = useState(() => {
    const t = new Date();
    return `${String(t.getMonth() + 1).padStart(2, '0')}/${String(t.getDate()).padStart(2, '0')}/${t.getFullYear()}`;
  });

  const handleFileChange = (e) => {
    setFiles(Array.from(e.target.files || []));
    setResults([]);
    setError(null);
    setBatchResults(null);
  };

  const handleSubmit = async (e) => {
    if (e && e.preventDefault) e.preventDefault();
    if (!files.length) return;
    setLoading(true);
    setError(null);
    setBatchResults(null);
    setResults([]);
    const formData = new FormData();
    files.forEach(f => formData.append('file', f));
    const isBatch = files.length > 1;
    if (isBatch) formData.append('intake_date', intakeDate);
    try {
      const data = isBatch ? await apiBatchOcr(formData) : await apiOcr(formData);
      if (isBatch) {
        if (data.success) setBatchResults(data); else setError(data.error || 'Batch processing failed');
      } else {
        if (typeof data.errorsCount === 'number') setErrorsCount(data.errorsCount);
        if (data.error) setError(data.details || data.error);
        else if (data.results) setResults(data.results);
        else setResults([{ text: data.text }]);
      }
    } catch (_) {
      setError('Network or server error');
    } finally {
      setLoading(false);
    }
  };

  return {
    files, setFiles,
    results, setResults,
    error, setError,
    loading, setLoading,
    batchResults, setBatchResults,
    errorsCount, setErrorsCount,
    intakeDate,
    handleFileChange,
    handleSubmit,
  };
}

