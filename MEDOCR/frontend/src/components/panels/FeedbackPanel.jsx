import React from 'react';

export default function FeedbackPanel({ resultId, onFeedback }) {
  return (
    <div className="flex-1 min-w-[280px]">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-sm font-bold tracking-wide text-gray-700 uppercase">💭 Feedback</span>
      </div>
      <div className="flex gap-2 flex-wrap">
        <button type="button" onClick={() => onFeedback(resultId, 'up')} className="btn-small btn-outline">👍 Looks Good</button>
        <button type="button" onClick={() => onFeedback(resultId, 'down')} className="btn-small btn-outline">👎 Needs Fix</button>
      </div>
    </div>
  );
}

