import React, { useState } from 'react';

const INITIAL_JOBS = [
  { id: '1', client: 'King St Lofts — Unit 402', address: '123 King St W', neighborhood: 'Downtown', time: '09:00 AM', status: 'scheduled' },
  { id: '2', client: 'Sarah M. — 2BR Condo', address: '450 Front St W', neighborhood: 'Downtown', time: '11:30 AM', status: 'scheduled' },
  { id: '3', client: 'Priya S. — 3BR Detached', address: '78 Yonge St', neighborhood: 'Midtown', time: '02:00 PM', status: 'scheduled' },
  { id: '4', client: 'Rameet Gill', address: '12 Avenue Rd', neighborhood: 'Midtown', time: '04:30 PM', status: 'scheduled' },
];

export default function RoutePlanner() {
  const [jobs, setJobs] = useState(INITIAL_JOBS);
  const [isOptimizing, setIsOptimizing] = useState(false);

  // Auto-sort jobs by neighborhood clustering to minimize travel time
  const handleOptimizeRoute = () => {
    setIsOptimizing(true);
    setTimeout(() => {
      const sorted = [...jobs].sort((a, b) => a.neighborhood.localeCompare(b.neighborhood));
      setJobs(sorted);
      setIsOptimizing(false);
    }, 800);
  };

  return (
    <div className="p-6 bg-slate-900 text-white rounded-2xl border border-slate-800 shadow-2xl max-w-4xl mx-auto">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-6 gap-4">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            📍 Route Density & Dispatch Planner
          </h2>
          <p className="text-xs text-slate-400">
            Clustered routes reduce fuel costs and add +1 extra daily job capacity.
          </p>
        </div>

        <button
          onClick={handleOptimizeRoute}
          disabled={isOptimizing}
          className="px-4 py-2.5 bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold text-xs rounded-lg transition-all shadow-md flex items-center gap-2"
        >
          {isOptimizing ? '⚡ Clustered Sequencing...' : '⚡ Smart Auto-Optimize Route'}
        </button>
      </div>

      {/* Route List */}
      <div className="space-y-3">
        {jobs.map((job, index) => (
          <div
            key={job.id}
            className="p-4 bg-slate-800/60 border border-slate-700/60 rounded-xl flex items-center justify-between hover:border-cyan-500/50 transition-all"
          >
            <div className="flex items-center space-x-4">
              <span className="w-8 h-8 rounded-full bg-cyan-950 text-cyan-400 font-bold text-sm flex items-center justify-center border border-cyan-800">
                {index + 1}
              </span>
              <div>
                <h3 className="font-bold text-sm text-slate-100">{job.client}</h3>
                <p className="text-xs text-slate-400">{job.address} • <span className="text-cyan-400 font-medium">{job.neighborhood}</span></p>
              </div>
            </div>

            <div className="text-right">
              <span className="text-xs font-semibold text-slate-300 block">{job.time}</span>
              <span className="text-[10px] text-emerald-400 bg-emerald-950/50 px-2 py-0.5 rounded border border-emerald-800">
                Optimized
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
