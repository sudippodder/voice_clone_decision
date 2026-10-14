'use client';

import React, { useEffect, useMemo, useState } from 'react';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
const KEY = process.env.NEXT_PUBLIC_ADMIN_API_KEY || 'change-this-admin-key';

export type Client = {
  id: number;
  name: string;
  executive_name: string;
  company: string;
  industry: string;
  email: string;
  phone: string;
  active: boolean;
  created_at?: string;
};

type ClientFormData = {
  name: string;
  executive_name: string;
  company: string;
  industry: string;
  email: string;
  phone: string;
  active: boolean;
};

const initialFormData: ClientFormData = {
  name: '',
  executive_name: '',
  company: '',
  industry: '',
  email: '',
  phone: '',
  active: true,
};

function getInitials(name: string, fallback = 'EX'): string {
  if (!name || !name.trim()) return fallback;
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function ClientList({
  onOpen,
}: {
  onOpen: (id: number, tab?: 'settings' | 'agent') => void;
}) {
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Search & Filter
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');

  // Modal States
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingClient, setEditingClient] = useState<Client | null>(null);
  const [deletingClient, setDeletingClient] = useState<Client | null>(null);

  // Form Data & Status
  const [formData, setFormData] = useState<ClientFormData>(initialFormData);
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Toast Feedback
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type });
    setTimeout(() => {
      setToast(null);
    }, 4500);
  };

  async function loadClients() {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${API}/api/clients`, {
        headers: { 'X-Admin-Key': KEY },
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `HTTP error ${res.status}`);
      }
      const data: Client[] = await res.json();
      setClients(data);
    } catch (err: any) {
      setError(err.message || 'Failed to load clients.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadClients();
  }, []);

  // Filtered Clients
  const filteredClients = useMemo(() => {
    return clients.filter((c) => {
      const matchesSearch =
        search.trim() === '' ||
        c.name.toLowerCase().includes(search.toLowerCase()) ||
        c.executive_name.toLowerCase().includes(search.toLowerCase()) ||
        (c.company && c.company.toLowerCase().includes(search.toLowerCase())) ||
        (c.industry && c.industry.toLowerCase().includes(search.toLowerCase())) ||
        (c.email && c.email.toLowerCase().includes(search.toLowerCase())) ||
        (c.phone && c.phone.toLowerCase().includes(search.toLowerCase()));

      const matchesStatus =
        statusFilter === 'all' ||
        (statusFilter === 'active' && c.active) ||
        (statusFilter === 'inactive' && !c.active);

      return matchesSearch && matchesStatus;
    });
  }, [clients, search, statusFilter]);

  const activeCount = useMemo(() => clients.filter((c) => c.active).length, [clients]);
  const inactiveCount = useMemo(() => clients.filter((c) => !c.active).length, [clients]);

  // Open Add Modal
  const openAddModal = () => {
    setFormData(initialFormData);
    setFormError('');
    setShowAddModal(true);
  };

  // Open Edit Modal
  const openEditModal = (client: Client) => {
    setEditingClient(client);
    setFormData({
      name: client.name || '',
      executive_name: client.executive_name || '',
      company: client.company || '',
      industry: client.industry || '',
      email: client.email || '',
      phone: client.phone || '',
      active: client.active ?? true,
    });
    setFormError('');
  };

  // Submit Add Client
  const handleAddSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');

    if (!formData.name.trim()) {
      setFormError('Client display name is required.');
      return;
    }
    if (!formData.executive_name.trim()) {
      setFormError('Executive full name is required.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch(`${API}/api/clients`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Admin-Key': KEY,
        },
        body: JSON.stringify(formData),
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.detail || 'Failed to create client.');
      }

      const created: Client = await res.json();
      setClients((prev) => [created, ...prev]);
      setShowAddModal(false);
      showToast(`Client "${created.name}" created successfully!`, 'success');
    } catch (err: any) {
      setFormError(err.message || 'Error creating client.');
    } finally {
      setSubmitting(false);
    }
  };

  // Submit Edit Client
  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingClient) return;
    setFormError('');

    if (!formData.name.trim()) {
      setFormError('Client display name is required.');
      return;
    }
    if (!formData.executive_name.trim()) {
      setFormError('Executive full name is required.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch(`${API}/api/clients/${editingClient.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'X-Admin-Key': KEY,
        },
        body: JSON.stringify(formData),
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.detail || 'Failed to update client.');
      }

      const updated: Client = await res.json();
      setClients((prev) =>
        prev.map((c) => (c.id === updated.id ? { ...c, ...updated } : c))
      );
      setEditingClient(null);
      showToast(`Client "${updated.name}" updated successfully!`, 'success');
    } catch (err: any) {
      setFormError(err.message || 'Error updating client.');
    } finally {
      setSubmitting(false);
    }
  };

  // Quick Toggle Active Status
  const handleToggleActive = async (client: Client, e: React.MouseEvent) => {
    e.stopPropagation();
    const newActiveState = !client.active;
    try {
      // Optimistic update
      setClients((prev) =>
        prev.map((c) => (c.id === client.id ? { ...c, active: newActiveState } : c))
      );

      const res = await fetch(`${API}/api/clients/${client.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'X-Admin-Key': KEY,
        },
        body: JSON.stringify({ active: newActiveState }),
      });

      if (!res.ok) {
        throw new Error('Failed to update status');
      }

      showToast(
        `"${client.name}" marked as ${newActiveState ? 'Active' : 'Inactive'}.`,
        'success'
      );
    } catch {
      // Revert optimistic update
      setClients((prev) =>
        prev.map((c) => (c.id === client.id ? { ...c, active: client.active } : c))
      );
      showToast('Could not update status. Please try again.', 'error');
    }
  };

  // Submit Delete Client
  const handleDeleteSubmit = async () => {
    if (!deletingClient) return;
    setSubmitting(true);

    try {
      const res = await fetch(`${API}/api/clients/${deletingClient.id}`, {
        method: 'DELETE',
        headers: {
          'X-Admin-Key': KEY,
        },
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.detail || 'Failed to delete client.');
      }

      setClients((prev) => prev.filter((c) => c.id !== deletingClient.id));
      showToast(`Client "${deletingClient.name}" was permanently removed.`, 'success');
      setDeletingClient(null);
    } catch (err: any) {
      showToast(err.message || 'Error deleting client.', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="space-y-6">
      {/* Toast Notification */}
      {toast && (
        <div
          className={`fixed bottom-6 right-6 z-50 flex items-center gap-3 px-5 py-3 rounded-xl shadow-2xl border text-sm font-medium transition-all duration-300 animate-in fade-in slide-in-from-bottom-5 ${
            toast.type === 'success'
              ? 'bg-[#0f241a] border-emerald-500/40 text-emerald-200'
              : 'bg-[#290d14] border-rose-500/40 text-rose-200'
          }`}
        >
          <span>{toast.type === 'success' ? '✓' : '⚠'}</span>
          <span>{toast.message}</span>
          <button
            onClick={() => setToast(null)}
            className="ml-2 text-slate-400 hover:text-white text-xs font-bold"
          >
            ✕
          </button>
        </div>
      )}

      {/* Top Header & Actions */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-2 border-b border-slate-800/80">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-2xl font-black text-white tracking-tight">Executive Clients</h2>
            <span className="text-xs px-2.5 py-0.5 rounded-full bg-violet-500/20 text-violet-300 border border-violet-500/30 font-bold">
              {clients.length} {clients.length === 1 ? 'Client' : 'Clients'}
            </span>
          </div>
          <p className="text-sm text-slate-400 mt-1">
            Create, configure and manage autonomous digital executives with custom voice twins.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            className="btn btn-secondary flex items-center gap-2 text-xs py-2.5 px-4 hover:border-slate-500 transition-colors"
            onClick={loadClients}
            title="Reload clients from server"
          >
            <span>↻</span>
            <span>Refresh</span>
          </button>
          <button
            className="btn btn-primary flex items-center gap-2 text-xs py-2.5 px-4 shadow-lg shadow-violet-900/30 hover:shadow-violet-900/50 transition-all font-bold"
            onClick={openAddModal}
          >
            <span className="text-base leading-none font-bold">+</span>
            <span>Add New Client</span>
          </button>
        </div>
      </div>

      {/* Search and Filters Bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-[#0d1220]/70 p-3 rounded-2xl border border-slate-800/80">
        <div className="relative flex-1 max-w-md">
          <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 text-sm">
            🔍
          </span>
          <input
            type="text"
            className="input !py-2 !pl-10 !pr-8 text-xs bg-[#090d17] border-slate-700/60 focus:border-violet-500 placeholder-slate-500"
            placeholder="Search by client, executive, company, industry..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 text-xs"
            >
              ✕
            </button>
          )}
        </div>

        <div className="flex items-center gap-1.5 self-start sm:self-center">
          <button
            onClick={() => setStatusFilter('all')}
            className={`text-xs px-3 py-1.5 rounded-lg font-semibold transition-all ${
              statusFilter === 'all'
                ? 'bg-violet-600/30 text-violet-200 border border-violet-500/50'
                : 'text-slate-400 hover:text-white bg-slate-800/40 border border-transparent'
            }`}
          >
            All ({clients.length})
          </button>
          <button
            onClick={() => setStatusFilter('active')}
            className={`text-xs px-3 py-1.5 rounded-lg font-semibold transition-all ${
              statusFilter === 'active'
                ? 'bg-emerald-600/30 text-emerald-200 border border-emerald-500/50'
                : 'text-slate-400 hover:text-white bg-slate-800/40 border border-transparent'
            }`}
          >
            Active ({activeCount})
          </button>
          <button
            onClick={() => setStatusFilter('inactive')}
            className={`text-xs px-3 py-1.5 rounded-lg font-semibold transition-all ${
              statusFilter === 'inactive'
                ? 'bg-amber-600/30 text-amber-200 border border-amber-500/50'
                : 'text-slate-400 hover:text-white bg-slate-800/40 border border-transparent'
            }`}
          >
            Inactive ({inactiveCount})
          </button>
        </div>
      </div>

      {/* Loading & Global Error States */}
      {loading && (
        <div className="flex flex-col items-center justify-center p-16 text-slate-400 gap-3">
          <div className="w-8 h-8 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-sm font-medium">Loading executive clients…</p>
        </div>
      )}

      {error && !loading && (
        <div className="card p-5 bg-[#251016] border-rose-900/60 text-rose-200 space-y-2">
          <div className="flex items-center gap-2 font-bold text-base text-rose-400">
            <span>⚠</span>
            <span>Unable to connect to executive server</span>
          </div>
          <p className="text-sm text-rose-300/90">{error}</p>
          <div className="text-xs text-rose-400/70 pt-2 border-t border-rose-900/40 flex items-center justify-between">
            <span>Verify backend is running on port 8000 and ADMIN_API_KEY matches.</span>
            <button
              onClick={loadClients}
              className="btn btn-secondary !py-1 !px-3 text-xs text-white"
            >
              Retry
            </button>
          </div>
        </div>
      )}

      {/* Empty State when no clients exist */}
      {!loading && !error && clients.length === 0 && (
        <div className="card p-12 text-center border-dashed border-slate-700/80 bg-[#0e1322]/50">
          <div className="w-16 h-16 rounded-2xl bg-violet-600/20 border border-violet-500/30 text-violet-300 flex items-center justify-center text-3xl mx-auto mb-4">
            ◈
          </div>
          <h3 className="text-lg font-bold text-white mb-2">No Executive Clients Configured</h3>
          <p className="text-sm text-slate-400 max-w-md mx-auto mb-6">
            Get started by adding your first client organization and setting up their digital
            executive twin.
          </p>
          <button
            className="btn btn-primary inline-flex items-center gap-2 px-5 py-2.5 shadow-lg shadow-violet-900/40"
            onClick={openAddModal}
          >
            <span>+</span>
            <span>Add First Client</span>
          </button>
        </div>
      )}

      {/* Search No Match State */}
      {!loading && !error && clients.length > 0 && filteredClients.length === 0 && (
        <div className="card p-10 text-center bg-[#0e1322]/40 border-slate-800">
          <p className="text-slate-300 font-semibold mb-1">
            No clients match &ldquo;{search}&rdquo;
          </p>
          <p className="text-xs text-slate-500 mb-4">
            Try a different search keyword or switch the status filter.
          </p>
          <button
            onClick={() => {
              setSearch('');
              setStatusFilter('all');
            }}
            className="btn btn-secondary text-xs !py-1.5 !px-3"
          >
            Clear Filters
          </button>
        </div>
      )}

      {/* Client Cards Grid */}
      {!loading && !error && filteredClients.length > 0 && (
        <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-5">
          {filteredClients.map((c) => {
            const initials = getInitials(c.executive_name || c.name);

            return (
              <div
                key={c.id}
                className="card p-6 flex flex-col justify-between hover:border-violet-500/40 transition-all duration-200 group bg-gradient-to-b from-[#111728] to-[#0c101d] shadow-lg hover:shadow-violet-950/20"
              >
                <div>
                  {/* Card Header: Avatar, Name, and Status Badge */}
                  <div className="flex items-start justify-between gap-3 mb-4">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-violet-600 via-indigo-600 to-purple-800 flex items-center justify-center text-white font-extrabold text-base shadow-md shadow-violet-950/50 flex-shrink-0 border border-violet-400/20">
                        {initials}
                      </div>
                      <div className="min-w-0">
                        <h3 className="text-lg font-bold text-white truncate group-hover:text-violet-200 transition-colors">
                          {c.name}
                        </h3>
                        <p className="text-xs font-semibold text-violet-400/90 truncate flex items-center gap-1.5">
                          <span>Twin:</span>
                          <span className="text-slate-300 font-normal">{c.executive_name}</span>
                        </p>
                      </div>
                    </div>

                    {/* Active/Inactive Badge (Clickable quick-toggle) */}
                    <button
                      onClick={(e) => handleToggleActive(c, e)}
                      title={`Click to mark as ${c.active ? 'Inactive' : 'Active'}`}
                      className={`text-[11px] px-2.5 py-1 rounded-full font-bold flex items-center gap-1.5 transition-all flex-shrink-0 border ${
                        c.active
                          ? 'bg-emerald-950/50 text-emerald-300 border-emerald-500/30 hover:bg-emerald-900/50 hover:border-emerald-400/50'
                          : 'bg-slate-800/60 text-slate-400 border-slate-700/60 hover:bg-slate-700/50 hover:text-slate-300'
                      }`}
                    >
                      <span
                        className={`w-2 h-2 rounded-full ${
                          c.active ? 'bg-emerald-400 shadow-sm shadow-emerald-400/80 animate-pulse' : 'bg-slate-500'
                        }`}
                      />
                      <span>{c.active ? 'Active' : 'Inactive'}</span>
                    </button>
                  </div>

                  {/* Company & Industry */}
                  <div className="space-y-1.5 py-3 border-y border-slate-800/70 text-xs">
                    <div className="flex items-center justify-between text-slate-300">
                      <span className="text-slate-500">Company</span>
                      <span className="font-medium truncate max-w-[200px]">
                        {c.company || 'Not specified'}
                      </span>
                    </div>

                    <div className="flex items-center justify-between text-slate-300">
                      <span className="text-slate-500">Industry</span>
                      <span className="font-medium truncate max-w-[200px]">
                        {c.industry || 'General'}
                      </span>
                    </div>

                    {c.email && (
                      <div className="flex items-center justify-between text-slate-300">
                        <span className="text-slate-500">Email</span>
                        <span className="font-medium truncate max-w-[200px] text-violet-300/90" title={c.email}>
                          {c.email}
                        </span>
                      </div>
                    )}

                    {c.phone && (
                      <div className="flex items-center justify-between text-slate-300">
                        <span className="text-slate-500">Phone</span>
                        <span className="font-medium truncate max-w-[200px]">
                          {c.phone}
                        </span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Card Actions Footer */}
                <div className="mt-5 space-y-2.5">
                  {/* Primary Row: Settings & Talk to Agent */}
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      className="btn btn-secondary flex items-center justify-center gap-1.5 text-xs py-2 px-3 font-semibold hover:border-slate-500"
                      onClick={() => onOpen(c.id, 'settings')}
                    >
                      <span>⚙</span>
                      <span>Settings</span>
                    </button>
                    <button
                      className="btn btn-primary flex items-center justify-center gap-1.5 text-xs py-2 px-3 font-bold shadow-md shadow-violet-950/40"
                      onClick={() => onOpen(c.id, 'agent')}
                    >
                      <span>🎙</span>
                      <span>Talk to Agent</span>
                    </button>
                  </div>

                  {/* Management Row: Edit & Delete */}
                  <div className="flex items-center justify-between pt-2 border-t border-slate-800/50">
                    <button
                      onClick={() => openEditModal(c)}
                      className="text-xs text-slate-400 hover:text-violet-300 flex items-center gap-1.5 py-1 px-2 rounded-lg hover:bg-violet-950/30 transition-colors font-medium"
                    >
                      <span>✎</span>
                      <span>Edit Info</span>
                    </button>

                    <button
                      onClick={() => setDeletingClient(c)}
                      className="text-xs text-slate-400 hover:text-rose-400 flex items-center gap-1.5 py-1 px-2 rounded-lg hover:bg-rose-950/30 transition-colors font-medium"
                    >
                      <span>🗑</span>
                      <span>Delete</span>
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ========================================================================= */}
      {/* ADD CLIENT MODAL */}
      {/* ========================================================================= */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
          <div className="card max-w-lg w-full p-6 md:p-8 bg-[#111624] border border-[#2e374f] shadow-2xl relative animate-in fade-in zoom-in-95 duration-150">
            {/* Header */}
            <div className="flex items-start justify-between pb-4 border-b border-slate-800">
              <div>
                <span className="eyebrow">NEW CLIENT PROFILE</span>
                <h3 className="text-xl font-black text-white mt-1">Create Executive Client</h3>
                <p className="text-xs text-slate-400 mt-1">
                  Add an organization and assign its primary digital executive representative.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 text-lg leading-none"
              >
                ✕
              </button>
            </div>

            {/* Form */}
            <form onSubmit={handleAddSubmit} className="mt-5 space-y-4">
              {formError && (
                <div className="p-3 bg-rose-950/60 border border-rose-800/80 rounded-xl text-xs text-rose-300 flex items-start gap-2">
                  <span className="font-bold">⚠</span>
                  <span>{formError}</span>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="label">
                    Client Display Name <span className="text-violet-400">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    className="input text-xs"
                    placeholder="e.g. Acme Innovations"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  />
                </div>

                <div>
                  <label className="label">
                    Executive Name <span className="text-violet-400">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    className="input text-xs"
                    placeholder="e.g. Alex Morgan"
                    value={formData.executive_name}
                    onChange={(e) => setFormData({ ...formData, executive_name: e.target.value })}
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="label">Company</label>
                  <input
                    type="text"
                    className="input text-xs"
                    placeholder="e.g. Acme Corp"
                    value={formData.company}
                    onChange={(e) => setFormData({ ...formData, company: e.target.value })}
                  />
                </div>

                <div>
                  <label className="label">Industry</label>
                  <input
                    type="text"
                    className="input text-xs"
                    placeholder="e.g. Technology / SaaS"
                    value={formData.industry}
                    onChange={(e) => setFormData({ ...formData, industry: e.target.value })}
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="label">Contact Email</label>
                  <input
                    type="email"
                    className="input text-xs"
                    placeholder="e.g. alex@acme.com"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  />
                </div>

                <div>
                  <label className="label">Contact Phone</label>
                  <input
                    type="tel"
                    className="input text-xs"
                    placeholder="e.g. +1 555-0199"
                    value={formData.phone}
                    onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                  />
                </div>
              </div>

              {/* Active Toggle */}
              <div className="pt-2 flex items-center justify-between bg-[#0a0e17] p-3 rounded-xl border border-slate-800">
                <div>
                  <span className="text-xs font-bold text-slate-200 block">Agent Status</span>
                  <span className="text-[11px] text-slate-500">
                    Active clients can engage in immediate voice sessions.
                  </span>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    className="sr-only peer"
                    checked={formData.active}
                    onChange={(e) => setFormData({ ...formData, active: e.target.checked })}
                  />
                  <div className="w-11 h-6 bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-violet-600"></div>
                </label>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  disabled={submitting}
                  className="btn btn-secondary text-xs !py-2.5 !px-4"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="btn btn-primary text-xs !py-2.5 !px-5 flex items-center gap-2"
                >
                  {submitting && (
                    <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  )}
                  <span>{submitting ? 'Creating…' : 'Create Client'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* EDIT CLIENT MODAL */}
      {/* ========================================================================= */}
      {editingClient && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
          <div className="card max-w-lg w-full p-6 md:p-8 bg-[#111624] border border-[#2e374f] shadow-2xl relative animate-in fade-in zoom-in-95 duration-150">
            {/* Header */}
            <div className="flex items-start justify-between pb-4 border-b border-slate-800">
              <div>
                <span className="eyebrow">EDIT CLIENT</span>
                <h3 className="text-xl font-black text-white mt-1">
                  Edit &ldquo;{editingClient.name}&rdquo;
                </h3>
                <p className="text-xs text-slate-400 mt-1">
                  Update primary identity information and operational status.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setEditingClient(null)}
                className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 text-lg leading-none"
              >
                ✕
              </button>
            </div>

            {/* Form */}
            <form onSubmit={handleEditSubmit} className="mt-5 space-y-4">
              {formError && (
                <div className="p-3 bg-rose-950/60 border border-rose-800/80 rounded-xl text-xs text-rose-300 flex items-start gap-2">
                  <span className="font-bold">⚠</span>
                  <span>{formError}</span>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="label">
                    Client Display Name <span className="text-violet-400">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    className="input text-xs"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  />
                </div>

                <div>
                  <label className="label">
                    Executive Name <span className="text-violet-400">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    className="input text-xs"
                    value={formData.executive_name}
                    onChange={(e) => setFormData({ ...formData, executive_name: e.target.value })}
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="label">Company</label>
                  <input
                    type="text"
                    className="input text-xs"
                    value={formData.company}
                    onChange={(e) => setFormData({ ...formData, company: e.target.value })}
                  />
                </div>

                <div>
                  <label className="label">Industry</label>
                  <input
                    type="text"
                    className="input text-xs"
                    value={formData.industry}
                    onChange={(e) => setFormData({ ...formData, industry: e.target.value })}
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="label">Contact Email</label>
                  <input
                    type="email"
                    className="input text-xs"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  />
                </div>

                <div>
                  <label className="label">Contact Phone</label>
                  <input
                    type="tel"
                    className="input text-xs"
                    value={formData.phone}
                    onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                  />
                </div>
              </div>

              {/* Active Toggle */}
              <div className="pt-2 flex items-center justify-between bg-[#0a0e17] p-3 rounded-xl border border-slate-800">
                <div>
                  <span className="text-xs font-bold text-slate-200 block">Agent Status</span>
                  <span className="text-[11px] text-slate-500">
                    Toggle active or inactive representative mode.
                  </span>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    className="sr-only peer"
                    checked={formData.active}
                    onChange={(e) => setFormData({ ...formData, active: e.target.checked })}
                  />
                  <div className="w-11 h-6 bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-violet-600"></div>
                </label>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setEditingClient(null)}
                  disabled={submitting}
                  className="btn btn-secondary text-xs !py-2.5 !px-4"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="btn btn-primary text-xs !py-2.5 !px-5 flex items-center gap-2"
                >
                  {submitting && (
                    <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  )}
                  <span>{submitting ? 'Saving…' : 'Save Changes'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* DELETE CONFIRMATION MODAL */}
      {/* ========================================================================= */}
      {deletingClient && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
          <div className="card max-w-md w-full p-6 md:p-8 bg-[#150d12] border border-rose-900/60 shadow-2xl relative animate-in fade-in zoom-in-95 duration-150">
            <div className="w-12 h-12 rounded-xl bg-rose-950/80 border border-rose-700/50 text-rose-300 flex items-center justify-center text-2xl mb-4">
              ⚠
            </div>

            <h3 className="text-xl font-black text-white">Delete Client?</h3>
            <p className="text-xs text-rose-200/80 mt-2 leading-relaxed">
              Are you sure you want to permanently delete{' '}
              <strong className="text-white font-bold">{deletingClient.name}</strong> (Executive:{' '}
              <span className="text-white">{deletingClient.executive_name}</span>)?
            </p>

            <div className="mt-4 p-3 bg-rose-950/40 rounded-xl border border-rose-900/40 text-[11px] text-rose-300/80 space-y-1">
              <div>• Executive profile and decision parameters will be deleted.</div>
              <div>• Uploaded documents, vector chunks, and graph memories will be cleared.</div>
              <div>• Conversation histories will be permanently removed.</div>
            </div>

            <div className="flex items-center justify-end gap-3 mt-6 pt-4 border-t border-rose-900/30">
              <button
                type="button"
                onClick={() => setDeletingClient(null)}
                disabled={submitting}
                className="btn btn-secondary text-xs !py-2.5 !px-4"
              >
                Cancel, Keep Client
              </button>
              <button
                type="button"
                onClick={handleDeleteSubmit}
                disabled={submitting}
                className="btn btn-danger text-xs !py-2.5 !px-5 flex items-center gap-2 font-bold"
              >
                {submitting && (
                  <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                )}
                <span>{submitting ? 'Deleting…' : 'Delete Client'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
