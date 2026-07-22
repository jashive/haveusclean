import React, { useState } from 'react';

export default function CrewJobView({ job }) {
  const [jobStatus, setJobStatus] = useState(job?.status || 'scheduled');
  const [checklist, setChecklist] = useState([
    { id: 1, label: 'Dust all accessible surfaces & blinds', done: false },
    { id: 2, label: 'Wipe countertops & sanitize sinks', done: false },
    { id: 3, label: 'Vacuum & mop all floors', done: false },
    { id: 4, label: 'Clean & sanitize bathrooms/toilets', done: false },
    { id: 5, label: 'Empty all trash cans & replace liners', done: false },
  ]);
  const [photos, setPhotos] = useState({ before: null, after: null });

  const toggleTask = (id) => {
    setChecklist((prev) =>
      prev.map((item) => (item.id === id ? { ...item, done: !item.done } : item))
    );
  };

  const handlePhotoUpload = (type, e) => {
    const file = e.target.files[0];
    if (file) {
      setPhotos((prev) => ({ ...prev, [type]: URL.createObjectURL(file) }));
    }
  };

  const progressPercentage = Math.round(
    (checklist.filter((i) => i.done).length / checklist.length) * 100
  );

  return (
    <div className="max-w-md mx-auto bg-slate-900 text-white min-h-screen p-4 flex flex-col justify-between">
      
      {/* Header Info */}
      <div>
        <div className="flex justify-between items-center mb-4 pb-3 border-b border-slate-800">
          <div>
            <span className="text-xs uppercase tracking-wide text-cyan-400 font-semibold">Today's Job</span>
            <h1 className="text-xl font-bold">{job?.client_name || 'Sarah M. — 2BR Condo'}</h1>
            <p className="text-xs text-slate-400">{job?.service_address || '123 King St W, Apt 402'}</p>
          </div>
          <span className={`px-2.5 py-1 rounded-full text-xs font-bold ${
            jobStatus === 'completed' ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' :
            jobStatus === 'in_progress' ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30' :
            'bg-slate-800 text-slate-400'
          }`}>
            {jobStatus.replace('_', ' ').toUpperCase()}
          </span>
        </div>

        {/* Quick Action Buttons */}
        <div className="grid grid-cols-2 gap-2 mb-6">
          {jobStatus === 'scheduled' && (
            <button
              onClick={() => setJobStatus('in_progress')}
              className="col-span-2 py-3 bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold rounded-xl shadow-lg transition-all"
            >
              ▶️ Clock In & Start Clean
            </button>
          )}

          {jobStatus === 'in_progress' && (
            <>
              <a
                href={`https://maps.google.com/?q=${encodeURIComponent(job?.service_address || '123 King St W')}`}
                target="_blank"
                rel="noreferrer"
                className="py-2.5 bg-slate-800 text-center text-xs font-semibold rounded-lg hover:bg-slate-700"
              >
                🗺️ Navigate GPS
              </a>
              <button
                onClick={() => alert("SMS Sent to Client: 'Cleaner is on the way!'")}
                className="py-2.5 bg-slate-800 text-center text-xs font-semibold rounded-lg hover:bg-slate-700"
              >
                📲 Text Client ETA
              </button>
            </>
          )}
        </div>

        {/* Room Checklist */}
        <div className="mb-6">
          <div className="flex justify-between items-center mb-2">
            <h2 className="text-sm font-bold text-slate-300">Cleaning Checklist</h2>
            <span className="text-xs font-semibold text-cyan-400">{progressPercentage}% Done</span>
          </div>

          <div className="w-full bg-slate-800 rounded-full h-2 mb-3">
            <div
              className="bg-cyan-400 h-2 rounded-full transition-all duration-300"
              style={{ width: `${progressPercentage}%` }}
            ></div>
          </div>

          <div className="space-y-2">
            {checklist.map((item) => (
              <label
                key={item.id}
                onClick={() => toggleTask(item.id)}
                className={`flex items-center p-3 rounded-lg border text-xs cursor-pointer transition-all ${
                  item.done
                    ? 'bg-slate-800/40 border-slate-800 text-slate-500 line-through'
                    : 'bg-slate-800 border-slate-700 text-slate-200'
                }`}
              >
                <input
                  type="checkbox"
                  checked={item.done}
                  onChange={() => {}}
                  className="mr-3 h-4 w-4 rounded accent-cyan-400"
                />
                {item.label}
              </label>
            ))}
          </div>
        </div>

        {/* Photo Uploads */}
        <div className="mb-6">
          <h2 className="text-sm font-bold text-slate-300 mb-2">Job Photos</h2>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] text-slate-400 mb-1">Before Photo</label>
              <div className="border-2 border-dashed border-slate-700 rounded-lg p-3 text-center bg-slate-800/50 relative">
                {photos.before ? (
                  <img src={photos.before} alt="Before" className="h-20 w-full object-cover rounded" />
                ) : (
                  <span className="text-xs text-slate-400">📷 Upload</span>
                )}
                <input
                  type="file"
                  accept="image/*"
                  onChange={(e) => handlePhotoUpload('before', e)}
                  className="absolute inset-0 opacity-0 cursor-pointer"
                />
              </div>
            </div>

            <div>
              <label className="block text-[11px] text-slate-400 mb-1">After Photo</label>
              <div className="border-2 border-dashed border-slate-700 rounded-lg p-3 text-center bg-slate-800/50 relative">
                {photos.after ? (
                  <img src={photos.after} alt="After" className="h-20 w-full object-cover rounded" />
                ) : (
                  <span className="text-xs text-slate-400">📷 Upload</span>
                )}
                <input
                  type="file"
                  accept="image/*"
                  onChange={(e) => handlePhotoUpload('after', e)}
                  className="absolute inset-0 opacity-0 cursor-pointer"
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Complete Job & Auto Charge */}
      {jobStatus === 'in_progress' && (
        <button
          onClick={() => {
            setJobStatus('completed');
            alert('Job marked as completed! Client card will be automatically charged.');
          }}
          disabled={progressPercentage < 100}
          className={`w-full py-3.5 font-bold rounded-xl shadow-lg transition-all ${
            progressPercentage === 100
              ? 'bg-emerald-500 hover:bg-emerald-400 text-slate-950 cursor-pointer'
              : 'bg-slate-800 text-slate-500 cursor-not-allowed'
          }`}
        >
          {progressPercentage === 100
            ? '✅ Complete Job & Auto-Charge Client'
            : `Complete Checklist (${progressPercentage}%)`}
        </button>
      )}

    </div>
  );
}
